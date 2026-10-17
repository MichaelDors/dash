(function () {
  "use strict";

  let state = {
    activeOverlayApp: null,
    settingsOpen: false,
    settingsSubpage: "main",
    latestData: null
  };

  // DOM Elements
  const elAppOverlayView = document.getElementById("appOverlayView");
  const elOverlayContent = document.getElementById("appOverlayContent");
  const elOverlayAppTitle = document.getElementById("overlayAppTitle");
  const elOverlayAppSubtitle = document.getElementById("overlayAppSubtitle");
  const elBtnBackToDash = document.getElementById("btnBackToDash");

  // Settings Overlay Elements
  const elSettingsOverlayView = document.getElementById("settingsOverlayView");
  const elBtnOpenSettings = document.getElementById("btnOpenSettings");
  const elBtnCloseSettings = document.getElementById("btnCloseSettings");

  // Settings Metrics & Actions
  const elCfgDisplayState = document.getElementById("cfgDisplayState");
  const elCfgMotionState = document.getElementById("cfgMotionState");
  const elCfgIpAddress = document.getElementById("cfgIpAddress");
  const elCfgSoftwareVersion = document.getElementById("cfgSoftwareVersion");
  const elCfgSpotifyStatus = document.getElementById("cfgSpotifyStatus");
  const elBtnSimulateMotion = document.getElementById("btnSimulateMotion");
  const elBtnUpdateSoftware = document.getElementById("btnUpdateSoftware");
  const elBtnRestartDevice = document.getElementById("btnRestartDevice");
  const elBtnShutdownDevice = document.getElementById("btnShutdownDevice");
  const elCfgSpotifyForm = document.getElementById("cfgSpotifyForm");
  const elCfgWeatherForm = document.getElementById("cfgWeatherForm");

  // Connection state management
  let failedFetchCount = 0;
  let isOffline = false;
  let isFetchingState = false;
  let lastSuccessfulFetchTime = Date.now();
  let lastClockChangeTime = Date.now();

  function showConnectionLostOverlay() {
    isOffline = true;
    window.DashFrame?.setConnection(false);
  }
  function hideConnectionLostOverlay() {
    isOffline = false;
    failedFetchCount = 0;
    window.DashFrame?.setConnection(true);
  }
  function checkConnectionWatchdog() {
    if (window.location.protocol === "file:") return;
    const now = Date.now();
    const timeSinceLastFetch = now - lastSuccessfulFetchTime;
    const timeSinceLastClockChange = now - lastClockChangeTime;

    // Show searching/connection lost overlay immediately if:
    // 1. Fetch hasn't succeeded in > 2.0 seconds
    // 2. Clock/data hasn't ticked/changed in > 2.0 seconds
    // 3. Any fetch failure occurs (failedFetchCount >= 1)
    if (timeSinceLastFetch > 2000 || timeSinceLastClockChange > 2000 || failedFetchCount >= 1) {
      showConnectionLostOverlay();
    }
  }

  const CLOSE_TRANSITION_MS = 320;
  const surfaceTimers = new WeakMap();

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function revealSurface(el) {
    if (!el) return;
    const pendingTimer = surfaceTimers.get(el);
    if (pendingTimer) {
      window.clearTimeout(pendingTimer);
      surfaceTimers.delete(el);
    }
    el.classList.remove("hidden", "is-closing");
    el.classList.add("is-opening");
    requestAnimationFrame(() => {
      el.classList.remove("is-opening");
      el.classList.add("is-visible");
    });
  }

  function concealSurface(el, afterHidden) {
    if (!el) {
      if (afterHidden) afterHidden();
      return;
    }

    if (el.classList.contains("hidden")) {
      el.classList.remove("is-visible", "is-closing", "is-opening");
      if (afterHidden) afterHidden();
      return;
    }

    el.classList.remove("is-visible", "is-opening");
    el.classList.add("is-closing");

    const timer = window.setTimeout(() => {
      el.classList.add("hidden");
      el.classList.remove("is-closing");
      surfaceTimers.delete(el);
      if (afterHidden) afterHidden();
    }, prefersReducedMotion() ? 0 : CLOSE_TRANSITION_MS);
    surfaceTimers.set(el, timer);
  }

  // Initialize App
  function init() {
    window.DashFrame?.init({ openApp: openOverlayApp, openSettings: openSettingsOverlay, sendAction, isOverlayOpen: () => Boolean(state.activeOverlayApp) || state.settingsOpen || (window.DashWorkspace?.isPhotoVisible() === false) });
    window.DashWorkspace?.init({ sendAction, openSettings: openSettingsOverlay, openPhotos: () => openOverlayApp('photos'), isBlocked: () => Boolean(state.activeOverlayApp) || state.settingsOpen });
    setupEventListeners();
    fetchState();
    setInterval(fetchState, 250);
    setInterval(checkConnectionWatchdog, 250);
  }

  // Setup Event Listeners
  function setupEventListeners() {
    // Global auto-blur for buttons on tablet touch/click to prevent sticky selection state
    const autoUnselectButton = (e) => {
      const btn = e.target.closest("button, .touch-btn, .mini-ctrl-btn, .fs-ctrl-btn, .icon-touch-btn");
      if (btn && e.detail !== 0) {
        btn.blur();
      }
    };
    document.addEventListener("click", autoUnselectButton);
    document.addEventListener("touchend", (e) => {
      autoUnselectButton(e);
      setTimeout(() => autoUnselectButton(e), 50);
    }, { passive: true });

    // Back from full screen app overlay
    if (elBtnBackToDash) {
      elBtnBackToDash.addEventListener("click", () => {
        closeOverlayApp();
      });
    }

    // Settings overlay triggers
    if (elBtnOpenSettings) elBtnOpenSettings.addEventListener("click", openSettingsOverlay);
    if (elBtnCloseSettings) elBtnCloseSettings.addEventListener("click", closeSettingsOverlay);
    document.getElementById("btnOpenFrameSettings")?.addEventListener("click", () => {
      state.settingsSubpage = "main";
      closeSettingsOverlay();
      openOverlayApp("photos");
    });
    document.getElementById("btnOpenOledPhoto")?.addEventListener("click", () => {
      state.settingsSubpage = "main";
      closeSettingsOverlay();
      openOverlayApp("photo");
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        if (document.getElementById("frameAppsDialog")?.open) return;
        if (state.settingsOpen) closeSettingsOverlay();
        else if (state.activeOverlayApp) closeOverlayApp();
      }
      if (event.key === "Tab") {
        const surface = state.settingsOpen ? elSettingsOverlayView : state.activeOverlayApp ? elAppOverlayView : null;
        if (!surface) return;
        const buttons = [...surface.querySelectorAll('button, a[href], input, select, [tabindex="0"]')].filter(el => !el.disabled && el.getClientRects().length && getComputedStyle(el).visibility !== "hidden");
        if (!buttons.length) return;
        if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons[buttons.length - 1].focus(); }
        else if (!event.shiftKey && document.activeElement === buttons[buttons.length - 1]) { event.preventDefault(); buttons[0].focus(); }
      }
    });

    // OLED Settings Subpage Navigation
    const btnOpenOled = document.getElementById("btnOpenOledSubpage");
    if (btnOpenOled) {
      btnOpenOled.addEventListener("click", () => showSettingsSubpage("oled"));
      btnOpenOled.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          showSettingsSubpage("oled");
        }
      });
    }

    const btnBackToMain = document.getElementById("btnBackToMainSettings");
    if (btnBackToMain) {
      btnBackToMain.addEventListener("click", () => showSettingsSubpage("main"));
    }

    // Hardware OLED Settings Controls
    const rangeMaxBright = document.getElementById("cfgMaxBrightnessRange");
    const valMaxBright = document.getElementById("cfgMaxBrightnessVal");
    if (rangeMaxBright) {
      rangeMaxBright.addEventListener("input", (e) => {
        const v = e.target.value;
        if (valMaxBright) valMaxBright.textContent = `${v}%`;
      });
      rangeMaxBright.addEventListener("change", (e) => {
        sendAction("set_max_brightness", { value: parseInt(e.target.value, 10) });
      });
    }

    const rangeDimBright = document.getElementById("cfgDimBrightnessRange");
    const valDimBright = document.getElementById("cfgDimBrightnessVal");
    if (rangeDimBright) {
      rangeDimBright.addEventListener("input", (e) => {
        const v = e.target.value;
        if (valDimBright) valDimBright.textContent = `${v}%`;
      });
      rangeDimBright.addEventListener("change", (e) => {
        sendAction("set_dim_brightness", { value: parseInt(e.target.value, 10) });
      });
    }

    const btnToggleMotion = document.getElementById("btnToggleMotionSensor");
    if (btnToggleMotion) {
      btnToggleMotion.addEventListener("click", () => {
        sendAction("toggle_motion_sensor");
      });
    }

    const btnReloadWeb = document.getElementById("btnReloadWebInterface");
    if (btnReloadWeb) {
      btnReloadWeb.addEventListener("click", () => {
        sendAction("reload_web_interface");
        setTimeout(() => window.location.reload(), 200);
      });
    }

    // Settings Form & Control Listeners
    if (elBtnSimulateMotion) {
      elBtnSimulateMotion.addEventListener("click", () => sendAction("simulate_motion"));
    }
    if (elBtnUpdateSoftware) {
      elBtnUpdateSoftware.addEventListener("click", () => sendAction("update_software"));
    }
    if (elBtnRestartDevice) {
      elBtnRestartDevice.addEventListener("click", () => sendAction("restart"));
    }
    if (elBtnShutdownDevice) {
      elBtnShutdownDevice.addEventListener("click", () => sendAction("shutdown"));
    }

    // Phone & Convex Sync Handlers
    const btnToggleSleep = document.getElementById("btnToggleSleepFocus");
    if (btnToggleSleep) {
      btnToggleSleep.addEventListener("click", () => sendAction("toggle_sleep_focus"));
    }

    const btnTogglePres = document.getElementById("btnTogglePresence");
    if (btnTogglePres) {
      btnTogglePres.addEventListener("click", () => sendAction("toggle_presence"));
    }

    const elCfgConvexForm = document.getElementById("cfgConvexForm");
    if (elCfgConvexForm) {
      elCfgConvexForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const url = document.getElementById("cfgConvexUrl")?.value.trim() || "";
        const qpath = document.getElementById("cfgConvexQueryPath")?.value.trim() || "dashvars:get";
        const mpath = document.getElementById("cfgConvexMutationPath")?.value.trim() || "dashvars:set";
        try {
          const res = await fetch("/api/phone/convex-config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              convex_url: url,
              convex_query_path: qpath,
              convex_mutation_path: mpath,
              cloud_sync_enabled: true
            })
          });
          const data = await res.json();
          if (data.success) {
            alert("Convex connected successfully! Data received: " + JSON.stringify(data.data || {}));
          } else {
            alert("Convex connection notice: " + (data.error || "Saved settings."));
          }
          fetchState();
        } catch (err) {
          alert("Failed to save Convex configuration: " + err);
        }
      });
    }

    // Siri Shortcuts Setup Modal
    const shortcutsModal = document.getElementById("shortcutsModal");
    const btnOpenShortcuts = document.getElementById("btnOpenShortcutsGuide");
    const btnCloseShortcuts = document.getElementById("btnCloseShortcutsModal");
    const btnDismissShortcuts = document.getElementById("btnDismissShortcutsModal");

    if (btnOpenShortcuts && shortcutsModal) {
      btnOpenShortcuts.addEventListener("click", () => {
        const url = document.getElementById("cfgConvexUrl")?.value.trim() || "https://tremendous-tiger-513.convex.cloud";
        document.querySelectorAll(".convex-url-display").forEach(el => {
          el.textContent = `${url.replace(/\/$/, '')}/api/mutation`;
        });
        revealSurface(shortcutsModal);
      });
    }

    if (btnCloseShortcuts && shortcutsModal) {
      btnCloseShortcuts.addEventListener("click", () => concealSurface(shortcutsModal));
    }
    if (btnDismissShortcuts && shortcutsModal) {
      btnDismissShortcuts.addEventListener("click", () => concealSurface(shortcutsModal));
    }
    if (shortcutsModal) {
      shortcutsModal.addEventListener("click", (e) => {
        if (e.target === shortcutsModal) concealSurface(shortcutsModal);
      });
    }

    document.querySelectorAll(".copy-code-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const toCopy = btn.getAttribute("data-copy") || btn.previousElementSibling?.innerText || "";
        if (toCopy) {
          navigator.clipboard.writeText(toCopy).then(() => {
            const orig = btn.innerHTML;
            btn.innerHTML = '<i class="fa-solid fa-check"></i> Copied!';
            setTimeout(() => { btn.innerHTML = orig; }, 1800);
          }).catch(() => {
            alert("Copied: " + toCopy);
          });
        }
      });
    });

    if (elCfgSpotifyForm) {
      elCfgSpotifyForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const cid = document.getElementById("cfgSpotifyClientId").value.trim();
        const csec = document.getElementById("cfgSpotifyClientSecret").value.trim();
        const ruri = document.getElementById("cfgSpotifyRedirectUri").value.trim();
        if (!cid || !csec) return;
        try {
          const res = await fetch("/api/spotify/config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ client_id: cid, client_secret: csec, redirect_uri: ruri })
          });
          const data = await res.json();
          if (data.auth_url) {
            window.location.href = data.auth_url;
          }
        } catch (err) {
          alert("Failed to connect Spotify: " + err);
        }
      });
    }

    if (elCfgWeatherForm) {
      elCfgWeatherForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const loc = document.getElementById("cfgWeatherLocation").value.trim();
        if (!loc) return;
        try {
          await fetch("/api/weather/location", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: `location=${encodeURIComponent(loc)}`
          });
          alert("Weather location updated!");
          fetchState();
        } catch (err) {
          alert("Failed to update weather location: " + err);
        }
      });
    }

    const elBtnScanWifi = document.getElementById("btnScanWifi");
    if (elBtnScanWifi) {
      elBtnScanWifi.addEventListener("click", () => {
        const listEl = document.getElementById("cfgWifiList");
        if (listEl) listEl.innerHTML = '<div style="color:var(--text-muted); font-size:0.85rem; padding:4px;">Scanning...</div>';
        fetch("/api/wifi/scan")
          .then(r => r.json())
          .then(res => {
            const nets = res.networks || [];
            if (listEl) {
              if (!nets.length) {
                listEl.innerHTML = '<div style="color:var(--text-muted); font-size:0.85rem; padding:4px;">No networks found</div>';
                return;
              }
              listEl.innerHTML = nets.map(net => `
                <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.05); padding:6px 10px; border-radius:8px; font-size:0.85rem;">
                  <span>${escapeHTML(net.ssid)} (${net.signal}%) ${net.in_use ? '<span style="color:var(--accent-green); margin-left:4px;">(Connected)</span>' : ''}</span>
                  <span style="color:var(--text-muted); font-size:0.75rem;">${net.security || 'WPA2'}</span>
                </div>
              `).join('');
            }
          }).catch(() => {
            if (listEl) listEl.innerHTML = '<div style="color:var(--accent-red); font-size:0.85rem; padding:4px;">Scan failed</div>';
          });
      });
    }

  }

  // Mock Demo Data for Localhost / Preview fallback when real data is unavailable
  const MOCK_DEMO_DATA = {
    slots: ["spotify", "weather", "timer"],
    display_mode: "on",
    settings: {
      max_brightness: 100,
      dim_brightness: 10,
      motion_sensor: true,
      dim_delay: 30,
      off_delay: 90
    },
    widgets: {
      time: {
        day_name: "THURSDAY",
        month: "AUG",
        day: 13,
        year: 2026,
        time_main: "16:11",
        seconds: "42"
      },
      weather: {
        temperature_f: 74,
        condition: "Partly Cloudy",
        location: "San Francisco, CA"
      },
      timer: {
        running: false,
        time_text: "05:00"
      },
      click_counter: {
        count: 42
      },
      photo: {
        has_image: false
      }
    },
    apps: {
      spotify: {
        track_name: "I Thank God (feat. Dante Bowe, Maryanne Joshua George & Aaron Moses)",
        artist_name: "Maverick City Music, UPPERROOM, Housefires, Dante Bowe, Maryanne J. George, Aaron Moses",
        album_art_url: "https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?auto=format&fit=crop&w=600&q=80",
        artist_image_url: "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=1200&q=80",
        is_playing: true,
        progress_ms: 104000,
        duration_ms: 243000,
        authenticated: true
      }
    },
    motion: {
      motion_detected: false,
      idle: "02:15"
    },
    spotify_status: {
      configured: true,
      authenticated: true
    }
  };

  let lastSoftwareVersion = null;
  let isInitialLoad = true;
  // API Calls
  async function fetchState() {
    if (isFetchingState) return;
    isFetchingState = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    try {
      const response = await fetch("/api/wide/state", { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("HTTP " + response.status);
      const data = await response.json();
      data.widgets = data.widgets && typeof data.widgets === "object" ? data.widgets : {};
      data.apps = data.apps && typeof data.apps === "object" ? data.apps : {};
      state.latestData = data;
      lastSuccessfulFetchTime = Date.now();
      lastClockChangeTime = lastSuccessfulFetchTime;
      if (data.version) {
        if (lastSoftwareVersion && lastSoftwareVersion !== data.version) { window.location.reload(); return; }
        lastSoftwareVersion = data.version;
      }
      if (data.reload_requested) { window.location.reload(); return; }
      hideConnectionLostOverlay();
      try { renderUI(); }
      catch (error) { console.error("Dashboard rendering failed:", error); }
      if (isInitialLoad) { isInitialLoad = false; restoreSavedScreenState(); }
    } catch (error) {
      failedFetchCount++;
      showConnectionLostOverlay();
      if (state.latestData) window.DashWorkspace?.update(state.latestData, { connected: false });
      if (!state.latestData) {
        state.latestData = window.location.protocol === "file:" ? MOCK_DEMO_DATA : { widgets: {}, apps: {} };
        renderUI();
      }
    } finally {
      clearTimeout(timeout);
      isFetchingState = false;
    }
  }

  async function sendAction(action, payload = {}) {
    const isLocalDev = window.location.protocol === "file:";

    try {
      const res = await fetch("/api/wide/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload })
      });
      if (res.ok) {
        const data = await res.json();
        data.widgets = data.widgets || {};
        data.apps = data.apps || {};
        state.latestData = data;
        renderUI();
        return;
      }
    } catch (err) {
      console.warn("Action network call failed, falling back to local simulation:", err);
    }

    if (isLocalDev && state.latestData) {
      if (action === "spotify_toggle") {
        if (state.latestData.apps.spotify) {
          state.latestData.apps.spotify.is_playing = !state.latestData.apps.spotify.is_playing;
        }
      } else if (action === "spotify_seek") {
        if (state.latestData.apps.spotify && payload.position_ms != null) {
          state.latestData.apps.spotify.progress_ms = payload.position_ms;
        }
      } else if (action === "counter_inc") {
        if (state.latestData.widgets.click_counter) {
          state.latestData.widgets.click_counter.count = (state.latestData.widgets.click_counter.count || 0) + 1;
        }
      } else if (action === "counter_dec") {
        if (state.latestData.widgets.click_counter) {
          state.latestData.widgets.click_counter.count = Math.max(0, (state.latestData.widgets.click_counter.count || 0) - 1);
        }
      } else if (action === "counter_reset") {
        if (state.latestData.widgets.click_counter) {
          state.latestData.widgets.click_counter.count = 0;
        }
      } else if (action === "timer_toggle") {
        if (state.latestData.widgets.timer) {
          state.latestData.widgets.timer.running = !state.latestData.widgets.timer.running;
        }
      }
      renderUI();
    }
  }

  // Render Full UI
  function renderUI() {
    const data = state.latestData;
    if (!data) return;
    const phone = data.phone_state || {};
    const suspended = phone.is_home === false || phone.sleep_focus === true
      || String(phone.focus_mode || "").trim().toLowerCase() === "sleep";

    window.DashFrame?.update(data);

    // One workspace arbitrates activities; individual apps never take over each other.
    window.DashWorkspace?.update(data, { connected: !isOffline });

    // If Overlay App is open, update its content live!
    if (state.activeOverlayApp) {
      window.DashFrame?.renderPhotos(elOverlayContent);
    }
    // If Settings overlay is open, update metrics
    if (state.settingsOpen) {
      updateSettingsMetrics(data);
    }

    // Web visibility follows phone presence / Sleep Focus independently of the
    // OLED's motion timer. Browsing photos must never wake physical hardware.
    const elDisplayOff = document.getElementById("displayOffOverlay");
    if (elDisplayOff) {
      for (const id of ["appContainer", "appOverlayView", "settingsOverlayView"]) {
        const surface = document.getElementById(id);
        if (surface) surface.inert = suspended || (id === "appContainer" && (Boolean(state.activeOverlayApp) || state.settingsOpen || window.DashWorkspace?.isPhotoVisible() === false));
      }
      if (suspended && document.getElementById("frameAppsDialog")?.open) document.getElementById("frameAppsDialog").close();
      elDisplayOff.classList.toggle("is-off", suspended);
      elDisplayOff.classList.toggle("hidden", !suspended);
    }
  }

  // Settings and photo editing remain workspace-wide overlays.
  let overlayReturnFocus = null;
  function openOverlayApp(appId) {
    if (appId !== 'photos') { window.DashWorkspace?.open(appId); return; }
    overlayReturnFocus = document.activeElement;
    state.activeOverlayApp = appId;
    document.getElementById('appContainer').inert = true;
    elAppOverlayView.classList.add('photos-active');
    elOverlayAppTitle.innerHTML = '<i class="fa-regular fa-images"></i> Photos';
    elOverlayAppSubtitle.textContent = 'Full Screen View';
    window.DashFrame?.syncRotationPause();
    revealSurface(elAppOverlayView);
    window.DashFrame?.renderPhotos(elOverlayContent);
    requestAnimationFrame(() => elBtnBackToDash?.focus({ preventScroll: true }));
  }

  function closeOverlayApp() {
    if (!state.activeOverlayApp && window.DashWorkspace?.isActive()) { window.DashWorkspace.home(); return; }
    state.activeOverlayApp = null;
    window.DashFrame?.syncRotationPause();
    document.getElementById('appContainer').inert = state.settingsOpen || window.DashWorkspace?.isPhotoVisible() === false;
    concealSurface(elAppOverlayView, () => {
      elAppOverlayView.classList.remove('photos-active');
      elOverlayContent.replaceChildren();
      if (window.DashWorkspace?.isActive()) {
        window.DashWorkspace.update(state.latestData, { connected: !isOffline });
        window.DashWorkspace.showControls();
        document.getElementById('workspaceRoot').focus({ preventScroll: true });
      } else {
        window.DashFrame?.showControls();
        if (overlayReturnFocus?.isConnected && overlayReturnFocus.getClientRects().length) overlayReturnFocus.focus({ preventScroll: true });
        else document.getElementById('dashboardView').focus({ preventScroll: true });
      }
    });
  }

  // Subpage Navigation Helper
  function showSettingsSubpage(subpageName) {
    const elMain = document.getElementById("settingsMainPage");
    const elOled = document.getElementById("settingsOledSubpage");
    const elHeaderBack = document.getElementById("settingsHeaderBackText");
    const elHeaderTitle = document.getElementById("settingsHeaderTitle");
    const elHeaderSubtitle = document.getElementById("settingsHeaderSubtitle");

    if (subpageName === "oled") {
      state.settingsSubpage = "oled";
      if (elMain) elMain.className = "settings-subpage subpage-hidden-left";
      if (elOled) elOled.className = "settings-subpage subpage-active";
      if (elHeaderBack) elHeaderBack.textContent = "Settings";
      if (elHeaderTitle) elHeaderTitle.innerHTML = '<i class="fa-solid fa-tv"></i> OLED Display Settings';
      if (elHeaderSubtitle) elHeaderSubtitle.textContent = "Hardware Panel & Motion Controls";
    } else {
      state.settingsSubpage = "main";
      if (elMain) elMain.className = "settings-subpage subpage-active";
      if (elOled) elOled.className = "settings-subpage subpage-hidden-right";
      if (elHeaderBack) elHeaderBack.textContent = "Dashboard";
      if (elHeaderTitle) elHeaderTitle.innerHTML = '<i class="fa-solid fa-gear"></i> System & Integration Settings';
      if (elHeaderSubtitle) elHeaderSubtitle.textContent = "Device Diagnostics & Web Controls";
    }
  }

  // Settings Overlay Management
  function openSettingsOverlay() {
    state.settingsOpen = true;
    window.DashFrame?.syncRotationPause();
    document.getElementById("appContainer").inert = true;
    showSettingsSubpage("main");
    try {
      sessionStorage.setItem("dash_saved_screen", JSON.stringify({ type: "settings" }));
    } catch (e) { }
    revealSurface(elSettingsOverlayView);
    requestAnimationFrame(() => elBtnCloseSettings?.focus({ preventScroll: true }));
    if (state.latestData) {
      updateSettingsMetrics(state.latestData);
    }
  }

  function closeSettingsOverlay() {
    if (state.settingsSubpage === "oled") {
      showSettingsSubpage("main");
      return;
    }
    state.settingsOpen = false;
    window.DashFrame?.syncRotationPause();
    document.getElementById("appContainer").inert = Boolean(state.activeOverlayApp);
    window.DashFrame?.showControls();
    if (window.DashWorkspace?.isActive()) {
      window.DashWorkspace.update(state.latestData, { connected: !isOffline });
      window.DashWorkspace.showControls();
      document.getElementById('workspaceRoot').focus({ preventScroll: true });
    } else elBtnOpenSettings?.focus({ preventScroll: true });
    try {
      sessionStorage.setItem("dash_saved_screen", JSON.stringify({ type: "dashboard" }));
    } catch (e) { }
    concealSurface(elSettingsOverlayView);
  }

  function updateSettingsMetrics(data) {
    if (elCfgSoftwareVersion && data.version) {
      elCfgSoftwareVersion.textContent = `v${data.version}`;
    }
    if (elCfgDisplayState) elCfgDisplayState.textContent = (data.display_mode || 'on').toUpperCase();
    if (elCfgMotionState && data.motion) {
      elCfgMotionState.textContent = data.motion.motion_detected ? 'ACTIVE' : 'IDLE';
    }
    if (elCfgIpAddress) {
      elCfgIpAddress.textContent = window.location.hostname || "127.0.0.1";
    }

    // Phone & Convex Metrics
    const ps = data.phone_state || {};
    const cvx = data.convex_status || {};
    const elCfgSleepFocusStatus = document.getElementById("cfgSleepFocusStatus");
    const elCfgPresenceStatus = document.getElementById("cfgPresenceStatus");
    const elCfgConvexConnStatus = document.getElementById("cfgConvexConnStatus");
    const elCfgLastPhoneSync = document.getElementById("cfgLastPhoneSync");

    if (elCfgSleepFocusStatus) {
      const isSleep = Boolean(ps.sleep_focus);
      elCfgSleepFocusStatus.textContent = isSleep ? "ACTIVE (1% NIGHT)" : "INACTIVE";
      elCfgSleepFocusStatus.style.color = isSleep ? "var(--accent-purple, #bf7af0)" : "var(--accent-green)";
    }
    if (elCfgPresenceStatus) {
      const isHome = ps.is_home !== false;
      elCfgPresenceStatus.textContent = isHome ? "HOME" : "AWAY";
      elCfgPresenceStatus.style.color = isHome ? "var(--accent-cyan, #00f2fe)" : "var(--accent-amber, #ffb300)";
    }
    if (elCfgConvexConnStatus) {
      if (!cvx.enabled) {
        elCfgConvexConnStatus.textContent = "DISABLED";
        elCfgConvexConnStatus.style.color = "var(--text-muted)";
      } else if (cvx.connected) {
        elCfgConvexConnStatus.textContent = `SYNCED (${cvx.sync_count || 1})`;
        elCfgConvexConnStatus.style.color = "var(--accent-green)";
      } else if (cvx.last_error) {
        elCfgConvexConnStatus.textContent = `ERR: ${cvx.last_error.slice(0, 14)}`;
        elCfgConvexConnStatus.style.color = "var(--accent-red, #ff5252)";
      } else {
        elCfgConvexConnStatus.textContent = "CONNECTING...";
        elCfgConvexConnStatus.style.color = "var(--accent-amber)";
      }
    }
    if (elCfgLastPhoneSync) {
      elCfgLastPhoneSync.textContent = ps.last_updated ? `${ps.last_updated.replace('T', ' ')} (${ps.last_sync_source || 'local'})` : '--';
    }

    const inputUrl = document.getElementById("cfgConvexUrl");
    const inputQuery = document.getElementById("cfgConvexQueryPath");
    const inputMut = document.getElementById("cfgConvexMutationPath");
    const stConvex = data.settings || {};
    if (inputUrl && stConvex.convex_url && document.activeElement !== inputUrl) {
      inputUrl.value = stConvex.convex_url;
    }
    if (inputQuery && stConvex.convex_query_path && document.activeElement !== inputQuery) {
      inputQuery.value = stConvex.convex_query_path;
    }
    if (inputMut && stConvex.convex_mutation_path && document.activeElement !== inputMut) {
      inputMut.value = stConvex.convex_mutation_path;
    }

    // Hardware Settings Metrics
    const st = data.settings || {};
    const rangeMax = document.getElementById("cfgMaxBrightnessRange");
    const valMax = document.getElementById("cfgMaxBrightnessVal");
    if (rangeMax && st.max_brightness != null && document.activeElement !== rangeMax) {
      rangeMax.value = st.max_brightness;
      if (valMax) valMax.textContent = `${st.max_brightness}%`;
    }

    const rangeDim = document.getElementById("cfgDimBrightnessRange");
    const valDim = document.getElementById("cfgDimBrightnessVal");
    if (rangeDim && st.dim_brightness != null && document.activeElement !== rangeDim) {
      rangeDim.value = st.dim_brightness;
      if (valDim) valDim.textContent = `${st.dim_brightness}%`;
    }

    const motionStatusBadge = document.getElementById("cfgMotionToggleStatus");
    if (motionStatusBadge && st.motion_sensor != null) {
      const isEnabled = Boolean(st.motion_sensor);
      motionStatusBadge.textContent = isEnabled ? "ENABLED" : "DISABLED";
      motionStatusBadge.style.color = isEnabled ? "var(--accent-green)" : "var(--accent-green)";
      motionStatusBadge.style.borderColor = isEnabled ? "rgba(0, 242, 254, 0.3)" : "rgba(255, 255, 255, 0.2)";
    }

    const elDimDelay = document.getElementById("cfgDimDelay");
    if (elDimDelay && st.dim_delay != null) elDimDelay.textContent = `${st.dim_delay}s`;

    const elOffDelay = document.getElementById("cfgOffDelay");
    if (elOffDelay && st.off_delay != null) elOffDelay.textContent = `${st.off_delay}s`;

    const elOledDisplayState = document.getElementById("cfgOledDisplayState");
    if (elOledDisplayState) elOledDisplayState.textContent = (data.display_mode || 'on').toUpperCase();

    const elOledIdleTime = document.getElementById("cfgOledIdleTime");
    if (elOledIdleTime && data.motion) elOledIdleTime.textContent = data.motion.idle || '00:00';

    if (elCfgSpotifyStatus && data.spotify_status) {
      const auth = data.spotify_status.authenticated;
      const conf = data.spotify_status.configured;
      if (auth) {
        elCfgSpotifyStatus.textContent = "Status: Authenticated & Connected!";
        elCfgSpotifyStatus.style.color = "var(--accent-green)";
      } else if (conf) {
        elCfgSpotifyStatus.textContent = "Status: Configured. Click Connect Spotify to authenticate.";
        elCfgSpotifyStatus.style.color = "var(--accent-amber)";
      } else {
        elCfgSpotifyStatus.textContent = "Status: Not configured. Enter Client ID & Secret below.";
        elCfgSpotifyStatus.style.color = "var(--text-muted)";
      }
    }

    const elCfgWifiStatus = document.getElementById("cfgWifiStatus");
    const elCfgWifiSSID = document.getElementById("cfgWifiSSID");
    if (elCfgWifiStatus || elCfgWifiSSID) {
      fetch("/api/wifi/status")
        .then(r => r.json())
        .then(st => {
          if (elCfgWifiStatus) elCfgWifiStatus.textContent = st.connected ? "Connected" : (st.ap_active ? "Setup AP Active" : "Disconnected");
          if (elCfgWifiSSID) elCfgWifiSSID.textContent = st.ssid || (st.ap_active ? "Dash-Setup" : "--");
        }).catch(() => { });
    }
  }

  // Screen Restoration after Reload
  function restoreSavedScreenState() {
    // A reload is always a quiet Photo Clock start. Activity state is seeded
    // from the first successful snapshot rather than replaying start events.
    try { sessionStorage.removeItem("dash_saved_screen"); sessionStorage.removeItem("dash_saved_modal"); } catch (_) {}
  }

  // Utilities
  function escapeHTML(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // Start app on DOM ready
  document.addEventListener("DOMContentLoaded", init);
})();
