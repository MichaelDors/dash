(function (root) {
  'use strict';
  const priority = ['spotify', 'sports', 'timer'];

  class ActivityTracker {
    constructor() { this.sessions = new Map(); this.initialized = new Set(); this.sequence = 0; }
    update(data, now, connected = true) {
      if (!connected) { this.lastNow = now; return this.sessions; }
      const elapsed = this.lastNow == null ? 0 : Math.max(0, now - this.lastNow);
      this.lastNow = now;
      for (const appId of priority) {
        const old = this.sessions.get(appId);
        let next = null;
        if (appId === 'spotify') {
          const music = data.apps?.spotify || data.widgets?.spotify;
          if (!music || typeof music.is_playing !== 'boolean') continue;
          if (music.is_playing && music.track_name) {
            next = old || this.create(appId);
            next.played = Math.min(300000, (next.played || 0) + (old?.playing ? elapsed : 0));
            next.pausedAt = null; next.playing = true; next.data = music;
          } else if (old) {
            next = old; next.playing = false; next.data = music;
            next.pausedAt ??= now;
            if (now - next.pausedAt >= Math.max(5000, next.played || 0)) next = null;
          }
        } else if (appId === 'sports') {
          const sports = data.apps?.sports;
          if (!sports || sports.stale || sports.error || sports.loading) continue;
          if (sports.config?.auto_preview !== false) {
            const game = sports.games?.find(game => game.id === old?.gameId);
            // An omitted game or unknown status is not confirmation that it ended.
            const ended = game && ['final', 'postponed', 'cancelled', 'suspended'].includes(game.status);
            if (old && !ended) {
              next = old;
              if (game) next.data = game;
            }
            const current = next ? null : sports.live_followed_games?.find(game => game.status === 'live');
            if (current) {
              next = old?.gameId === current.id ? old : this.create(appId, `sports:${current.id}`);
              next.gameId = current.id; next.data = current;
            }
          }
        } else {
          const timer = data.widgets?.timer;
          if (!timer || typeof timer.running !== 'boolean') continue;
          const remaining = Number(timer.minutes) * 60 + Number(timer.seconds);
          if (timer.running) { next = old || this.create(appId); next.doneAt = null; }
          else if (old && remaining === 0) {
            next = old; next.doneAt ??= now;
            if (now - next.doneAt >= 3000) next = null;
          } else if (old && remaining > 0 && !(remaining >= timer.set_minutes * 60 && old.remaining < remaining)) next = old;
          if (next) { next.data = timer; next.remaining = remaining; }
        }
        if (!this.initialized.has(appId)) {
          this.initialized.add(appId);
          if (next) { next.homeHeld = true; next.pending = false; }
        }
        if (next) this.sessions.set(appId, next);
        else this.sessions.delete(appId);
      }
      return this.sessions;
    }
    create(appId, key) {
      const order = ++this.sequence;
      return { appId, key: key || `${appId}:${order}`, order, pending: true, dismissed: false, homeHeld: false };
    }
    sorted() { return [...this.sessions.values()].sort((a, b) => a.order - b.order); }
  }

  class WorkspaceState {
    constructor() { this.tracker = new ActivityTracker(); this.panes = []; this.parked = null; this.ratio = 50; this.focused = 0; }
    get mode() { return this.panes.length === 2 ? 'split' : this.panes.length ? 'single' : 'home'; }
    session(appId) { return this.tracker.sessions.get(appId); }
    pane(appId, automatic = false) {
      const session = this.session(appId);
      return { appId, automatic, key: automatic ? session?.key : null, gameId: session?.gameId };
    }
    update(data, now, { connected = true, blocked = false } = {}) {
      this.tracker.update(data, now, connected);
      if (blocked || !connected) return;
      const previous = this.panes;
      this.panes = previous.filter(pane => !pane.automatic || this.session(pane.appId)?.key === pane.key);
      if (previous.length === 2 && this.panes.length === 1 && this.panes[0].appId === 'clock') { this.home(); return; }
      if (previous.length === 2 && this.panes.length === 1) this.focused = 0;
      if (previous.length && !this.panes.length) this.promote();
      if (!this.panes.length) {
        const next = this.tracker.sorted().find(session => session.pending && !session.dismissed && !session.homeHeld);
        if (next) { this.panes = [this.pane(next.appId, true)]; next.pending = false; }
      }
      if (this.panes.length) this.tracker.sorted().forEach(session => { session.pending = false; });
    }
    promote() {
      const next = this.tracker.sorted().find(session => !session.dismissed && !session.homeHeld);
      if (next) this.panes = [this.pane(next.appId, true)];
      else if (this.parked) { this.panes = [this.parked]; this.parked = null; }
    }
    home() {
      this.tracker.sorted().forEach(session => { session.homeHeld = true; session.pending = false; });
      this.panes = []; this.parked = null; this.focused = 0; this.ratio = 50;
    }
    open(appId, index = null) {
      if (appId === 'clock' && index == null) { this.home(); return; }
      const existing = this.panes.findIndex(pane => pane.appId === appId);
      if (existing >= 0) { this.focused = existing; this.manual(existing); return; }
      const session = this.session(appId);
      if (session) { session.dismissed = false; session.homeHeld = false; session.pending = false; }
      if (this.parked?.appId === appId) this.parked = null;
      if (index != null && this.panes[index]) this.panes[index] = this.pane(appId);
      else this.panes = appId === 'clock' ? [] : [this.pane(appId)];
      this.focused = index == null ? 0 : index;
    }
    split(appId) {
      if (!this.panes.length) this.panes = [this.pane('clock')];
      if (this.panes.some(pane => pane.appId === appId)) return;
      const session = this.session(appId);
      if (session) { session.dismissed = false; session.homeHeld = false; session.pending = false; }
      this.panes = [this.panes[0], this.pane(appId)]; this.ratio = 50; this.focused = 1;
    }
    expand(index) {
      const keep = this.panes[index];
      if (!keep) return;
      if (keep.appId === 'clock') { this.home(); return; }
      this.panes = [keep]; this.focused = 0;
    }
    close(index) {
      const pane = this.panes[index];
      if (!pane) return;
      const session = this.session(pane.appId);
      if (session) { session.dismissed = true; session.pending = false; }
      this.panes.splice(index, 1); this.focused = 0;
      if (!this.panes.length) this.promote();
      if (this.panes.length === 1 && this.panes[0].appId === 'clock') this.home();
    }
    background() {
      const visible = new Set(this.panes.map(pane => pane.appId));
      const items = this.tracker.sorted().filter(session => !session.dismissed && !visible.has(session.appId));
      if (this.parked && !visible.has(this.parked.appId) && !items.some(item => item.appId === this.parked.appId)) items.push({ ...this.parked, key: `manual:${this.parked.appId}`, manual: true });
      return items;
    }
    swap(appId) {
      const session = this.session(appId);
      const index = Math.min(this.focused, this.panes.length - 1);
      const previous = this.panes[index];
      if (previous && previous.appId !== 'clock' && !this.session(previous.appId)) this.parked = { ...previous };
      else if (this.parked?.appId === appId) this.parked = null;
      if (session) { session.dismissed = false; session.homeHeld = false; session.pending = false; }
      const next = this.pane(appId, Boolean(session));
      if (index >= 0) this.panes[index] = next;
      else this.panes = [next];
    }
    dismiss(appId) {
      const session = this.session(appId);
      if (session) { session.dismissed = true; session.pending = false; }
      if (this.parked?.appId === appId) this.parked = null;
    }
    manual(index) { if (this.panes[index]) { this.panes[index].automatic = false; this.panes[index].key = null; } }
  }

  root.DashWorkspaceState = { ActivityTracker, WorkspaceState };
  if (typeof module !== 'undefined') module.exports = root.DashWorkspaceState;
})(typeof window === 'undefined' ? globalThis : window);
