(function () {
  'use strict';
  const { WorkspaceState } = window.DashWorkspaceState;
  const { definitions } = window.DashWorkspaceApps;
  const model = new WorkspaceState();
  const views = new Map();
  const islandItems = new Map();
  let bridge, latest = {}, offline = false, blocked = false, shell, picker, frame, homeAnchor;
  let chromeTimer, controlsVisible = false, dragging = false, suppressClickUntil = 0, pickerMode, pickerIndex, pickerFocus;
  const $ = selector => shell.querySelector(selector);
  const name = appId => definitions.find(app => app.id === appId)?.name || appId;
  const photoVisible = () => model.mode === 'home' || model.panes.some(pane => pane.appId === 'clock');
  const isSuspended = () => latest.phone_state?.is_home === false || latest.phone_state?.sleep_focus === true || String(latest.phone_state?.focus_mode || '').trim().toLowerCase() === 'sleep';
  const setText = (node, value) => { if (node.textContent !== String(value ?? '')) node.textContent = String(value ?? ''); };

  function setControls(visible, keyboard = false) {
    clearTimeout(chromeTimer);
    controlsVisible = visible;
    shell.classList.toggle('controls-visible', visible);
    $('.workspace-toolbar').inert = !visible;
    shell.querySelectorAll('.workspace-pane-header').forEach(node => { node.inert = !visible; });
    views.forEach(view => view.setControls?.(visible));
    if (visible) chromeTimer = setTimeout(() => {
      const focused = document.activeElement;
      if (dragging || picker.open || [...views.values()].some(view => view.isInteracting?.() || view.keepControls?.())
          || (keyboard && shell.contains(focused) && focused !== shell && !focused.matches('.ws-reveal,.sports-reveal'))) setControls(true, keyboard);
      else {
        if (shell.contains(focused) && focused !== shell) shell.focus({ preventScroll: true });
        setControls(false);
      }
    }, 4000);
  }

  function select(action) {
    action(); renderLayout(); updateViews(); renderIsland();
    window.DashFrame?.setWorkspace?.({ split: model.mode === 'split', visibleApps: model.panes.map(pane => pane.appId) });
    window.DashFrame?.syncRotationPause();
    bridge.onChange?.();
  }

  function showPicker(mode = 'apps', index = model.focused) {
    pickerMode = mode; pickerIndex = index; pickerFocus = document.activeElement;
    setControls(true, true);
    const visible = model.panes.map(pane => pane.appId);
    const ranked = [...definitions].sort((a, b) => Number(Boolean(model.session(b.id))) - Number(Boolean(model.session(a.id))));
    picker.querySelector('h2').textContent = mode === 'split' ? 'Add a second app' : mode === 'replace' ? 'Replace this pane' : 'Your apps';
    const list = picker.querySelector('.workspace-picker-grid');
    list.innerHTML = ranked.map(app => {
      const disabled = visible.includes(app.id) && (mode === 'split' || (mode === 'replace' && visible[index] !== app.id));
      return `<button type="button" data-choose-app="${app.id}" ${disabled ? 'disabled' : ''}><span class="workspace-picker-icon" aria-hidden="true">${app.icon}</span><strong>${app.name}</strong><small>${model.session(app.id) ? 'Active now' : app.detail}</small></button>`;
    }).join('');
    picker.showModal();
  }

  function focusWorkspace() {
    if (model.mode === 'home') document.getElementById('dashboardView').focus({ preventScroll: true });
    else shell.focus({ preventScroll: true });
  }

  function home() { select(() => model.home()); setControls(false); focusWorkspace(); }
  function open(appId, { index = null } = {}) {
    if (!definitions.some(app => app.id === appId)) return;
    if (index == null && model.mode === 'split') {
      const clockIndex = model.panes.findIndex(pane => pane.appId === 'clock');
      index = clockIndex >= 0 ? clockIndex : model.focused;
    }
    select(() => model.open(appId, index)); setControls(false); focusWorkspace();
  }

  function renderLayout() {
    const mode = model.mode;
    shell.hidden = mode === 'home';
    shell.dataset.mode = mode;
    shell.classList.toggle('is-split', mode === 'split');
    document.body.classList.toggle('workspace-active', mode !== 'home');
    document.body.classList.toggle('workspace-split', mode === 'split');
    $('.workspace-split-button').textContent = mode === 'split' ? 'Exit split' : 'Split Screen';
    const visible = new Set(model.panes.map(pane => pane.appId));
    const focused = document.activeElement;
    const preserveFocus = focused && shell.contains(focused);
    if (mode === 'home' || !visible.has('clock')) {
      if (frame.previousSibling !== homeAnchor) homeAnchor.parentNode.insertBefore(frame, homeAnchor.nextSibling);
      frame.hidden = mode !== 'home'; frame.inert = mode !== 'home';
    }
    views.forEach((view, appId) => { if (!visible.has(appId)) { view.destroy(); views.delete(appId); } });
    model.panes.forEach((pane, index) => {
      const slot = $(`[data-slot="${index}"]`);
      slot.hidden = false; slot.dataset.app = pane.appId;
      slot.classList.toggle('is-focused', model.focused === index);
      setText(slot.querySelector('.workspace-pane-name'), name(pane.appId));
      const host = slot.querySelector('.workspace-pane-content');
      if (pane.appId === 'clock') {
        frame.hidden = false; frame.inert = false;
        if (frame.parentElement !== host) host.appendChild(frame);
      } else {
        let view = views.get(pane.appId);
        if (!view) {
          const appId = pane.appId;
          view = window.DashWorkspaceApps.mount(host, appId, {
            gameId: pane.gameId,
            sendAction: (action, params) => bridge.sendAction(action, params),
            getData: () => latest, isOffline: () => offline,
            getActivity: () => model.session(appId), openSettings: () => bridge.openSettings(),
            isAutomatic: () => Boolean(model.panes.find(pane => pane.appId === appId)?.automatic),
            isFullscreen: () => model.mode === 'single',
            showControls: () => setControls(true),
            makeManual: () => { const index = model.panes.findIndex(pane => pane.appId === appId); model.manual(index); },
          });
          view.mount(); views.set(appId, view); view.setControls(controlsVisible);
        } else if (view.root.parentElement !== host) host.appendChild(view.root);
      }
    });
    for (let index = model.panes.length; index < 2; index++) $(`[data-slot="${index}"]`).hidden = true;
    $('.workspace-divider').hidden = mode !== 'split';
    resize();
    if (preserveFocus && focused.isConnected && !focused.closest('[hidden]')) focused.focus({ preventScroll: true });
  }

  function resize() {
    if (!shell) return;
    const stacked = window.innerWidth < 800;
    shell.classList.toggle('is-stacked', stacked);
    const divider = $('.workspace-divider');
    const length = stacked ? Math.max(408, shell.clientHeight) : shell.clientWidth;
    const min = Math.min(50, ((stacked ? 200 : 240) + 4) / Math.max(1, length) * 100);
    model.ratio = Math.max(min, Math.min(100 - min, model.ratio));
    shell.style.setProperty('--workspace-ratio', `${model.ratio}%`);
    divider.setAttribute('aria-orientation', stacked ? 'horizontal' : 'vertical');
    divider.setAttribute('aria-valuemin', String(Math.ceil(min)));
    divider.setAttribute('aria-valuemax', String(Math.floor(100 - min)));
    divider.setAttribute('aria-valuenow', String(Math.round(model.ratio)));
    views.forEach(view => view.resize());
    window.DashFrame?.resize?.();
  }

  function updateViews() {
    const now = performance.now();
    views.forEach(view => { view.update(latest, now); view.tick?.(now); });
  }

  function summary(item) {
    const data = item.data;
    if (item.appId === 'spotify') return { icon: '♫', title: data?.track_name || 'Music', detail: data?.is_playing ? data.artist_name || 'Playing' : 'Paused', image: data?.album_art_url };
    if (item.appId === 'sports') return { icon: '⚾', title: `${data?.away?.abbreviation || 'MLB'} ${data?.away?.score ?? '–'} · ${data?.home?.abbreviation || ''} ${data?.home?.score ?? '–'}`, detail: offline || latest.apps?.sports?.stale || latest.apps?.sports?.error ? 'Last available score' : data?.status === 'live' ? `${data.inning_half || 'Inning'} ${data.inning || ''}` : data?.status_text || 'Live game' };
    if (item.appId === 'timer') return { icon: '◴', title: data?.time_text || 'Timer', detail: item.doneAt != null ? 'Time’s up' : data?.running ? 'Timer' : 'Paused' };
    return { icon: definitions.find(app => app.id === item.appId)?.icon || '•', title: name(item.appId), detail: 'Return to app' };
  }

  function renderIsland() {
    const island = $('.workspace-island');
    const items = model.mode === 'home' ? [] : model.background();
    island.hidden = !items.length;
    shell.classList.toggle('has-island', Boolean(items.length));
    const keys = new Set(items.map(item => item.appId));
    islandItems.forEach((record, id) => { if (!keys.has(id)) { record.abort.abort(); record.node.remove(); islandItems.delete(id); } });
    items.forEach((item, index) => {
      let record = islandItems.get(item.appId);
      if (!record) {
        const node = document.createElement('div'); node.className = 'workspace-island-item'; node.dataset.activity = item.appId;
        node.innerHTML = '<button class="workspace-island-open" type="button"><span class="workspace-island-icon" aria-hidden="true"></span><img alt="" hidden/><span class="workspace-island-copy"><strong></strong><small></small></span></button><button class="workspace-island-hide" type="button" aria-label="Hide activity">×</button>';
        const abort = new AbortController();
        const on = (type, listener, options = {}) => node.addEventListener(type, listener, { ...options, signal: abort.signal });
        node.querySelector('img').draggable = false;
        on('dragstart', event => event.preventDefault());
        on('click', event => {
          if (performance.now() < suppressClickUntil) { event.preventDefault(); return; }
          if (event.target.closest('.workspace-island-hide')) select(() => model.dismiss(item.appId));
          else select(() => model.swap(item.appId));
          focusWorkspace();
        });
        let down;
        on('pointerdown', event => { if (event.button !== 0) return; down = { x: event.clientX, y: event.clientY }; });
        on('pointermove', event => {
          if (!down) return;
          const dx = event.clientX - down.x, dy = event.clientY - down.y;
          if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy)) { node.setPointerCapture(event.pointerId); node.style.transform = `translateX(${dx * .5}px)`; node.style.opacity = String(Math.max(.25, 1 - Math.abs(dx) / 140)); }
        });
        const finish = event => {
          if (!down) return;
          const dx = event.clientX - down.x, dy = event.clientY - down.y;
          down = null; node.style.transform = ''; node.style.opacity = '';
          if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) { suppressClickUntil = performance.now() + 500; event.preventDefault(); select(() => model.dismiss(item.appId)); }
        };
        on('pointerup', finish); on('pointercancel', () => { down = null; node.style.transform = ''; node.style.opacity = ''; });
        node.addEventListener('pointerleave', event => { if (event.buttons === 0) { down = null; node.style.transform = ''; node.style.opacity = ''; } }, { signal: abort.signal });
        record = { node, abort }; islandItems.set(item.appId, record);
      }
      const node = record.node;
      if (island.children[index] !== node) island.insertBefore(node, island.children[index] || null);
      const info = summary(item);
      setText(node.querySelector('strong'), info.title); setText(node.querySelector('small'), info.detail); setText(node.querySelector('.workspace-island-icon'), info.icon);
      node.querySelector('.workspace-island-open').setAttribute('aria-label', `Open ${name(item.appId)}: ${info.title}. ${info.detail}`);
      node.querySelector('.workspace-island-hide').setAttribute('aria-label', `Hide ${name(item.appId)} for this session`);
      const image = node.querySelector('img');
      const safeImage = typeof info.image === 'string' && /^(https?:\/\/|\/)/.test(info.image) ? info.image : '';
      if (safeImage && image.getAttribute('src') !== safeImage) { image.src = safeImage; image.hidden = false; }
      if (!safeImage) { image.hidden = true; image.removeAttribute('src'); }
    });
  }

  function init(options) {
    bridge = options;
    frame = document.getElementById('appContainer');
    homeAnchor = document.createComment('Photo Clock home position'); frame.before(homeAnchor);
    shell = document.createElement('main'); shell.id = 'workspaceRoot'; shell.className = 'workspace-root'; shell.hidden = true; shell.tabIndex = -1;
    shell.setAttribute('aria-label', 'App workspace');
    shell.innerHTML = `<header class="workspace-toolbar"><button type="button" data-workspace="home" class="workspace-home">‹ Home</button><nav aria-label="Workspace controls"><button type="button" data-workspace="apps">Apps</button><button type="button" data-workspace="split" class="workspace-split-button">Split Screen</button><button type="button" data-workspace="settings" aria-label="Open settings">⚙</button></nav></header><div class="workspace-island" role="region" aria-label="Background activities" hidden></div><div class="workspace-panes">${[0,1].map(index => `${index ? '<div class="workspace-divider" role="separator" tabindex="0" aria-label="Resize app panes" aria-valuenow="50"></div>' : ''}<section class="workspace-pane" data-slot="${index}"><header class="workspace-pane-header"><strong class="workspace-pane-name"></strong><div><button type="button" data-pane-action="replace" aria-label="Replace app">⇄</button><button type="button" data-pane-action="expand" aria-label="Expand app fullscreen">⛶</button><button type="button" data-pane-action="close" aria-label="Close app">×</button></div></header><div class="workspace-pane-content"></div></section>`).join('')}</div>`;
    document.getElementById('appOverlayView').before(shell);
    picker = document.createElement('dialog'); picker.className = 'workspace-picker'; picker.setAttribute('aria-labelledby', 'workspacePickerTitle');
    picker.innerHTML = '<div class="workspace-picker-heading"><div><span class="ws-eyebrow">MAKE ROOM FOR MORE</span><h2 id="workspacePickerTitle">Your apps</h2></div><button type="button" data-picker-close aria-label="Close app picker">×</button></div><div class="workspace-picker-grid"></div><footer><button type="button" data-picker-photos>Photo settings</button><button type="button" data-picker-settings>System settings</button></footer>';
    document.body.appendChild(picker);
    picker.addEventListener('click', event => {
      const app = event.target.closest('[data-choose-app]');
      if (app) {
        picker.close();
        select(() => {
          if (pickerMode === 'split') model.split(app.dataset.chooseApp);
          else model.open(app.dataset.chooseApp, pickerMode === 'replace' || model.mode === 'split' ? pickerIndex : null);
        });
        setControls(false); focusWorkspace();
      } else if (event.target.closest('[data-picker-close]')) picker.close();
      else if (event.target.closest('[data-picker-photos]')) { picker.close(); bridge.openPhotos(); }
      else if (event.target.closest('[data-picker-settings]')) { picker.close(); bridge.openSettings(); }
    });
    picker.addEventListener('close', () => { if (pickerFocus?.isConnected && pickerFocus.getClientRects().length && !pickerFocus.closest('[inert]')) pickerFocus.focus({ preventScroll: true }); });
    shell.addEventListener('pointerdown', event => {
      const pane = event.target.closest('[data-slot]'); if (pane) model.focused = Number(pane.dataset.slot);
      if (!event.target.closest('.workspace-island,.sports-reveal')) setControls(true);
    });
    shell.addEventListener('focusin', event => { const pane = event.target.closest('[data-slot]'); if (pane) model.focused = Number(pane.dataset.slot); if (event.target !== shell && !event.target.matches('.ws-reveal,.sports-reveal') && !event.target.closest('.workspace-island')) setControls(true, true); });
    shell.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation();
        if (controlsVisible) setControls(false); else home();
      } else if (event.key === 'Tab') setControls(true, true);
      else if (event.target === shell && ['Enter', ' '].includes(event.key)) { event.preventDefault(); setControls(true, true); }
    });
    shell.addEventListener('click', event => {
      if (event.target.closest('.sports-reveal')) setControls(true);
      const operation = event.target.closest('[data-workspace]')?.dataset.workspace;
      if (operation === 'home') home();
      else if (operation === 'apps') showPicker();
      else if (operation === 'split') { if (model.mode === 'split') select(() => model.expand(model.focused)); else showPicker('split'); }
      else if (operation === 'settings') bridge.openSettings();
      const paneAction = event.target.closest('[data-pane-action]')?.dataset.paneAction;
      const index = Number(event.target.closest('[data-slot]')?.dataset.slot);
      if (paneAction === 'replace') showPicker('replace', index);
      else if (paneAction === 'expand') { select(() => model.expand(index)); setControls(false); focusWorkspace(); }
      else if (paneAction === 'close') { select(() => model.close(index)); setControls(false); focusWorkspace(); }
    });
    const divider = $('.workspace-divider');
    divider.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      dragging = true; divider.setPointerCapture(event.pointerId); event.preventDefault(); setControls(true);
    });
    divider.addEventListener('pointermove', event => {
      if (!dragging) return;
      const bounds = $('.workspace-panes').getBoundingClientRect();
      const stacked = shell.classList.contains('is-stacked');
      model.ratio = (stacked ? (event.clientY - bounds.top) / bounds.height : (event.clientX - bounds.left) / bounds.width) * 100;
      resize();
    });
    ['pointerup','pointercancel','lostpointercapture'].forEach(type => divider.addEventListener(type, () => { dragging = false; setControls(true); }));
    divider.addEventListener('keydown', event => {
      if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      model.ratio = event.key === 'Home' ? 0 : event.key === 'End' ? 100 : model.ratio + (['ArrowLeft','ArrowUp'].includes(event.key) ? -5 : 5);
      resize(); setControls(true, true);
    });
    new ResizeObserver(resize).observe($('.workspace-panes'));
    window.addEventListener('resize', resize);
    document.getElementById('frameSplitScreen')?.addEventListener('click', () => showPicker('split'));
    setInterval(() => { const now = performance.now(); views.forEach(view => view.tick?.(now)); }, 100);
    renderLayout(); setControls(false);
  }

  function update(data, { connected = true } = {}) {
    latest = data || latest; offline = !connected;
    // Native modal dialogs sit above the privacy cover regardless of z-index.
    if (isSuspended() && picker.open) picker.close();
    blocked = Boolean(bridge.isBlocked?.() || picker.open || document.getElementById('frameAppsDialog')?.open || isSuspended());
    model.update(latest, performance.now(), { connected, blocked });
    renderLayout(); updateViews(); renderIsland();
    window.DashFrame?.setWorkspace?.({ split: model.mode === 'split', visibleApps: model.panes.map(pane => pane.appId) });
    window.DashFrame?.syncRotationPause();
    shell.inert = blocked && !picker.open;
    bridge.onChange?.();
  }

  window.DashWorkspace = {
    init, update, open, home, resize, showPicker,
    showControls: () => setControls(true, true),
    isActive: () => model.mode !== 'home', isPhotoVisible: photoVisible,
    isDialogOpen: () => Boolean(picker?.open), getState: () => model,
    getData: () => latest
  };
})();
