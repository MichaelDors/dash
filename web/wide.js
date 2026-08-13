(function() {
  "use strict";

  // Available apps definition using Font Awesome Icon Classes
  const AVAILABLE_APPS = [
    { id: "spotify", name: "Spotify Player", icon: "fa-brands fa-spotify", desc: "Playback & Album Art" },
    { id: "weather", name: "Weather Forecast", icon: "fa-solid fa-cloud-sun", desc: "Local Temp & Forecast" },
    { id: "timer", name: "Countdown Timer", icon: "fa-solid fa-stopwatch", desc: "Timer & Alarm Controls" },
    { id: "click_counter", name: "Tally Counter", icon: "fa-solid fa-calculator", desc: "Touch Click Counter" },
    { id: "photo", name: "Photo Frame", icon: "fa-solid fa-image", desc: "Image Display & Upload" },
    { id: "motion_status", name: "System Status", icon: "fa-solid fa-sliders", desc: "Motion & System Diagnostics" }
  ];

  let state = {
    slots: ["spotify", "weather"],
    activeOverlayApp: null,
    settingsOpen: false,
    latestData: null,
    pickerSelected: ["spotify", "weather"]
  };

  // Long press timer ref
  let longPressTimer = null;
  let isLongPress = false;

  // DOM Elements
  const elAppGrid = document.getElementById("dashboardGrid");
  const elSlotsContainer = document.getElementById("slotsContainer");
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

  // Hero Time elements
  const elHeroDay = document.getElementById("heroDay");
  const elHeroDate = document.getElementById("heroDate");
  const elHeroTime = document.getElementById("heroTime");
  const elHeroSeconds = document.getElementById("heroSeconds");
  const elHeroWeatherText = document.getElementById("heroWeatherText");

  // Dynamic Color Extraction for Spotify Album Art (Cadence Inspired)
  let currentAlbumArtUrl = null;

  function sampleImageRegion(img, x, y, width, height) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = Math.max(1, width);
    canvas.height = Math.max(1, height);
    try {
      ctx.drawImage(img, x, y, width, height, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      let r = 0, g = 0, b = 0, count = 0;
      for (let i = 0; i < data.length; i += 4) {
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        count++;
      }
      return {
        r: Math.round(r / count),
        g: Math.round(g / count),
        b: Math.round(b / count)
      };
    } catch (e) {
      return null;
    }
  }

  async function extractVibrantColor(img) {
    try {
      if (!img.complete || img.naturalWidth === 0) {
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
        });
      }
      const width = img.naturalWidth;
      const height = img.naturalHeight;
      if (width === 0 || height === 0) return null;

      const borderThickness = Math.max(5, Math.min(width, height) * 0.05);
      const sampleSize = Math.min(width, height) * 0.2;
      const regions = [
        { x: 0, y: 0, w: width, h: borderThickness, isEdge: true },
        { x: 0, y: height - borderThickness, w: width, h: borderThickness, isEdge: true },
        { x: 0, y: 0, w: borderThickness, h: height, isEdge: true },
        { x: width - borderThickness, y: 0, w: borderThickness, h: height, isEdge: true },
        { x: width * 0.3, y: height * 0.3, w: width * 0.4, h: height * 0.4, isEdge: false },
        { x: width * 0.1, y: height * 0.1, w: width * 0.3, h: height * 0.3, isEdge: false },
        { x: width * 0.6, y: height * 0.1, w: width * 0.3, h: height * 0.3, isEdge: false },
      ];

      const allColors = [];
      for (const region of regions) {
        const rgb = sampleImageRegion(img, Math.round(region.x), Math.round(region.y), Math.round(region.w), Math.round(region.h));
        if (!rgb) continue;
        const r = rgb.r, g = rgb.g, b = rgb.b;
        const brightness = (r * 299 + g * 587 + b * 114) / 1000;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const saturation = max === 0 ? 0 : (max - min) / max;

        const hex = `#${[r, g, b].map(x => x.toString(16).padStart(2, '0')).join('')}`;
        allColors.push({ hex, r, g, b, brightness, saturation, isEdge: region.isEdge });
      }

      let bestColor = null;
      let bestScore = 0;

      for (const color of allColors) {
        const isGrey = Math.abs(color.r - color.g) < 15 && Math.abs(color.g - color.b) < 15 && Math.abs(color.r - color.b) < 15;
        const isBlack = color.brightness < 35;
        const isWhite = color.brightness > 225;
        const isBeige = color.brightness > 180 && color.saturation < 0.15;
        if (isGrey || isBlack || isWhite || isBeige || color.saturation < 0.15) continue;

        const edgeBonus = color.isEdge ? 0.15 : 0;
        const brightnessScore = Math.min(color.brightness / 255, 1);
        const brightnessPenalty = color.brightness > 200 ? 0.3 : 1;
        const score = color.saturation * 0.85 + (brightnessScore * brightnessPenalty) * 0.1 + edgeBonus;

        if (score > bestScore) {
          bestScore = score;
          bestColor = color;
        }
      }

      if (bestColor) return bestColor.hex;
      return null;
    } catch (err) {
      return null;
    }
  }

  function updateSpotifyAccentColor(artUrl) {
    if (!artUrl) {
      document.documentElement.style.setProperty('--spotify-accent', '#00f2fe');
      return;
    }
    if (artUrl === currentAlbumArtUrl) return;
    currentAlbumArtUrl = artUrl;

    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.src = artUrl;
    extractVibrantColor(img).then(color => {
      if (color) {
        document.documentElement.style.setProperty('--spotify-accent', color);
      } else {
        document.documentElement.style.setProperty('--spotify-accent', '#00f2fe');
      }
    }).catch(() => {
      document.documentElement.style.setProperty('--spotify-accent', '#00f2fe');
    });
  }

  // Connection state management
  let failedFetchCount = 0;
  let isOffline = false;
  const elConnectionLostOverlay = document.getElementById("connectionLostOverlay");

  // Modal elements
  const elWidgetModal = document.getElementById("widgetModal");
  const elBtnCloseModal = document.getElementById("btnCloseModal");
  const elPickerGrid = document.getElementById("pickerGrid");
  const elSlotCountIndicator = document.getElementById("slotCountIndicator");
  const elBtnSaveConfig = document.getElementById("btnSaveConfig");

  // Initialize App
  function init() {
    setupEventListeners();
    fetchState();
    setInterval(fetchState, 250);
  }

  // Setup Event Listeners
  function setupEventListeners() {
    // Back from full screen app overlay
    if (elBtnBackToDash) {
      elBtnBackToDash.addEventListener("click", () => {
        closeOverlayApp();
      });
    }

    // Settings overlay triggers
    if (elBtnOpenSettings) elBtnOpenSettings.addEventListener("click", openSettingsOverlay);
    if (elBtnCloseSettings) elBtnCloseSettings.addEventListener("click", closeSettingsOverlay);

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

    // Modal triggers
    if (elBtnCloseModal) elBtnCloseModal.addEventListener("click", closeWidgetModal);
    if (elWidgetModal) {
      elWidgetModal.addEventListener("click", (e) => {
        if (e.target === elWidgetModal) closeWidgetModal();
      });
    }

    if (elBtnSaveConfig) elBtnSaveConfig.addEventListener("click", saveWidgetConfig);
  }

  // API Calls
  async function fetchState() {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      const res = await fetch("/api/wide/state", { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      state.latestData = data;
      if (Array.isArray(data.slots)) {
        state.slots = data.slots;
      }
      
      failedFetchCount = 0;
      if (isOffline) {
        isOffline = false;
        if (elConnectionLostOverlay) {
          elConnectionLostOverlay.classList.remove("visible");
          setTimeout(() => {
            if (!isOffline) elConnectionLostOverlay.classList.add("hidden");
          }, 800);
        }
      }
      renderUI();
    } catch (err) {
      failedFetchCount++;
      if (failedFetchCount >= 2 && !isOffline) {
        isOffline = true;
        if (elConnectionLostOverlay) {
          elConnectionLostOverlay.classList.remove("hidden");
          void elConnectionLostOverlay.offsetWidth;
          elConnectionLostOverlay.classList.add("visible");
        }
      }
    }
  }

  async function sendAction(action, payload = {}) {
    try {
      const res = await fetch("/api/wide/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload })
      });
      if (res.ok) {
        const data = await res.json();
        state.latestData = data;
        renderUI();
      }
    } catch (err) {
      console.error("Action failed:", err);
    }
  }

  async function saveWidgetConfig() {
    try {
      const res = await fetch("/api/wide/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slots: state.pickerSelected })
      });
      if (res.ok) {
        const data = await res.json();
        state.slots = data.slots || state.pickerSelected;
        closeWidgetModal();
        fetchState();
      }
    } catch (err) {
      console.error("Failed to save config:", err);
    }
  }

  // Render Full UI
  function renderUI() {
    const data = state.latestData;
    if (!data) return;

    // Spotify Dynamic Color Extraction
    const spData = data.apps?.spotify || data.widgets?.spotify || {};
    if (spData.album_art_url) {
      updateSpotifyAccentColor(spData.album_art_url);
    } else {
      document.documentElement.style.setProperty('--spotify-accent', '#00f2fe');
    }

    // Update Persistent Time Hero Card
    updateHeroTime(data.widgets.time, data.widgets.weather);

    // Update Dashboard Grid Slots
    renderDashboardSlots(data);

    // If Overlay App is open, update its content live!
    if (state.activeOverlayApp) {
      renderOverlayAppContent(state.activeOverlayApp, data);
    }

    // If Settings overlay is open, update metrics
    if (state.settingsOpen) {
      updateSettingsMetrics(data);
    }
  }

  // Hero Time update with Date Bug Fix!
  function updateHeroTime(timeWidget, weatherWidget) {
    const now = timeWidget || {};
    const days = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
    const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    const d = new Date();

    const dayName = now.day_name || days[d.getDay()];
    const monthStr = now.month || months[d.getMonth()];
    const dayNum = now.day || d.getDate();
    const yearNum = now.year || d.getFullYear();

    if (elHeroDay) elHeroDay.textContent = dayName;
    if (elHeroDate) elHeroDate.textContent = `${monthStr} ${dayNum}, ${yearNum}`;
    if (elHeroTime) elHeroTime.textContent = now.time_main || d.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit' });
    if (elHeroSeconds) elHeroSeconds.textContent = `:${now.seconds || String(d.getSeconds()).padStart(2, '0')}`;

    if (elHeroWeatherText && weatherWidget) {
      if (weatherWidget.temperature_f != null) {
        elHeroWeatherText.textContent = `${Math.round(weatherWidget.temperature_f)}°F • ${weatherWidget.condition || 'Clear'}`;
      } else {
        elHeroWeatherText.textContent = weatherWidget.location || "Weather";
      }
    }
  }

  // Render Dashboard Grid Slots
  function renderDashboardSlots(data) {
    const activeSlots = state.slots || [];
    const count = Math.min(3, activeSlots.length);

    // Update Grid layout CSS class
    elAppGrid.className = `dashboard-grid slots-${count}`;

    // Render Slots HTML
    let html = "";
    activeSlots.slice(0, 3).forEach((appId) => {
      html += createWidgetCardHTML(appId, data);
    });

    if (elSlotsContainer.innerHTML !== html) {
      elSlotsContainer.innerHTML = html;

      // Attach Long Press & Click handlers to cards
      activeSlots.slice(0, 3).forEach((appId) => {
        const cardEl = document.getElementById(`card_${appId}`);
        if (cardEl) setupCardTouchGestures(cardEl, appId);
      });

      // Attach inner touch action buttons
      attachSlotActionListeners();
    }

    // Direct DOM updates for rapidly changing values to prevent innerHTML tearing
    const spProg = document.getElementById("widget-spotify-progress");
    if (spProg) {
      const sp = data.apps.spotify || data.widgets.spotify || {};
      const progress = sp.duration_ms ? Math.min(100, (sp.progress_ms / sp.duration_ms) * 100) : 0;
      spProg.style.width = `${progress}%`;
    }
    const tmText = document.getElementById("widget-timer-text");
    if (tmText) {
      const tm = data.widgets.timer || {};
      if (tmText.innerText !== (tm.time_text || "05:00")) {
        tmText.innerText = tm.time_text || "05:00";
      }
    }
  }

  // Gesture Handler: Long Press (>600ms) opens Widget Modal, Short Tap opens App
  function setupCardTouchGestures(cardEl, appId) {
    const startPress = (e) => {
      // Don't trigger long press if user tapped a control button inside card
      if (e.target.closest(".mini-ctrl-btn") || e.target.closest("button") || e.target.closest("input")) {
        return;
      }
      isLongPress = false;
      cardEl.classList.add("holding");
      longPressTimer = setTimeout(() => {
        isLongPress = true;
        cardEl.classList.remove("holding");
        if (navigator.vibrate) navigator.vibrate(40);
        openWidgetModal();
      }, 600);
    };

    const cancelPress = () => {
      cardEl.classList.remove("holding");
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    };

    const handleTap = (e) => {
      cancelPress();
      if (e.target.closest(".mini-ctrl-btn") || e.target.closest("button") || e.target.closest("input")) {
        return;
      }
      if (!isLongPress) {
        openOverlayApp(appId);
      }
      isLongPress = false;
    };

    cardEl.addEventListener("touchstart", startPress, { passive: true });
    cardEl.addEventListener("touchend", handleTap);
    cardEl.addEventListener("touchcancel", cancelPress);

    cardEl.addEventListener("mousedown", startPress);
    cardEl.addEventListener("mouseup", handleTap);
    cardEl.addEventListener("mouseleave", cancelPress);
  }

  // Create Card HTML for Dashboard Grid
  function createWidgetCardHTML(appId, data) {
    const appDef = AVAILABLE_APPS.find(a => a.id === appId) || { name: appId, icon: "fa-solid fa-square-app" };
    let bodyHTML = "";

    if (appId === "spotify") {
      const sp = data.apps.spotify || data.widgets.spotify || {};
      const track = sp.track_name || "No Track Playing";
      const artist = sp.artist_name || "Connect Spotify in Settings";
      const isPlaying = sp.is_playing;
      const albumArt = sp.album_art_url;
      const progress = sp.duration_ms ? Math.min(100, (sp.progress_ms / sp.duration_ms) * 100) : 0;

      const artHTML = albumArt ?
        `<div class="spotify-art-wrapper">
          <img src="${escapeHTML(albumArt)}" class="spotify-art-thumb" alt="Album Art" />
          <div class="art-sweep-flash"></div>
        </div>` :
        `<div class="spotify-art-placeholder"><i class="fa-brands fa-spotify"></i></div>`;

      bodyHTML = `
        <div class="spotify-card-content">
          ${artHTML}
          <div class="spotify-info-panel">
            <div>
              <h3 class="spotify-track-title">${escapeHTML(track)}</h3>
              <p class="spotify-artist-name">${escapeHTML(artist)}</p>
            </div>
            <div class="spotify-progress-bar-wrap">
              <div class="spotify-progress-fill" id="widget-spotify-progress"></div>
            </div>
            <div class="spotify-mini-controls">
              <button class="mini-ctrl-btn" data-act="spotify_prev"><i class="fa-solid fa-backward-step"></i></button>
              <button class="mini-ctrl-btn btn-play-main" data-act="spotify_toggle">
                <i class="fa-solid ${isPlaying ? 'fa-pause' : 'fa-play'}"></i>
              </button>
              <button class="mini-ctrl-btn" data-act="spotify_next"><i class="fa-solid fa-forward-step"></i></button>
            </div>
          </div>
        </div>
      `;
    } else if (appId === "weather") {
      const w = data.widgets.weather || {};
      const temp = w.temperature_f != null ? `${Math.round(w.temperature_f)}°F` : "--";
      const location = w.location || w.location_query || "Location";
      const condition = w.condition || "Checking...";

      bodyHTML = `
        <div class="weather-card-content">
          <span class="weather-location-label"><i class="fa-solid fa-location-dot"></i> ${escapeHTML(location)}</span>
          <span class="weather-temp-main">${temp}</span>
          <span class="weather-condition-label">${escapeHTML(condition)}</span>
        </div>
      `;
    } else if (appId === "timer") {
      const tm = data.widgets.timer || {};
      const timeText = tm.time_text || "05:00";
      const running = tm.running;

      bodyHTML = `
        <div class="timer-card-content">
          <div class="timer-digits-display" id="widget-timer-text">00:00</div>
          <div class="spotify-mini-controls">
            <button class="mini-ctrl-btn" data-act="timer_sub_min">-1m</button>
            <button class="mini-ctrl-btn btn-play-main" data-act="timer_toggle" style="background:var(--accent-purple); color:#fff;">
              <i class="fa-solid ${running ? 'fa-pause' : 'fa-play'}"></i>
            </button>
            <button class="mini-ctrl-btn" data-act="timer_add_min">+1m</button>
          </div>
        </div>
      `;
    } else if (appId === "click_counter") {
      const cnt = data.widgets.click_counter || {};
      const count = cnt.count ?? 0;

      bodyHTML = `
        <div class="counter-card-content">
          <div class="counter-digits-display">${count}</div>
          <div class="spotify-mini-controls">
            <button class="mini-ctrl-btn" data-act="counter_dec">-1</button>
            <button class="mini-ctrl-btn btn-play-main" data-act="counter_inc" style="background:var(--accent-cyan); color:#000;">+1</button>
            <button class="mini-ctrl-btn" data-act="counter_reset"><i class="fa-solid fa-rotate-left"></i></button>
          </div>
        </div>
      `;
    } else if (appId === "photo") {
      const ph = data.widgets.photo || {};
      if (ph.has_image && ph.image_base64) {
        bodyHTML = `
          <div class="photo-card-content" style="width:100%; height:100%; display:flex; align-items:center; justify-content:center;">
            <img src="data:image/png;base64,${ph.image_base64}" style="max-width:100%; max-height:100%; object-fit:cover; border-radius:12px;" alt="Photo" />
          </div>
        `;
      } else {
        bodyHTML = `
          <div class="photo-card-content" style="color:var(--text-muted); text-align:center;">
            <i class="fa-solid fa-image" style="font-size:2.5rem; color:var(--accent-cyan);"></i>
            <p style="margin-top:0.5rem;">No Photo Uploaded</p>
          </div>
        `;
      }
    } else if (appId === "motion_status") {
      const m = data.motion || {};
      bodyHTML = `
        <div class="weather-card-content">
          <span class="weather-location-label">Display Mode: ${(data.display_mode || 'ON').toUpperCase()}</span>
          <span class="weather-temp-main" style="font-size:2.2rem; color:var(--accent-cyan);">${m.motion_detected ? 'ACTIVE' : 'IDLE'}</span>
          <button class="touch-btn" data-act="simulate_motion" style="margin-top:0.5rem;"><i class="fa-solid fa-person-walking"></i> Sim Motion</button>
        </div>
      `;
    }

    return `
      <article class="widget-card" id="card_${appId}" data-app-id="${appId}">
        <div class="card-glow"></div>
        <header class="card-header">
          <div class="card-title-group">
            <i class="${appDef.icon} card-icon"></i>
            <h2 class="card-title">${appDef.name}</h2>
          </div>
          <span class="card-expand-hint"><i class="fa-solid fa-expand"></i></span>
        </header>
        <div class="card-body">
          ${bodyHTML}
        </div>
      </article>
    `;
  }

  // Mini Control Actions
  function attachSlotActionListeners() {
    document.querySelectorAll("[data-act]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const act = btn.getAttribute("data-act");
        sendAction(act);
      });
    });
  }

  // Full Screen Overlay Management
  function openOverlayApp(appId) {
    state.activeOverlayApp = appId;
    const appDef = AVAILABLE_APPS.find(a => a.id === appId) || { name: appId, icon: "fa-solid fa-square-app" };

    if (appId === "spotify") {
      elAppOverlayView.classList.add("spotify-active");
      if (elOverlayAppTitle) elOverlayAppTitle.innerHTML = "";
      if (elOverlayAppSubtitle) elOverlayAppSubtitle.textContent = "";
    } else {
      elAppOverlayView.classList.remove("spotify-active");
      if (elOverlayAppTitle) elOverlayAppTitle.innerHTML = `<i class="${appDef.icon}"></i> ${appDef.name}`;
      if (elOverlayAppSubtitle) elOverlayAppSubtitle.textContent = `Full Screen View`;
    }

    elAppOverlayView.classList.remove("hidden");
    if (state.latestData) {
      renderOverlayAppContent(appId, state.latestData);
    }
  }

  function closeOverlayApp() {
    state.activeOverlayApp = null;
    elAppOverlayView.classList.add("hidden");
    elAppOverlayView.classList.remove("spotify-active");
  }

  // Settings Overlay Management
  function openSettingsOverlay() {
    state.settingsOpen = true;
    elSettingsOverlayView.classList.remove("hidden");
    if (state.latestData) {
      updateSettingsMetrics(state.latestData);
    }
  }

  function closeSettingsOverlay() {
    state.settingsOpen = false;
    elSettingsOverlayView.classList.add("hidden");
  }

  function updateSettingsMetrics(data) {
    if (elCfgDisplayState) elCfgDisplayState.textContent = (data.display_mode || 'on').toUpperCase();
    if (elCfgMotionState && data.motion) {
      elCfgMotionState.textContent = data.motion.motion_detected ? 'ACTIVE' : 'IDLE';
    }
    if (elCfgIpAddress) {
      elCfgIpAddress.textContent = window.location.hostname || "127.0.0.1";
    }
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
  }

  // Render Full Screen App Content
  function renderOverlayAppContent(appId, data) {
    let html = "";

    if (appId === "spotify") {
      const sp = data.apps.spotify || data.widgets.spotify || {};
      const track = sp.track_name || "No Track Playing";
      const artist = sp.artist_name || "Connect Spotify in Settings";
      const isPlaying = sp.is_playing;
      const albumArt = sp.album_art_url;
      const progressMs = sp.progress_ms || 0;
      const durationMs = sp.duration_ms || 1;
      const pct = Math.min(100, (progressMs / durationMs) * 100);

      const artHTML = albumArt ?
        `<div class="fs-spotify-art-wrapper">
          <img src="${escapeHTML(albumArt)}" class="fs-spotify-art-large" alt="Album Art" />
          <div class="art-sweep-flash"></div>
        </div>` :
        `<div class="fs-spotify-art-placeholder"><i class="fa-brands fa-spotify"></i></div>`;

      html = `
        <div class="fs-spotify-container">
          ${artHTML}
          <div class="fs-spotify-details">
            <div>
              <h1 class="fs-spotify-title">${escapeHTML(track)}</h1>
              <h2 class="fs-spotify-artist">${escapeHTML(artist)}</h2>
            </div>
            <div class="fs-spotify-scrub-wrap">
              <div class="fs-spotify-progress">
                <div class="fs-spotify-progress-fill" id="fs-spotify-progress"></div>
              </div>
              <div class="fs-spotify-time-row">
                <span id="fs-spotify-time-current">0:00</span>
                <span id="fs-spotify-time-duration">0:00</span>
              </div>
            </div>
            <div class="fs-spotify-controls">
              <button class="fs-ctrl-btn" id="fsSpotPrev"><i class="fa-solid fa-backward-step"></i></button>
              <button class="fs-ctrl-btn fs-play-btn" id="fsSpotPlay">
                <i class="fa-solid ${isPlaying ? 'fa-pause' : 'fa-play'}"></i>
              </button>
              <button class="fs-ctrl-btn" id="fsSpotNext"><i class="fa-solid fa-forward-step"></i></button>
            </div>
          </div>
        </div>
      `;
    } else if (appId === "timer") {
      const tm = data.widgets.timer || {};
      const running = tm.running;

      html = `
        <div class="fs-timer-container">
          <div class="fs-timer-display" id="fs-timer-text">00:00</div>
          <div class="fs-timer-actions">
            <button class="touch-btn btn-primary" id="fsTimerToggle" style="font-size:1.4rem; padding:1rem 2.5rem;">
              <i class="fa-solid ${running ? 'fa-pause' : 'fa-play'}"></i> ${running ? 'Pause' : 'Start'}
            </button>
            <button class="touch-btn" id="fsTimerReset" style="font-size:1.4rem; padding:1rem 2.5rem;">
              <i class="fa-solid fa-rotate-left"></i> Reset
            </button>
          </div>
          <div style="display:flex; gap:1rem; margin-top:1rem;">
            <button class="touch-btn" id="fsT1">-1 Min</button>
            <button class="touch-btn" id="fsT2">+1 Min</button>
            <button class="touch-btn" id="fsT5">5 Mins</button>
            <button class="touch-btn" id="fsT10">10 Mins</button>
            <button class="touch-btn" id="fsT25">25 Mins</button>
          </div>
        </div>
      `;
    } else if (appId === "click_counter") {
      const cnt = data.widgets.click_counter || {};
      const count = cnt.count ?? 0;

      html = `
        <div class="fs-counter-container">
          <div class="fs-counter-digits">${count}</div>
          <div class="fs-counter-pads">
            <button class="touch-btn counter-pad" id="fsCountMinus" style="background:#261414; border-color:#dc2626; color:#ef4444;">-1</button>
            <button class="touch-btn counter-pad" id="fsCountPlus" style="background:#0c242c; border-color:var(--accent-cyan); color:#fff;">+1</button>
          </div>
          <button class="touch-btn" id="fsCountReset" style="font-size:1.2rem; padding:0.8rem 2rem;"><i class="fa-solid fa-rotate-left"></i> Reset Counter</button>
        </div>
      `;
    } else if (appId === "weather") {
      const w = data.widgets.weather || {};
      const temp = w.temperature_f != null ? `${Math.round(w.temperature_f)}°F` : "--";
      const location = w.location || w.location_query || "Location Not Set";
      const condition = w.condition || "Unknown";

      html = `
        <div class="fs-counter-container">
          <span style="font-size:1.5rem; color:var(--text-muted);"><i class="fa-solid fa-location-dot"></i> ${escapeHTML(location)}</span>
          <div style="font-size:7rem; font-weight:800; font-family:var(--font-mono); color:#ffffff;">${temp}</div>
          <span style="font-size:2rem; font-weight:600; color:var(--accent-cyan);">${escapeHTML(condition)}</span>
        </div>
      `;
    } else if (appId === "photo") {
      const ph = data.widgets.photo || {};
      if (ph.has_image && ph.image_base64) {
        html = `
          <div style="width:100%; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:1.5rem;">
            <img src="data:image/png;base64,${ph.image_base64}" style="max-width:90vw; max-height:60vh; border-radius:16px; box-shadow:0 20px 60px rgba(0,0,0,0.8);" alt="Photo" />
            <form id="fsPhotoForm" style="display:flex; gap:1rem; align-items:center;">
              <input type="file" id="fsPhotoInput" accept="image/*" style="color:#fff;" />
              <button type="submit" class="touch-btn btn-primary">Upload Photo</button>
            </form>
          </div>
        `;
      } else {
        html = `
          <div style="display:flex; flex-direction:column; align-items:center; gap:2rem;">
            <i class="fa-solid fa-image" style="font-size:4rem; color:var(--accent-cyan);"></i>
            <h2>No Photo Uploaded</h2>
            <form id="fsPhotoForm" style="display:flex; gap:1rem; align-items:center;">
              <input type="file" id="fsPhotoInput" accept="image/*" style="color:#fff;" />
              <button type="submit" class="touch-btn btn-primary">Upload Photo</button>
            </form>
          </div>
        `;
      }
    } else if (appId === "motion_status") {
      const m = data.motion || {};
      html = `
        <div style="display:flex; flex-direction:column; align-items:center; gap:2rem;">
          <h2 style="font-size:2rem;">System & Motion Diagnostics</h2>
          <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:1.5rem; width:100%; max-width:800px;">
            <div style="background:#0e121c; border:1px solid var(--border-card); padding:1.5rem; border-radius:16px; text-align:center;">
              <span style="color:var(--text-muted); font-size:0.9rem;">Display Mode</span>
              <h3 style="font-size:1.8rem; margin-top:0.5rem; color:var(--accent-cyan);">${(data.display_mode || 'ON').toUpperCase()}</h3>
            </div>
            <div style="background:#0e121c; border:1px solid var(--border-card); padding:1.5rem; border-radius:16px; text-align:center;">
              <span style="color:var(--text-muted); font-size:0.9rem;">Motion Sensor</span>
              <h3 style="font-size:1.8rem; margin-top:0.5rem; color:var(--accent-green);">${m.motion_detected ? 'ACTIVE' : 'IDLE'}</h3>
            </div>
            <div style="background:#0e121c; border:1px solid var(--border-card); padding:1.5rem; border-radius:16px; text-align:center;">
              <span style="color:var(--text-muted); font-size:0.9rem;">Idle Time</span>
              <h3 style="font-size:1.8rem; margin-top:0.5rem;">${m.idle || '00:00'}</h3>
            </div>
          </div>
          <button class="touch-btn btn-primary" id="fsSimulateMotion" style="font-size:1.2rem; padding:1rem 2.5rem;"><i class="fa-solid fa-person-walking"></i> Simulate Motion Activity</button>
        </div>
      `;
    }

    elOverlayContent.innerHTML = html;
    attachOverlayEventListeners(appId, data);
  }

  // Attach Full Screen Overlay Action Handlers
  function attachOverlayEventListeners(appId, data) {
    if (appId === "spotify") {
      const btnPlay = document.getElementById("fsSpotPlay");
      const btnPrev = document.getElementById("fsSpotPrev");
      const btnNext = document.getElementById("fsSpotNext");
      const scrubBar = document.getElementById("fsScrubBar");

      if (btnPlay) btnPlay.addEventListener("click", () => sendAction("spotify_toggle"));
      if (btnPrev) btnPrev.addEventListener("click", () => sendAction("spotify_prev"));
      if (btnNext) btnNext.addEventListener("click", () => sendAction("spotify_next"));

      if (scrubBar) {
        scrubBar.addEventListener("click", (e) => {
          const rect = scrubBar.getBoundingClientRect();
          const clickX = e.clientX - rect.left;
          const ratio = Math.max(0, Math.min(1, clickX / rect.width));
          const sp = data.apps.spotify || data.widgets.spotify || {};
          const duration = sp.duration_ms || 1;
          const targetMs = Math.round(ratio * duration);
          sendAction("spotify_seek", { position_ms: targetMs });
        });
      }
    } else if (appId === "timer") {
      const btnToggle = document.getElementById("fsTimerToggle");
      const btnReset = document.getElementById("fsTimerReset");
      if (btnToggle) btnToggle.addEventListener("click", () => sendAction("timer_toggle"));
      if (btnReset) btnReset.addEventListener("click", () => sendAction("timer_reset"));

      const t1 = document.getElementById("fsT1");
      const t2 = document.getElementById("fsT2");
      const t5 = document.getElementById("fsT5");
      const t10 = document.getElementById("fsT10");
      const t25 = document.getElementById("fsT25");

      if (t1) t1.addEventListener("click", () => sendAction("timer_sub_min"));
      if (t2) t2.addEventListener("click", () => sendAction("timer_add_min"));
      if (t5) t5.addEventListener("click", () => sendAction("timer_set_min", { minutes: 5 }));
      if (t10) t10.addEventListener("click", () => sendAction("timer_set_min", { minutes: 10 }));
      if (t25) t25.addEventListener("click", () => sendAction("timer_set_min", { minutes: 25 }));
    } else if (appId === "click_counter") {
      const btnPlus = document.getElementById("fsCountPlus");
      const btnMinus = document.getElementById("fsCountMinus");
      const btnReset = document.getElementById("fsCountReset");

      if (btnPlus) btnPlus.addEventListener("click", () => sendAction("counter_inc"));
      if (btnMinus) btnMinus.addEventListener("click", () => sendAction("counter_dec"));
      if (btnReset) btnReset.addEventListener("click", () => sendAction("counter_reset"));
    } else if (appId === "photo") {
      const form = document.getElementById("fsPhotoForm");
      if (form) {
        form.addEventListener("submit", async (e) => {
          e.preventDefault();
          const fileInput = document.getElementById("fsPhotoInput");
          if (!fileInput || !fileInput.files[0]) return;
          const file = fileInput.files[0];
          const reader = new FileReader();
          reader.onload = async () => {
            const base64 = reader.result.split(',')[1];
            try {
              await fetch("/api/photo/upload", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ image_base64: base64 })
              });
              fetchState();
            } catch (err) {
              console.error("Photo upload error:", err);
            }
          };
          reader.readAsDataURL(file);
        });
      }
    } else if (appId === "motion_status") {
      const btnSim = document.getElementById("fsSimulateMotion");
      if (btnSim) btnSim.addEventListener("click", () => sendAction("simulate_motion"));
    }

    // Direct DOM updates for rapidly changing values in full screen
    const fsSpProg = document.getElementById("fs-spotify-progress");
    if (fsSpProg) {
      const sp = data.apps.spotify || data.widgets.spotify || {};
      const pct = sp.duration_ms ? Math.min(100, (sp.progress_ms / sp.duration_ms) * 100) : 0;
      fsSpProg.style.width = `${pct}%`;
      
      const elCur = document.getElementById("fs-spotify-time-current");
      if (elCur) elCur.innerText = formatMs(sp.progress_ms || 0);
      const elDur = document.getElementById("fs-spotify-time-duration");
      if (elDur) elDur.innerText = formatMs(sp.duration_ms || 0);
    }

    const fsTmText = document.getElementById("fs-timer-text");
    if (fsTmText) {
      const tm = data.widgets.timer || {};
      if (fsTmText.innerText !== (tm.time_text || "05:00")) {
        fsTmText.innerText = tm.time_text || "05:00";
      }
    }
  }

  // Modal Widget Picker Handlers
  function openWidgetModal() {
    state.pickerSelected = [...state.slots];
    renderPickerGrid();
    elWidgetModal.classList.remove("hidden");
  }

  function closeWidgetModal() {
    elWidgetModal.classList.add("hidden");
  }

  function renderPickerGrid() {
    let html = "";
    AVAILABLE_APPS.forEach((app) => {
      const isSelected = state.pickerSelected.includes(app.id);
      html += `
        <div class="picker-item ${isSelected ? 'selected' : ''}" data-picker-id="${app.id}">
          <i class="${app.icon} picker-item-icon"></i>
          <div class="picker-item-info">
            <h4>${app.name}</h4>
            <p>${app.desc}</p>
          </div>
        </div>
      `;
    });
    elPickerGrid.innerHTML = html;
    updateSlotIndicator();

    document.querySelectorAll("[data-picker-id]").forEach((item) => {
      item.addEventListener("click", () => {
        const id = item.getAttribute("data-picker-id");
        if (state.pickerSelected.includes(id)) {
          state.pickerSelected = state.pickerSelected.filter(x => x !== id);
        } else {
          if (state.pickerSelected.length >= 3) {
            alert("Maximum 3 apps can be featured at a time on the dashboard!");
            return;
          }
          state.pickerSelected.push(id);
        }
        renderPickerGrid();
      });
    });
  }

  function updateSlotIndicator() {
    if (elSlotCountIndicator) {
      elSlotCountIndicator.textContent = `${state.pickerSelected.length} / 3 selected`;
    }
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

  function formatMs(ms) {
    if (!ms || ms < 0) return "0:00";
    const totalSec = Math.floor(ms / 1000);
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  // Start app on DOM ready
  document.addEventListener("DOMContentLoaded", init);
})();
