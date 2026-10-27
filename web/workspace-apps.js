(function () {
  'use strict';
  const definitions = [
    { id: 'clock', name: 'Photo Clock', icon: '◷', detail: 'Your photos, time & weather' },
    { id: 'spotify', name: 'Music', icon: '♫', detail: 'Spotify playback' },
    { id: 'sports', name: 'Sports', icon: '⚾', detail: 'MLB & NBA scoreboard' },
    { id: 'timer', name: 'Timer', icon: '◴', detail: 'Countdown & controls' },
    { id: 'weather', name: 'Weather', icon: '☀', detail: 'Local conditions' },
    { id: 'click_counter', name: 'Counter', icon: '+', detail: 'Keep a tally' },
    { id: 'photo', name: 'OLED Photo', icon: '▧', detail: 'Your display image' },
    { id: 'motion_status', name: 'System Status', icon: '☷', detail: 'Device diagnostics' }
  ];
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const setText = (root, selector, value) => window.DashValueMotion.setText(root.querySelector(selector), value);
  function setImage(image, url) {
    let safe = '';
    try { const parsed = new URL(url, location.href); if (['http:', 'https:'].includes(parsed.protocol) || /^data:image\//.test(url)) safe = url; } catch (_) {}
    if (!url) safe = '';
    if (safe && image.getAttribute('src') !== safe) { image.hidden = false; image.src = safe; }
    if (!safe) { image.hidden = true; image.removeAttribute('src'); }
  }

  function mount(host, appId, context) {
    if (appId === 'spotify') return window.DashWorkspaceMusic.create(host, context);
    const definition = definitions.find(app => app.id === appId);
    const root = document.createElement('section');
    root.className = `workspace-app ws-${appId}`;
    root.setAttribute('aria-label', definition?.name || appId);
    const abort = new AbortController();
    const on = (target, type, listener, options = {}) => target?.addEventListener(type, listener, { ...options, signal: abort.signal });
    let update = () => {};
    let uploadStatus = '';
    let sportsGameId = context.gameId || null;
    let clean = () => {};
    let controlsVisible = false, sportsHasGame = false;
    const action = (name, params) => context.sendAction(name, params || {});
    if (appId === 'sports') {
      root.classList.add('app-overlay-view', 'sports-active');
      root.innerHTML = '<div class="workspace-sports-content overlay-content"></div>';
      const content = root.firstElementChild;
      update = data => {
        let payload = data.apps?.sports;
        const tracked = context.getActivity?.();
        const watched = payload?.games?.find(game => game.id === sportsGameId);
        const retained = tracked?.gameId === sportsGameId && !watched ? tracked.data : null;
        const game = watched || retained || payload?.selected_game || payload?.games?.[0];
        sportsHasGame = Boolean(game);
        if (retained) payload = { ...payload, games: [retained, ...(payload?.games || [])], stale: true };
        if (game) { sportsGameId = game.id; payload = { ...payload, selected_game: game, selected_game_id: game.id, watching_game: true, preview: Boolean(context.isAutomatic?.()) }; }
        if (context.isOffline()) payload = { ...payload, stale: true, error: 'device_offline', connection_lost: true };
        if (window.DashSports) window.DashSports.render(content, payload, (name, params = {}) => {
          const games = context.getData()?.apps?.sports?.games || [];
          const index = Math.max(0, games.findIndex(game => game.id === sportsGameId));
          sportsGameId = name === 'sports_select' ? params.game_id : games[(index + (name === 'sports_prev' ? -1 : 1) + games.length) % games.length]?.id;
          if (sportsGameId != null) { context.makeManual(); action('sports_select', { game_id: sportsGameId }); }
        });
        if (window.DashSports) window.DashSports.setControls(controlsVisible || !sportsHasGame);
        else content.innerHTML = '<p class="ws-empty">Sports is unavailable. Reconnect and restart Dash.</p>';
        if (!sportsHasGame && context.isFullscreen?.() && !controlsVisible) context.showControls();
      };
      clean = () => window.DashSports?.deactivate();
    } else if (appId === 'timer') {
      root.innerHTML = `<div class="workspace-legacy-content"><div class="fs-timer-container">
          <div class="fs-timer-display ws-timer-digits" id="fs-timer-text">00:00</div>
          <div class="fs-timer-actions">
            <button id="fsTimerToggle" data-action="timer_toggle" class="touch-btn btn-primary ws-timer-toggle" style="font-size:1.4rem; padding:1rem 2.5rem;">
              <i class="fa-solid fa-play"></i> 
            </button>
            <button class="touch-btn" id="fsTimerReset" data-action="timer_reset" style="font-size:1.4rem; padding:1rem 2.5rem;">
              <i class="fa-solid fa-rotate-left"></i> Reset
            </button>
          </div>
          <div class="ws-presets" style="display:flex; gap:1rem; margin-top:1rem;">
            <button class="touch-btn" id="fsT1" data-action="timer_sub_min">-1 Min</button>
            <button class="touch-btn" id="fsT2" data-action="timer_add_min">+1 Min</button>
            <button class="touch-btn" id="fsT5" data-minutes="5">5 Mins</button>
            <button class="touch-btn" id="fsT10" data-minutes="10">10 Mins</button>
            <button class="touch-btn" id="fsT25" data-minutes="25">25 Mins</button>
          </div>
        </div></div>`;
      on(root, 'click', event => { const el = event.target.closest('[data-minutes]'); if (el) action('timer_set_min', { minutes: Number(el.dataset.minutes) }); });
      update = data => { const timer = data.widgets?.timer || {}; setText(root, '.ws-timer-digits', timer.time_text || '05:00'); setText(root, '.ws-timer-status', timer.running ? 'Counting down' : timer.minutes === 0 && timer.seconds === 0 ? 'Time’s up' : 'Paused'); const toggle = root.querySelector('.ws-timer-toggle'); const label = timer.running ? 'Pause' : 'Start'; if(toggle.dataset.label!==label) {toggle.dataset.label=label;toggle.innerHTML=`<i class="fa-solid ${timer.running?'fa-pause':'fa-play'}" aria-hidden="true"></i> ${label}`;} root.classList.toggle('ws-timer-flash', Boolean(timer.flash)); };
    } else if (appId === 'weather') {
      root.innerHTML = `<div class="workspace-legacy-content"><div class="fs-counter-container">
          <span class="ws-weather-location" style="font-size:1.5rem; color:var(--text-muted);"><i class="fa-solid fa-location-dot"></i> <span class="ws-location-label"></span></span>
          <div class="ws-temperature" style="font-size:7rem; font-weight:800; font-family:var(--font-mono); color:#ffffff;"></div>
          <span class="ws-condition" style="font-size:2rem; font-weight:600; color:var(--accent-cyan);"></span>
        </div></div>`;
      update = data => { const weather = data.widgets?.weather || {}; setText(root, '.ws-location-label', weather.location || weather.location_query || 'Location Not Set'); setText(root, '.ws-temperature', weather.temperature_f == null ? '--' : `${Math.round(weather.temperature_f)}°F`); setText(root, '.ws-condition', weather.condition || 'Unknown'); setText(root, '.ws-weather-meta', weather.temperature_f == null ? '' : `Feels like ${Math.round(weather.apparent_f ?? weather.temperature_f)}° · Wind ${Math.round(weather.wind_mph || 0)} mph`); };
    } else if (appId === 'click_counter') {
      root.innerHTML = `<div class="workspace-legacy-content"><div class="fs-counter-container">
          <div class="fs-counter-digits ws-count"></div>
          <div class="fs-counter-pads">
            <button class="touch-btn counter-pad" id="fsCountMinus" data-action="counter_dec" style="background:#261414; border-color:#dc2626; color:#ef4444;">-1</button>
            <button class="touch-btn counter-pad" id="fsCountPlus" data-action="counter_inc" style="background:#0c242c; border-color:var(--accent-cyan); color:#fff;">+1</button>
          </div>
          <button class="touch-btn" id="fsCountReset" data-action="counter_reset" style="font-size:1.2rem; padding:0.8rem 2rem;"><i class="fa-solid fa-rotate-left"></i> Reset Counter</button>
        </div></div>`;
      update = data => setText(root, '.ws-count', data.widgets?.click_counter?.count ?? 0);
    } else if (appId === 'photo') {
      root.innerHTML = `<div class="workspace-legacy-content"><div class="ws-photo-view"><i class="fa-solid fa-image ws-photo-empty" style="font-size:4rem;color:var(--accent-cyan);" aria-hidden="true"></i><h2 class="ws-photo-empty">No Photo Uploaded</h2><img alt="Photo" hidden/><form id="fsPhotoForm" class="ws-photo-upload"><input id="fsPhotoInput" type="file" accept="image/*" aria-label="Upload OLED photo"/><button type="submit" class="touch-btn btn-primary">Upload Photo</button></form><p class="ws-photo-status" role="status"></p></div></div>`;
      on(root.querySelector('form'), 'submit', async event => {
        event.preventDefault();
        const file = root.querySelector('input').files?.[0]; if (!file) return;
        uploadStatus = 'Uploading photo…'; setText(root, '.ws-photo-status', uploadStatus);
        try {
          const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
          if (abort.signal.aborted) return;
          const response = await fetch('/api/photo/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: dataUrl }), signal: abort.signal });
          const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Upload failed'); uploadStatus = 'Photo saved.';
        } catch (error) { if (abort.signal.aborted) return; uploadStatus = error.message || 'Could not upload photo.'; }
        setText(root, '.ws-photo-status', uploadStatus);
      });
      update = data => { const photo = data.widgets?.photo || {}; const hasImage = Boolean(photo.has_image && photo.image_base64); setImage(root.querySelector('img'), hasImage ? `data:image/png;base64,${photo.image_base64}` : '');root.querySelector('.ws-photo-view').classList.toggle('has-image',hasImage);root.querySelectorAll('.ws-photo-empty').forEach(el=>{el.hidden=hasImage;});setText(root, '.ws-photo-status', uploadStatus); };
    } else if (appId === 'motion_status') {
      root.innerHTML = `<div class="workspace-legacy-content"><div style="display:flex; flex-direction:column; align-items:center; gap:2rem;">
          <h2 style="font-size:2rem;">System & Motion Diagnostics</h2>
          <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:1.5rem; width:100%; max-width:800px;">
            <div style="background:#0e121c; border:1px solid var(--border-card); padding:1.5rem; border-radius:16px; text-align:center;">
              <span style="color:var(--text-muted); font-size:0.9rem;">Display Mode</span>
              <h3 class="fs-motion-value ws-status-display" style="font-size:1.8rem; margin-top:0.5rem; color:var(--accent-cyan);"></h3>
            </div>
            <div style="background:#0e121c; border:1px solid var(--border-card); padding:1.5rem; border-radius:16px; text-align:center;">
              <span style="color:var(--text-muted); font-size:0.9rem;">Motion Sensor</span>
              <h3 class="fs-motion-value ws-status-motion" style="font-size:1.8rem; margin-top:0.5rem; color:var(--accent-green);"></h3>
            </div>
            <div style="background:#0e121c; border:1px solid var(--border-card); padding:1.5rem; border-radius:16px; text-align:center;">
              <span style="color:var(--text-muted); font-size:0.9rem;">Idle Time</span>
              <h3 class="fs-motion-value ws-status-idle" style="font-size:1.8rem; margin-top:0.5rem;"></h3>
            </div>
          </div>
          <button class="touch-btn btn-primary" id="fsSimulateMotion" data-action="simulate_motion" style="font-size:1.2rem; padding:1rem 2.5rem;"><i class="fa-solid fa-person-walking"></i> Simulate Motion Activity</button>
        </div></div>`;
      update = data => { setText(root, '.ws-status-display', data.display_mode || 'ON'); setText(root, '.ws-status-motion', data.motion?.motion_detected ? 'ACTIVE' : 'IDLE'); setText(root, '.ws-status-idle', data.motion?.idle || '00:00'); };
    }
    if (appId !== 'sports') {
      root.classList.add('app-overlay-view', 'is-visible', 'workspace-legacy-app');
      const header = document.createElement('header');
      header.className = 'overlay-header workspace-layout-header';
      header.setAttribute('aria-hidden', 'true'); header.inert = true;
      root.prepend(header);
      root.querySelector('.workspace-legacy-content').classList.add('overlay-content');
    }
    on(root, 'click', event => {
      const el = event.target.closest('[data-action]'); if (el && !el.disabled) action(el.dataset.action);
      if (event.target.closest('.ws-reveal')) context.showControls();
    });
    root.querySelectorAll('img').forEach(image => on(image, 'error', () => { image.hidden = true; }));
    return {
      root, mount() { host.appendChild(root); }, update,
      // App layouts use their containing pane's CSS size rather than window size.
      resize() {},
      keepControls() { return appId === 'sports' && !sportsHasGame && context.isFullscreen?.(); },
      setControls(visible) {
        controlsVisible = visible;
        root.classList.toggle('controls-visible', visible);
        root.querySelectorAll('.ws-app-controls').forEach(el => { el.inert = !visible; });
        if (appId === 'sports') window.DashSports?.setControls?.(visible || !sportsHasGame);
      },
      destroy() { abort.abort(); clean(); root.remove(); }
    };
  }
  window.DashWorkspaceApps = { definitions, mount, escape };
})();
