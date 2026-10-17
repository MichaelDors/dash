(function () {
  'use strict';

  const baseball = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M5 6c7 2 7 10 0 12M19 6c-7 2-7 10 0 12"/></svg>';
  const chevron = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>';
  const clampCount = (value, max) => Math.min(max, Math.max(0, Number(value) || 0));
  const score = value => value == null || !Number.isFinite(Number(value)) ? '—' : String(Math.max(0, Math.trunc(Number(value))));
  const text = (root, selector, value) => {
    const node = root.querySelector(selector);
    const next = String(value ?? '');
    if (node && node.textContent !== next) node.textContent = next;
  };
  let chromeTimer;
  let activeView;

  function setControls(view, visible, keyboard = false) {
    clearTimeout(chromeTimer);
    const overlay = view.closest('.app-overlay-view');
    overlay?.classList.toggle('sports-controls-visible', visible);
    const controls = [overlay?.querySelector('.overlay-header'), ...view.querySelectorAll('.sports-toolbar,.sports-games-section,.sports-footer')];
    controls.forEach(node => { if (node) node.inert = !visible; });
    const reveal = view.querySelector('.sports-reveal');
    reveal.setAttribute('aria-expanded', String(visible));
    reveal.setAttribute('aria-label', visible ? 'Game controls visible. Tap to hide controls.' : 'Show game controls');
    if (!visible && controls.some(node => node?.contains(document.activeElement))) reveal.focus({ preventScroll: true });
    if (visible && !view.closest('#workspaceRoot') && view.classList.contains('has-game')) {
      chromeTimer = setTimeout(() => {
        if (keyboard && controls.some(node => node?.contains(document.activeElement))) setControls(view, true, true);
        else setControls(view, false);
      }, 4000);
    }
  }

  function deactivate() {
    clearTimeout(chromeTimer);
    const overlay = activeView?.closest('.app-overlay-view');
    if (overlay) {
      overlay.classList.remove('sports-controls-visible');
      const header = overlay.querySelector('.overlay-header');
      if (header) header.inert = false;
    }
    activeView = null;
  }

  function timeLabel(game, config, includeZone = false) {
    if (!game.start_time) return 'Time TBD';
    const date = new Date(game.start_time);
    if (!Number.isFinite(date.getTime())) return 'Time TBD';
    const options = { hour: 'numeric', minute: '2-digit', ...(includeZone ? { timeZoneName: 'short' } : {}) };
    try { return date.toLocaleTimeString('en-US', { ...options, timeZone: config.timezone || 'America/New_York' }); }
    catch (_) { return date.toLocaleTimeString('en-US', options); }
  }

  function statusLabel(game, config) {
    if (game.status === 'live') {
      const half = String(game.inning_half || '').toLowerCase();
      const label = ({ top: 'Top', bottom: 'Bottom', middle: 'Mid', end: 'End' })[half];
      return game.inning && label ? `${label} ${game.inning}` : game.status_text || 'In progress';
    }
    if (game.status === 'scheduled') return timeLabel(game, config);
    return game.status_text || ({ final: 'Final', postponed: 'Postponed', suspended: 'Suspended', cancelled: 'Cancelled' })[game.status] || 'Game day';
  }

  function logoMarkup() {
    return '<span class="sports-logo"><span class="sports-logo-fallback" aria-hidden="true"></span><img alt="" hidden /></span>';
  }

  function teamMarkup(side) {
    return `<section class="sports-team sports-team-${side}" aria-label="${side === 'away' ? 'Away' : 'Home'} team">
      <span class="sports-eyebrow sports-side-label">${side === 'away' ? 'Away' : 'Home'}</span>
      ${logoMarkup()}
      <span class="sports-team-abbr"></span><h3 class="sports-team-name"></h3>
      <span class="sports-team-record"></span><strong class="sports-score"></strong>
    </section>`;
  }

  function updateLogo(root, team) {
    const logo = root.querySelector('.sports-logo');
    const img = logo.querySelector('img');
    text(logo, '.sports-logo-fallback', team.abbreviation || 'MLB');
    const id = Number(team.id);
    // Only official numeric MLB team IDs can become external image URLs.
    const src = Number.isSafeInteger(id) && id > 0 ? `https://www.mlbstatic.com/team-logos/${id}.svg` : '';
    if ((img.dataset.logoSrc || '') === src) return;
    img.dataset.logoSrc = src;
    img.hidden = true;
    logo.classList.remove('is-loaded');
    img.onload = () => { img.hidden = false; logo.classList.add('is-loaded'); };
    img.onerror = () => { img.hidden = true; logo.classList.remove('is-loaded'); };
    if (src) img.src = src;
    else img.removeAttribute('src');
  }

  function mount(host, sendAction) {
    host.innerHTML = `<div class="sports-view">
      <button type="button" class="sports-reveal" aria-label="Show game controls" aria-expanded="false"></button>
      <div class="sports-toolbar"><div class="sports-league">${baseball}<span>MLB</span><span class="sports-toolbar-divider"></span><span class="sports-date"></span></div><a class="sports-settings-link" href="/#sports-settings">Preferences <span aria-hidden="true">↗</span></a></div>
      <p class="sports-notice" role="status" hidden></p>
      <div class="sports-empty" hidden>${baseball}<h3></h3><p></p><a href="/#sports-settings">Choose your teams <span aria-hidden="true">↗</span></a></div>
      <article class="sports-scoreboard" aria-label="Selected baseball game" hidden>
        <div class="sports-game-meta"><span class="sports-game-status"></span><span class="sports-game-number"></span></div>
        <div class="sports-matchup">${teamMarkup('away')}
          <div class="sports-situation"><span class="sports-eyebrow sports-game-kicker"></span><strong class="sports-game-phase"></strong>
            <div class="sports-live-details"><div class="sports-bases" role="img"><span data-base="second"></span><span data-base="third"></span><span data-base="first"></span></div>
              <div class="sports-outs" aria-label="Outs"><span></span><span></span><span></span></div><span class="sports-out-label"></span>
              <div class="sports-count"><span><b class="sports-balls"></b> BALLS</span><span><b class="sports-strikes"></b> STRIKES</span></div>
            </div><p class="sports-game-detail"></p>
          </div>${teamMarkup('home')}
        </div><div class="sports-venue"></div>
      </article>
      <section class="sports-games-section" aria-label="Games on this date"><div class="sports-games-heading"><div><span class="sports-eyebrow">THE SCOREBOARD</span><h3 class="sports-games-label"></h3></div><div class="sports-game-nav"><button type="button" data-sports-prev aria-label="Previous game">${chevron}</button><button type="button" data-sports-next aria-label="Next game">${chevron}</button></div></div><div class="sports-games" role="group" aria-label="Choose a game"></div></section>
      <footer class="sports-footer"><span class="sports-feed-label"></span><span>Scores from MLB</span></footer>
      <span class="sports-preview-prompt" hidden>Following live · Tap for game controls</span>
      <span class="sports-announcement" role="status" aria-live="polite" aria-atomic="true"></span>
    </div>`;
    const view = host.querySelector('.sports-view');
    activeView = view;
    if (!view.closest('#workspaceRoot')) {
    view.querySelector('.sports-reveal').addEventListener('click', () => {
      setControls(view, !view.closest('.app-overlay-view').classList.contains('sports-controls-visible'));
    });
    view.addEventListener('pointerdown', event => {
      if (!event.target.closest('.sports-reveal')) setControls(view, true);
    });
    view.addEventListener('keydown', event => {
      if (event.key === 'Escape' && view.closest('.app-overlay-view').classList.contains('sports-controls-visible')) {
        event.preventDefault(); event.stopPropagation(); setControls(view, false); return;
      }
      setControls(view, true, true);
    });
    view.addEventListener('focusin', event => {
      if (!event.target.closest('.sports-reveal')) setControls(view, true, true);
    });
    view.addEventListener('wheel', () => setControls(view, true), { passive: true });
    view.querySelector('.sports-games').addEventListener('scroll', () => setControls(view, true), { passive: true });
    }
    view.querySelector('[data-sports-prev]').addEventListener('click', () => sendAction('sports_prev'));
    view.querySelector('[data-sports-next]').addEventListener('click', () => sendAction('sports_next'));
    view.querySelector('.sports-games').addEventListener('click', event => {
      const button = event.target.closest('[data-game-id]');
      if (button) sendAction('sports_select', { game_id: Number(button.dataset.gameId) });
    });
    setControls(view, false);
    return view;
  }

  function updateTeam(view, side, team, opponent, game) {
    const root = view.querySelector(`.sports-team-${side}`);
    updateLogo(root, team);
    text(root, '.sports-team-abbr', team.abbreviation || 'TBD');
    text(root, '.sports-team-name', team.name || 'Team to be decided');
    text(root, '.sports-score', score(team.score));
    const record = typeof team.record === 'string' ? team.record : team.record && typeof team.record === 'object' ? `${team.record.wins ?? 0}–${team.record.losses ?? 0}` : '';
    text(root, '.sports-team-record', record);
    root.classList.toggle('is-winner', game.status === 'final' && team.score != null && opponent.score != null && team.score > opponent.score);
    const color = /^#[0-9a-f]{6}$/i.test(team.color) ? team.color : '#617b87';
    view.style.setProperty(`--sports-${side}-color`, color);
  }

  function renderGames(view, games, selectedId, config, stale) {
    const list = view.querySelector('.sports-games');
    const keys = new Set();
    games.forEach((game, index) => {
      const id = String(game.id);
      keys.add(id);
      let button = [...list.children].find(node => node.dataset.gameId === id);
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'sports-game-card';
        button.dataset.gameId = id;
        button.innerHTML = '<span class="sports-card-status"></span><span class="sports-card-team sports-card-away">' + logoMarkup() + '<span class="sports-card-abbr"></span><b></b></span><span class="sports-card-team sports-card-home">' + logoMarkup() + '<span class="sports-card-abbr"></span><b></b></span>';
      }
      if (list.children[index] !== button) list.insertBefore(button, list.children[index] || null);
      const selected = String(selectedId) === id;
      button.classList.toggle('is-selected', selected);
      button.classList.toggle('is-live', game.status === 'live' && !stale);
      button.setAttribute('aria-pressed', String(selected));
      text(button, '.sports-card-status', statusLabel(game, config));
      ['away', 'home'].forEach(side => {
        const team = game[side] || {};
        const row = button.querySelector(`.sports-card-${side}`);
        updateLogo(row, team);
        text(row, '.sports-card-abbr', team.abbreviation || 'TBD');
        text(row, 'b', score(team.score));
      });
      button.setAttribute('aria-label', `${game.away?.name || 'Away'} ${score(game.away?.score)}, ${game.home?.name || 'Home'} ${score(game.home?.score)}. ${statusLabel(game, config)}${game.doubleheader && game.doubleheader !== 'N' ? `. Game ${game.game_number || 1}` : ''}`);
    });
    [...list.children].forEach(button => {
      if (!keys.has(button.dataset.gameId)) {
        const focused = document.activeElement === button;
        button.remove();
        if (focused) list.querySelector('button')?.focus({ preventScroll: true });
      }
    });
    // Bring a newly selected game into the strip without scrolling the page.
    if (view.dataset.selectedId !== String(selectedId)) {
      view.dataset.selectedId = String(selectedId);
      const selected = list.querySelector('.is-selected');
      if (selected && !list.contains(document.activeElement)) {
        list.scrollLeft = selected.offsetLeft - list.offsetLeft - (list.clientWidth - selected.offsetWidth) / 2;
      }
    }
  }

  function render(host, payload, sendAction) {
    const view = host.querySelector('.sports-view') || mount(host, sendAction);
    activeView = view;
    const data = payload || {};
    const config = data.config || {};
    const stale = !!(data.stale || data.error);
    const games = Array.isArray(data.games) ? data.games : [];
    const game = data.selected_game || games.find(item => String(item.id) === String(data.selected_game_id)) || games[0];
    view.classList.toggle('has-game', !!game);
    view.classList.toggle('is-preview', !!data.preview);
    view.querySelector('.sports-preview-prompt').hidden = !data.preview;
    if (!game && !view.closest('#workspaceRoot')) setControls(view, true);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(data.date || '') ? new Date(`${data.date}T12:00:00Z`) : new Date();
    text(view, '.sports-date', date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(data.date ? { timeZone: 'UTC' } : {}) }));
    const notice = view.querySelector('.sports-notice');
    notice.hidden = !stale;
    text(view, '.sports-notice', data.connection_lost ? game ? 'Connection to Dash was lost. Showing the last available scores.' : 'Connection to Dash was lost. Reconnecting automatically.' : game ? 'Score updates are temporarily unavailable. Showing the last available scores.' : 'We couldn’t reach MLB. Scores will refresh automatically.');
    const empty = view.querySelector('.sports-empty');
    empty.hidden = !!game;
    view.querySelector('.sports-scoreboard').hidden = !game;
    const isLoading = !payload || data.loading;
    text(empty, 'h3', isLoading ? 'Getting the scoreboard ready' : data.error ? 'Scores are taking a break' : 'No games on the schedule');
    text(empty, 'p', isLoading ? 'The latest from around the league will appear here.' : data.connection_lost ? 'The scoreboard will return when your device reconnects.' : data.error ? 'The scoreboard will return as soon as MLB is available again.' : config.favorites_only ? 'Your favorite teams aren’t playing today. Check back later or follow more teams in Preferences.' : 'A quiet day at the ballpark. Check back on the next game day.');
    empty.querySelector('a').hidden = !!isLoading;
    view.querySelector('.sports-games-section').hidden = !games.length;
    text(view, '.sports-games-label', `${games.length} ${games.length === 1 ? 'game' : 'games'}${config.favorites_only ? ' · Your teams' : ' · Around the league'}`);
    view.querySelector('[data-sports-prev]').disabled = games.length < 2;
    view.querySelector('[data-sports-next]').disabled = games.length < 2;
    let updatedLabel = isLoading ? 'Updating scores…' : 'Refreshes automatically';
    if (stale) updatedLabel = 'Waiting for fresh scores';
    else if (data.watching_game) updatedLabel = 'Watching this game';
    else if (config.auto_rotate && games.length > 1) updatedLabel = `Rotating games every ${Math.max(5, Number(config.rotation_seconds) || 15)}s`;
    text(view, '.sports-feed-label', updatedLabel);
    renderGames(view, games, game?.id, config, stale);
    if (!game) return;

    updateTeam(view, 'away', game.away || {}, game.home || {}, game);
    updateTeam(view, 'home', game.home || {}, game.away || {}, game);
    const live = game.status === 'live';
    const scheduled = game.status === 'scheduled';
    text(view, '.sports-game-status', live ? stale ? 'LAST SCORE' : 'LIVE' : game.status === 'final' ? 'FINAL' : scheduled ? 'UPCOMING' : game.status_text || 'GAME DAY');
    view.querySelector('.sports-game-status').classList.toggle('is-live', live && !stale);
    text(view, '.sports-game-number', game.doubleheader && game.doubleheader !== 'N' ? `Doubleheader · Game ${game.game_number || 1}` : '');
    text(view, '.sports-game-kicker', live ? stale ? 'LAST INNING' : 'INNING' : scheduled ? 'FIRST PITCH' : game.status === 'final' ? 'BOX SCORE' : 'STATUS');
    text(view, '.sports-game-phase', statusLabel(game, config));
    view.querySelector('.sports-live-details').hidden = !live;
    text(view, '.sports-game-detail', scheduled ? timeLabel(game, config, true) : game.status === 'final' ? Number(game.inning) > 9 ? `${game.inning} innings` : 'Game complete' : live ? game.status_text && !/in progress/i.test(game.status_text) ? game.status_text : '' : 'Check back for updates');
    const outs = clampCount(game.outs, 3);
    [...view.querySelector('.sports-outs').children].forEach((dot, index) => dot.classList.toggle('is-active', index < outs));
    text(view, '.sports-out-label', `${outs} ${outs === 1 ? 'out' : 'outs'}`);
    text(view, '.sports-balls', clampCount(game.balls, 4));
    text(view, '.sports-strikes', clampCount(game.strikes, 3));
    const occupied = [];
    ['first', 'second', 'third'].forEach(base => {
      const active = !!game.bases?.[base];
      view.querySelector(`[data-base="${base}"]`).classList.toggle('is-active', active);
      if (active) occupied.push(base);
    });
    view.querySelector('.sports-bases').setAttribute('aria-label', occupied.length ? `Runners on ${occupied.join(' and ')} base` : 'Bases empty');
    text(view, '.sports-venue', typeof game.venue === 'string' ? game.venue : game.venue?.name || '');
    text(view, '.sports-announcement', `${game.away?.name || 'Away'} ${score(game.away?.score)}, ${game.home?.name || 'Home'} ${score(game.home?.score)}. ${statusLabel(game, config)}.`);
  }

  window.DashSports = { render, deactivate, setControls(visible) { if (activeView) setControls(activeView, visible); }, showControls() { if (activeView) setControls(activeView, true, true); } };
})();
