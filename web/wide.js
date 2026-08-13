(function() {
  "use strict";

  // Available apps definition
  const AVAILABLE_APPS = [
    { id: "spotify", name: "Spotify Player", icon: "🎵", desc: "Playback & Track Controls" },
    { id: "weather", name: "Weather Forecast", icon: "🌤", desc: "Local Temp & Conditions" },
    { id: "timer", name: "Countdown Timer", icon: "⏱", desc: "Timer & Alarm Controls" },
    { id: "click_counter", name: "Tally Counter", icon: "🔢", desc: "Touch Click Counter" },
    { id: "photo", name: "Photo Frame", icon: "🖼", desc: "Image Display & Upload" },
    { id: "motion_status", name: "System Status", icon: "⚙️", desc: "Motion & System Diagnostics" }
  ];

  let state = {
    slots: ["spotify", "weather"],
    activeOverlayApp: null,
    latestData: null,
    pickerSelected: ["spotify", "weather"]
  };

  // DOM Elements
  const elAppGrid = document.getElementById("dashboardGrid");
  const elSlotsContainer = document.getElementById("slotsContainer");
  const elAppOverlayView = document.getElementById("appOverlayView");
  const elOverlayContent = document.getElementById("appOverlayContent");
  const elOverlayAppTitle = document.getElementById("overlayAppTitle");
  const elOverlayAppSubtitle = document.getElementById("overlayAppSubtitle");
  const elBtnBackToDash = document.getElementById("btnBackToDash");
  
  // Status badges
  const elBadgeDisplay = document.getElementById("badgeDisplay");
  const elBadgeMotion = document.getElementById("badgeMotion");
  const elBadgeSpotify = document.getElementById("badgeSpotify");
  const elBtnManageWidgets = document.getElementById("btnManageWidgets");

  // Hero Time elements
  const elHeroDay = document.getElementById("heroDay");
  const elHeroDate = document.getElementById("heroDate");
  const elHeroTime = document.getElementById("heroTime");
  const elHeroSeconds = document.getElementById("heroSeconds");
  const elHeroWeatherText = document.getElementById("heroWeatherText");

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
    // Back from full screen app
    elBtnBackToDash.addEventListener("click", () => {
      closeOverlayApp();
    });

    // Time hero card tap -> opens Time/System or Weather overlay if clicked
    document.getElementById("cardTime").addEventListener("click", () => {
      openOverlayApp("motion_status");
    });

    // Modal triggers
    elBtnManageWidgets.addEventListener("click", openWidgetModal);
    elBtnCloseModal.addEventListener("click", closeWidgetModal);
    elWidgetModal.addEventListener("click", (e) => {
      if (e.target === elWidgetModal) closeWidgetModal();
    });

    elBtnSaveConfig.addEventListener("click", saveWidgetConfig);
  }

  // API Calls
  async function fetchState() {
    try {
      const res = await fetch("/api/wide/state");
      if (!res.ok) return;
      const data = await res.json();
      state.latestData = data;
      if (Array.isArray(data.slots)) {
        state.slots = data.slots;
      }
      renderUI();
    } catch (err) {
      console.warn("Failed to fetch wide state:", err);
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

    // Update Status Cluster Badges
    if (elBadgeDisplay) {
      const mode = (data.display_mode || "on").toUpperCase();
      elBadgeDisplay.textContent = `DISPLAY ${mode}`;
    }

    if (elBadgeMotion && data.motion) {
      const isMotion = data.motion.motion_detected;
      elBadgeMotion.textContent = isMotion ? "MOTION DETECTED" : "MOTION IDLE";
      elBadgeMotion.className = isMotion ? "status-badge badge-success" : "status-badge badge-soft";
    }

    if (elBadgeSpotify && data.spotify_status) {
      const auth = data.spotify_status.authenticated;
      elBadgeSpotify.textContent = auth ? "SPOTIFY CONNECTED" : "SPOTIFY OFF";
      elBadgeSpotify.className = auth ? "status-badge badge-success" : "status-badge badge-soft";
    }

    // Render Persistent Time Hero Card
    updateHeroTime(data.widgets.time, data.widgets.weather);

    // Update Dashboard Grid Slots
    renderDashboardSlots(data);

    // If Overlay App is open, update its content live!
    if (state.activeOverlayApp) {
      renderOverlayAppContent(state.activeOverlayApp, data);
    }
  }

  // Hero Time update
  function updateHeroTime(timeWidget, weatherWidget) {
    const now = timeWidget || {};
    const days = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
    const d = new Date();

    if (elHeroDay) elHeroDay.textContent = now.day ? days[d.getDay()] : days[d.getDay()];
    if (elHeroDate) elHeroDate.textContent = now.month ? `${now.month} ${now.date}, ${now.year}` : d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
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

    elSlotsContainer.innerHTML = html;

    // Attach click handlers to cards and inner buttons
    activeSlots.slice(0, 3).forEach((appId) => {
      const cardEl = document.getElementById(`card_${appId}`);
      if (cardEl) {
        cardEl.addEventListener("click", (e) => {
          // If tap was on a control button, don't open full screen overlay
          if (e.target.closest(".mini-ctrl-btn") || e.target.closest("button") || e.target.closest("input")) {
            return;
          }
          openOverlayApp(appId);
        });
      }
    });

    // Attach inner touch action buttons
    attachSlotActionListeners();
  }

  // Create Card HTML for Dashboard Grid
  function createWidgetCardHTML(appId, data) {
    const appDef = AVAILABLE_APPS.find(a => a.id === appId) || { name: appId, icon: "📱" };
    let bodyHTML = "";

    if (appId === "spotify") {
      const sp = data.apps.spotify || data.widgets.spotify || {};
      const track = sp.track_name || "No Track Playing";
      const artist = sp.artist_name || "Connect Spotify";
      const isPlaying = sp.is_playing;
      const progress = sp.duration_ms ? Math.min(100, (sp.progress_ms / sp.duration_ms) * 100) : 0;

      bodyHTML = `
        <div class="spotify-card-content">
          <div class="spotify-track-info">
            <h3 class="spotify-track-title">${escapeHTML(track)}</h3>
            <p class="spotify-artist-name">${escapeHTML(artist)}</p>
          </div>
          <div class="spotify-progress-bar-wrap">
            <div class="spotify-progress-fill" style="width: ${progress}%"></div>
          </div>
          <div class="spotify-mini-controls">
            <button class="mini-ctrl-btn" data-act="spotify_prev">⏮</button>
            <button class="mini-ctrl-btn btn-play-main" data-act="spotify_toggle">${isPlaying ? '⏸' : '▶'}</button>
            <button class="mini-ctrl-btn" data-act="spotify_next">⏭</button>
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
          <span class="weather-location-label">📍 ${escapeHTML(location)}</span>
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
          <div class="timer-digits-display">${timeText}</div>
          <div class="timer-controls-row">
            <button class="touch-btn" data-act="timer_sub_min">-1m</button>
            <button class="touch-btn btn-primary" data-act="timer_toggle">${running ? 'Pause' : 'Start'}</button>
            <button class="touch-btn" data-act="timer_add_min">+1m</button>
          </div>
        </div>
      `;
    } else if (appId === "click_counter") {
      const cnt = data.widgets.click_counter || {};
      const count = cnt.count ?? 0;

      bodyHTML = `
        <div class="counter-card-content">
          <div class="counter-digits-display">${count}</div>
          <div class="timer-controls-row">
            <button class="touch-btn" data-act="counter_dec">-1</button>
            <button class="touch-btn btn-primary" data-act="counter_inc">+1 Tap</button>
            <button class="touch-btn" data-act="counter_reset">Reset</button>
          </div>
        </div>
      `;
    } else if (appId === "photo") {
      const ph = data.widgets.photo || {};
      if (ph.has_image && ph.image_base64) {
        bodyHTML = `
          <div class="photo-card-content">
            <img src="data:image/png;base64,${ph.image_base64}" class="photo-preview-img" alt="Photo" />
          </div>
        `;
      } else {
        bodyHTML = `
          <div class="photo-card-content" style="color:var(--text-muted); text-align:center;">
            <span>📷 No Photo Uploaded</span>
          </div>
        `;
      }
    } else if (appId === "motion_status") {
      const m = data.motion || {};
      bodyHTML = `
        <div class="weather-card-content">
          <span class="weather-location-label">Display: ${(data.display_mode || 'ON').toUpperCase()}</span>
          <span class="weather-temp-main" style="font-size:2.2rem; color:var(--accent-cyan);">${m.motion_detected ? 'ACTIVE' : 'IDLE'}</span>
          <button class="touch-btn" data-act="simulate_motion" style="margin-top:0.5rem;">Simulate Motion</button>
        </div>
      `;
    }

    return `
      <article class="widget-card" id="card_${appId}" data-app-id="${appId}">
        <div class="card-glow"></div>
        <header class="card-header">
          <div class="card-title-group">
            <span class="card-icon">${appDef.icon}</span>
            <h2 class="card-title">${appDef.name}</h2>
          </div>
          <span class="card-expand-hint">Expand ⤢</span>
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
    const appDef = AVAILABLE_APPS.find(a => a.id === appId) || { name: appId, icon: "📱" };

    if (elOverlayAppTitle) elOverlayAppTitle.textContent = `${appDef.icon} ${appDef.name}`;
    if (elOverlayAppSubtitle) elOverlayAppSubtitle.textContent = `Full Screen Touch View`;

    elAppOverlayView.classList.remove("hidden");
    if (state.latestData) {
      renderOverlayAppContent(appId, state.latestData);
    }
  }

  function closeOverlayApp() {
    state.activeOverlayApp = null;
    elAppOverlayView.classList.add("hidden");
  }

  // Render Full Screen App Content
  function renderOverlayAppContent(appId, data) {
    let html = "";

    if (appId === "spotify") {
      const sp = data.apps.spotify || data.widgets.spotify || {};
      const track = sp.track_name || "No Track Playing";
      const artist = sp.artist_name || "Connect Spotify in web UI";
      const isPlaying = sp.is_playing;
      const progressMs = sp.progress_ms || 0;
      const durationMs = sp.duration_ms || 1;
      const pct = Math.min(100, (progressMs / durationMs) * 100);

      html = `
        <div class="fs-spotify-container">
          <div class="fs-spotify-art-box">
            🎵
          </div>
          <div class="fs-spotify-details">
            <div>
              <h1 class="fs-spotify-title">${escapeHTML(track)}</h1>
              <h2 class="fs-spotify-artist">${escapeHTML(artist)}</h2>
            </div>
            <div class="fs-spotify-scrub-wrap">
              <div class="fs-scrub-bar" id="fsScrubBar">
                <div class="fs-scrub-fill" style="width: ${pct}%"></div>
              </div>
              <div class="fs-scrub-times">
                <span>${formatMs(progressMs)}</span>
                <span>${formatMs(durationMs)}</span>
              </div>
            </div>
            <div class="fs-spotify-controls">
              <button class="fs-ctrl-btn" id="fsSpotPrev">⏮</button>
              <button class="fs-ctrl-btn fs-play-btn" id="fsSpotPlay">${isPlaying ? '⏸' : '▶'}</button>
              <button class="fs-ctrl-btn" id="fsSpotNext">⏭</button>
            </div>
          </div>
        </div>
      `;
    } else if (appId === "timer") {
      const tm = data.widgets.timer || {};
      const timeText = tm.time_text || "05:00";
      const running = tm.running;

      html = `
        <div class="fs-timer-container">
          <div class="fs-timer-digits">${timeText}</div>
          <div class="fs-timer-btn-group">
            <button class="touch-btn btn-primary" id="fsTimerToggle" style="font-size:1.4rem; padding:1rem 2.5rem;">${running ? 'Pause Timer' : 'Start Timer'}</button>
            <button class="touch-btn" id="fsTimerReset" style="font-size:1.4rem; padding:1rem 2.5rem;">Reset</button>
          </div>
          <div class="fs-timer-preset-group">
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
            <button class="touch-btn counter-pad" id="fsCountMinus" style="background:rgba(239, 68, 68, 0.2); border-color:rgba(239, 68, 68, 0.4); color:#fca5a5;">-1</button>
            <button class="touch-btn counter-pad" id="fsCountPlus" style="background:rgba(0, 242, 254, 0.2); border-color:var(--accent-cyan); color:#fff;">+1</button>
          </div>
          <button class="touch-btn" id="fsCountReset" style="font-size:1.2rem; padding:0.8rem 2rem;">Reset Counter</button>
        </div>
      `;
    } else if (appId === "weather") {
      const w = data.widgets.weather || {};
      const temp = w.temperature_f != null ? `${Math.round(w.temperature_f)}°F` : "--";
      const location = w.location || w.location_query || "Location Not Set";
      const condition = w.condition || "Unknown";

      html = `
        <div class="fs-counter-container">
          <span style="font-size:1.5rem; color:var(--text-muted);">📍 ${escapeHTML(location)}</span>
          <div style="font-size:7rem; font-weight:800; font-family:var(--font-mono); color:var(--accent-gold);">${temp}</div>
          <span style="font-size:2rem; font-weight:600;">${escapeHTML(condition)}</span>
          
          <form id="fsWeatherForm" style="display:flex; gap:0.75rem; margin-top:2rem; width:100%; max-width:480px;">
            <input type="text" id="fsWeatherInput" placeholder="Enter City or ZIP" style="flex:1; padding:0.8rem 1.2rem; border-radius:12px; border:1px solid rgba(255,255,255,0.2); background:rgba(0,0,0,0.5); color:#fff; font-size:1.1rem;" required />
            <button type="submit" class="touch-btn btn-primary" style="padding:0.8rem 1.5rem;">Update</button>
          </form>
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
            <span style="font-size:4rem;">📷</span>
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
            <div style="background:rgba(255,255,255,0.05); padding:1.5rem; border-radius:16px; text-align:center;">
              <span style="color:var(--text-muted); font-size:0.9rem;">Display Mode</span>
              <h3 style="font-size:1.8rem; margin-top:0.5rem; color:var(--accent-cyan);">${(data.display_mode || 'ON').toUpperCase()}</h3>
            </div>
            <div style="background:rgba(255,255,255,0.05); padding:1.5rem; border-radius:16px; text-align:center;">
              <span style="color:var(--text-muted); font-size:0.9rem;">Motion Sensor</span>
              <h3 style="font-size:1.8rem; margin-top:0.5rem; color:var(--accent-green);">${m.motion_detected ? 'ACTIVE' : 'IDLE'}</h3>
            </div>
            <div style="background:rgba(255,255,255,0.05); padding:1.5rem; border-radius:16px; text-align:center;">
              <span style="color:var(--text-muted); font-size:0.9rem;">Idle Time</span>
              <h3 style="font-size:1.8rem; margin-top:0.5rem;">${m.idle || '00:00'}</h3>
            </div>
          </div>
          <button class="touch-btn btn-primary" id="fsSimulateMotion" style="font-size:1.2rem; padding:1rem 2.5rem;">Simulate Motion Activity</button>
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
    } else if (appId === "weather") {
      const form = document.getElementById("fsWeatherForm");
      if (form) {
        form.addEventListener("submit", async (e) => {
          e.preventDefault();
          const input = document.getElementById("fsWeatherInput");
          if (!input || !input.value) return;
          try {
            await fetch("/api/weather/location", {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: `location=${encodeURIComponent(input.value)}`
            });
            fetchState();
          } catch (err) {
            console.error("Failed to update weather:", err);
          }
        });
      }
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
          <span class="picker-item-icon">${app.icon}</span>
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
      elSlotCountIndicator.textContent = `${state.pickerSelected.length} / 3 apps selected`;
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
