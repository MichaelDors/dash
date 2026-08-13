(function () {
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

  // State key refs to prevent innerHTML tearing
  let lastSlotsStateKey = "";
  let lastOverlayStateKey = "";

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

  // Dynamic Color Extraction for Spotify Album Art (Fetch Blob Same-Origin Canvas)
  let currentAlbumArtUrl = null;

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0, l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    return [h, s, l];
  }

  function hslToRgb(h, s, l) {
    let r, g, b;
    if (s === 0) {
      r = g = b = l;
    } else {
      const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      };
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1 / 3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1 / 3);
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }

  function ensureHighContrastColor(r, g, b) {
    let [h, s, l] = rgbToHsl(r, g, b);
    // Ensure vivid saturation (minimum 60%)
    if (s < 0.50) s = 0.65;
    // Ensure high contrast against dark background (lightness 58% - 72%)
    if (l < 0.55) l = 0.62;
    if (l > 0.78) l = 0.70;
    const [fr, fg, fb] = hslToRgb(h, s, l);
    return `#${((1 << 24) + (fr << 16) + (fg << 8) + fb).toString(16).slice(1)}`;
  }

  async function extractVibrantColorFromUrl(artUrl) {
    if (!artUrl) return null;
    try {
      const response = await fetch(artUrl, { mode: 'cors' });
      if (!response.ok) return null;
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);

      const img = new Image();
      img.src = objectUrl;
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = 40;
      canvas.height = 40;
      ctx.drawImage(img, 0, 0, 40, 40);
      URL.revokeObjectURL(objectUrl);

      const imageData = ctx.getImageData(0, 0, 40, 40);
      const data = imageData.data;

      let bestR = 0, bestG = 242, bestB = 254;
      let bestScore = -1;

      for (let i = 0; i < data.length; i += 8) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        const brightness = (r * 299 + g * 587 + b * 114) / 1000;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        if (max === 0) continue;
        const saturation = (max - min) / max;
        const isGrey = Math.abs(r - g) < 18 && Math.abs(g - b) < 18 && Math.abs(r - b) < 18;

        if (isGrey || brightness < 25 || brightness > 230 || saturation < 0.15) continue;

        const score = saturation * 0.85 + (brightness / 255) * 0.15;
        if (score > bestScore) {
          bestScore = score;
          bestR = r;
          bestG = g;
          bestB = b;
        }
      }
      if (bestScore > -1) {
        return ensureHighContrastColor(bestR, bestG, bestB);
      }
      return null;
    } catch (err) {
      console.warn("Client color extraction notice:", err);
      return null;
    }
  }

  function updateSpotifyAccentColor(bgImageUrl, colorExtractUrl) {
    if (!bgImageUrl) {
      document.documentElement.style.setProperty('--spotify-accent', '#00f2fe');
      document.documentElement.style.setProperty('--spotify-bg-image', 'none');
      return;
    }
    document.documentElement.style.setProperty('--spotify-bg-image', `url("${bgImageUrl}")`);

    const extractUrl = colorExtractUrl || bgImageUrl;
    if (extractUrl === currentAlbumArtUrl) return;
    currentAlbumArtUrl = extractUrl;

    extractVibrantColorFromUrl(extractUrl).then(color => {
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
  let isFetchingState = false;
  const elConnectionLostOverlay = document.getElementById("connectionLostOverlay");

  // Spotify auto open / auto close state management (mirroring OLED behavior)
  let wasSpotifyPlaying = false;
  let autoOpenedSpotifyOverlay = false;
  let lastUserClosedSpotifyTime = 0;
  let lastSpotifyFetchTime = 0;

  function handleSpotifyAutoOpenClose(data) {
    if (!data) return;
    const sp = (data.apps && data.apps.spotify) || (data.widgets && data.widgets.spotify) || {};
    const isPlaying = Boolean(sp.is_playing && sp.track_name);
    const now = Date.now();

    // 1. Auto Open when playback starts
    if (!wasSpotifyPlaying && isPlaying) {
      wasSpotifyPlaying = true;
      if (state.activeOverlayApp !== "spotify" && (now - lastUserClosedSpotifyTime > 10000)) {
        autoOpenedSpotifyOverlay = true;
        openOverlayApp("spotify");
      }
    } else if (wasSpotifyPlaying && !isPlaying) {
      wasSpotifyPlaying = false;
      // 2. Auto Close when playback stops if it was auto opened
      if (autoOpenedSpotifyOverlay && state.activeOverlayApp === "spotify") {
        autoOpenedSpotifyOverlay = false;
        closeOverlayApp();
      }
    } else if (isPlaying) {
      wasSpotifyPlaying = true;
    }

    // 3. Auto Exit on Idle (5 minutes of paused idle while Spotify overlay is active)
    if (state.activeOverlayApp === "spotify" && !isPlaying) {
      if (!state.spotifyIdleStartTime) {
        state.spotifyIdleStartTime = now;
      } else if (now - state.spotifyIdleStartTime > 300000) { // 5 minutes
        autoOpenedSpotifyOverlay = false;
        closeOverlayApp();
      }
    } else {
      state.spotifyIdleStartTime = null;
    }
  }

  function tickRealtimeProgress() {
    if (!state.latestData) return;
    const sp = (state.latestData.apps && state.latestData.apps.spotify) || (state.latestData.widgets && state.latestData.widgets.spotify);
    if (!sp || !sp.duration_ms || !sp.is_playing || !lastSpotifyFetchTime) return;

    const elapsed = Date.now() - lastSpotifyFetchTime;
    const estProgressMs = Math.min(sp.duration_ms, (sp.progress_ms || 0) + elapsed);
    const pct = Math.min(100, Math.max(0, (estProgressMs / sp.duration_ms) * 100));

    // Update mini widget progress fill
    const spProg = document.getElementById("widget-spotify-progress");
    if (spProg) spProg.style.width = `${pct}%`;

    // Update full screen overlay progress fill & current time text
    const fsSpProg = document.getElementById("fs-spotify-progress");
    if (fsSpProg) fsSpProg.style.width = `${pct}%`;

    const elCurTime = document.getElementById("fs-spotify-time-current");
    if (elCurTime) {
      const curText = formatMsToMinSec(estProgressMs);
      if (elCurTime.innerText !== curText) elCurTime.innerText = curText;
    }
  }

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
    setInterval(tickRealtimeProgress, 100);
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
    if (elBtnBackToDash) elBtnBackToDash.addEventListener("click", closeOverlayApp);

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

    // Modal triggers
    if (elBtnCloseModal) elBtnCloseModal.addEventListener("click", closeWidgetModal);
    if (elWidgetModal) {
      elWidgetModal.addEventListener("click", (e) => {
        if (e.target === elWidgetModal) closeWidgetModal();
      });
    }

    if (elBtnSaveConfig) elBtnSaveConfig.addEventListener("click", saveWidgetConfig);
  }

  // Mock Demo Data for Localhost / Preview fallback when real data is unavailable
  const MOCK_DEMO_DATA = {
    slots: ["spotify", "weather", "timer"],
    display_mode: "on",
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
        track_name: "Midnight City",
        artist_name: "M83",
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

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500);
      const res = await fetch("/api/wide/state", { cache: "no-store", signal: controller.signal });
      clearTimeout(timeoutId);

      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      state.latestData = data;
      lastSpotifyFetchTime = Date.now();
      if (Array.isArray(data.slots)) {
        state.slots = data.slots;
      }
      handleSpotifyAutoOpenClose(data);

      // Software update detection & auto-reload
      if (data.version) {
        if (lastSoftwareVersion && lastSoftwareVersion !== data.version) {
          console.log(`Software update detected (${lastSoftwareVersion} -> ${data.version}). Reloading interface...`);
          lastSoftwareVersion = data.version;
          window.location.reload();
          return;
        }
        lastSoftwareVersion = data.version;
      }

      // Remote reload requested from backend action
      if (data.reload_requested) {
        console.log("Remote reload requested by server. Reloading interface...");
        window.location.reload();
        return;
      }

      failedFetchCount = 0;
      if (isOffline) {
        isOffline = false;
        if (elConnectionLostOverlay) {
          elConnectionLostOverlay.classList.remove("visible");
          setTimeout(() => {
            if (!isOffline) elConnectionLostOverlay.classList.add("hidden");
          }, 1200);
        }
      }

      renderUI();

      if (isInitialLoad) {
        isInitialLoad = false;
        restoreSavedScreenState();
      }
    } catch (err) {
      // Only bypass network checks if running strictly via static file:// protocol without initial data
      const isFileProtocol = window.location.protocol === "file:";

      if (isFileProtocol && !state.latestData) {
        state.latestData = MOCK_DEMO_DATA;
        state.slots = MOCK_DEMO_DATA.slots;
        renderUI();
        if (isInitialLoad) {
          isInitialLoad = false;
          restoreSavedScreenState();
        }
        return;
      }

      failedFetchCount++;
      if (failedFetchCount >= 2 && !isOffline) {
        isOffline = true;
        if (elConnectionLostOverlay) {
          elConnectionLostOverlay.classList.remove("hidden");
          void elConnectionLostOverlay.offsetWidth;
          elConnectionLostOverlay.classList.add("visible");
        }
      }

      // If initial load failed over HTTP, set mock data so DOM elements render beneath the overlay
      if (!state.latestData) {
        state.latestData = MOCK_DEMO_DATA;
        state.slots = MOCK_DEMO_DATA.slots;
        renderUI();
        if (isInitialLoad) {
          isInitialLoad = false;
          restoreSavedScreenState();
        }
      }
    } finally {
      isFetchingState = false;
    }
  }

  async function sendAction(action, payload = {}) {
    const isLocalDev = window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1" ||
      window.location.protocol === "file:";

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

    // Spotify Dynamic Color Extraction & Background Image
    const spData = data.apps?.spotify || data.widgets?.spotify || {};
    const bgImage = spData.artist_image_url || spData.album_art_url;
    if (bgImage) {
      updateSpotifyAccentColor(bgImage, spData.album_art_url || bgImage);
    } else {
      document.documentElement.style.setProperty('--spotify-accent', '#00f2fe');
      document.documentElement.style.setProperty('--spotify-bg-image', 'none');
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

    // State key diffing to guarantee innerHTML is NEVER overwritten on 250ms polls unless track/state actually changed
    const sp = data.apps.spotify || data.widgets.spotify || {};
    const stateKey = JSON.stringify(activeSlots) + "_" + (sp.track_name || "") + "_" + (sp.album_art_url || "") + "_" + (sp.is_playing ? "1" : "0");

    if (lastSlotsStateKey !== stateKey) {
      lastSlotsStateKey = stateKey;
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

  // Gesture Handler: Long Press (>700ms) opens Widget Modal, Short Click/Tap opens App Overlay
  function setupCardTouchGestures(cardEl, appId) {
    let pressTimer = null;
    let isLongPress = false;

    cardEl.addEventListener("click", (e) => {
      if (e.target.closest(".mini-ctrl-btn") || e.target.closest("button") || e.target.closest("input") || e.target.closest(".spotify-progress-bar-wrap")) {
        return;
      }
      if (!isLongPress) {
        console.log("Card clicked, opening overlay for:", appId);
        openOverlayApp(appId);
      }
      isLongPress = false;
    });

    const startPress = (e) => {
      if (e.target.closest(".mini-ctrl-btn") || e.target.closest("button") || e.target.closest("input") || e.target.closest(".spotify-progress-bar-wrap")) {
        return;
      }
      isLongPress = false;
      cardEl.classList.add("holding");
      pressTimer = setTimeout(() => {
        isLongPress = true;
        cardEl.classList.remove("holding");
        if (navigator.vibrate) navigator.vibrate(40);
        openWidgetModal();
      }, 700);
    };

    const endPress = () => {
      cardEl.classList.remove("holding");
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
    };

    cardEl.addEventListener("touchstart", startPress, { passive: true });
    cardEl.addEventListener("touchend", endPress);
    cardEl.addEventListener("touchcancel", endPress);

    cardEl.addEventListener("mousedown", startPress);
    cardEl.addEventListener("mouseup", endPress);
    cardEl.addEventListener("mouseleave", endPress);
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
            <div class="spotify-progress-bar-wrap" id="widgetScrubBar" style="cursor: pointer;">
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

    attachSeekHandler("widgetScrubBar", "widget-spotify-progress");
  }

  // Full Screen Overlay Management
  function openOverlayApp(appId) {
    state.activeOverlayApp = appId;
    lastOverlayStateKey = "";
    try {
      sessionStorage.setItem("dash_saved_screen", JSON.stringify({ type: "app", id: appId }));
    } catch (e) { }

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
    const dataToRender = state.latestData || MOCK_DEMO_DATA;
    renderOverlayAppContent(appId, dataToRender);
  }

  function closeOverlayApp() {
    if (state.activeOverlayApp === "spotify") {
      lastUserClosedSpotifyTime = Date.now();
      autoOpenedSpotifyOverlay = false;
    }
    state.activeOverlayApp = null;
    lastOverlayStateKey = "";
    try {
      sessionStorage.setItem("dash_saved_screen", JSON.stringify({ type: "dashboard" }));
    } catch (e) { }
    elAppOverlayView.classList.add("hidden");
    elAppOverlayView.classList.remove("spotify-active");
  }

  // Settings Overlay Management
  function openSettingsOverlay() {
    state.settingsOpen = true;
    try {
      sessionStorage.setItem("dash_saved_screen", JSON.stringify({ type: "settings" }));
    } catch (e) { }
    elSettingsOverlayView.classList.remove("hidden");
    if (state.latestData) {
      updateSettingsMetrics(state.latestData);
    }
  }

  function closeSettingsOverlay() {
    state.settingsOpen = false;
    try {
      sessionStorage.setItem("dash_saved_screen", JSON.stringify({ type: "dashboard" }));
    } catch (e) { }
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

    const elCfgWifiStatus = document.getElementById("cfgWifiStatus");
    const elCfgWifiSSID = document.getElementById("cfgWifiSSID");
    if (elCfgWifiStatus || elCfgWifiSSID) {
      fetch("/api/wifi/status")
        .then(r => r.json())
        .then(st => {
          if (elCfgWifiStatus) elCfgWifiStatus.textContent = st.connected ? "Connected" : (st.ap_active ? "Setup AP Active" : "Disconnected");
          if (elCfgWifiSSID) elCfgWifiSSID.textContent = st.ssid || (st.ap_active ? "Dash-Setup" : "--");
        }).catch(() => {});
    }
  }

  function formatMsToMinSec(ms) {
    if (!ms || ms <= 0) return "0:00";
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${sec < 10 ? '0' : ''}${sec}`;
  }

  function updateFullScreenSpotifyUI(data) {
    const sp = data.apps?.spotify || data.widgets?.spotify || {};
    const isAuthenticated = sp.authenticated;
    const connState = sp.connection_state || (isAuthenticated ? (sp.track_name ? "active" : "idle") : "not_authenticated");

    if (!isAuthenticated || connState === "not_authenticated" || connState === "not_configured") {
      document.documentElement.style.setProperty('--spotify-bg-image', 'none');
      document.documentElement.style.setProperty('--spotify-accent', '#00f2fe');
      elOverlayContent.innerHTML = `
        <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; height:100%; gap:1.5rem;">
          <i class="fa-brands fa-spotify" style="font-size:5rem; color:#1db954;"></i>
          <div>
            <h1 style="font-size:2rem; font-weight:700; margin-bottom:0.5rem;">Spotify Not Connected</h1>
            <p style="color:var(--text-muted); font-size:1.1rem; max-width:500px;">Connect your Spotify account in Settings to view full-screen playback, artwork, and controls.</p>
          </div>
          <button class="touch-btn btn-primary" id="fsOpenSettingsBtn" style="font-size:1.2rem; padding:0.8rem 2.2rem; margin-top:0.5rem;">
            <i class="fa-solid fa-gear"></i> Open System Settings
          </button>
        </div>
      `;
      const btnSettings = document.getElementById("fsOpenSettingsBtn");
      if (btnSettings) {
        btnSettings.addEventListener("click", () => {
          closeOverlayApp();
          openSettingsOverlay();
        });
      }
      return;
    }

    if (!sp.track_name || connState === "idle") {
      document.documentElement.style.setProperty('--spotify-bg-image', 'none');
      document.documentElement.style.setProperty('--spotify-accent', '#1db954');
      elOverlayContent.innerHTML = `
        <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; height:100%; gap:1.5rem;">
          <div style="width:100px; height:100px; border-radius:50%; background:rgba(29,185,84,0.1); border:2px solid rgba(29,185,84,0.3); display:flex; align-items:center; justify-content:center;">
            <i class="fa-brands fa-spotify" style="font-size:3.5rem; color:#1db954;"></i>
          </div>
          <div>
            <h1 style="font-size:2.2rem; font-weight:700; color:#ffffff; margin-bottom:0.5rem;">Nothing Playing</h1>
            <p style="color:var(--text-muted); font-size:1.15rem; max-width:520px; line-height:1.5;">Play music on any phone, desktop app, or smart speaker</p>
          </div>
        </div>
      `;
      return;
    }

    const track = sp.track_name || "No Track Playing";
    const artist = sp.artist_name || "Unknown Artist";
    const isPlaying = sp.is_playing;
    const albumArt = sp.album_art_url || "";
    const progressMs = sp.progress_ms || 0;
    const durationMs = sp.duration_ms || 1;
    const pct = Math.min(100, Math.max(0, (progressMs / durationMs) * 100));

    // Render static DOM structure once
    const container = document.getElementById("fsSpotifyContainer");
    if (!container) {
      elOverlayContent.innerHTML = `
        <div class="fs-spotify-container" id="fsSpotifyContainer">
          <div class="fs-spotify-art-wrapper" id="fsSpotArtWrap">
            <img src="${escapeHTML(albumArt)}" class="fs-spotify-art-large" id="fsSpotArtImg" alt="Album Art" />
            <div class="art-sweep-flash" id="fsSpotSweep"></div>
          </div>
          <div class="fs-spotify-details">
            <div>
              <h1 class="fs-spotify-title" id="fsSpotTitle">${escapeHTML(track)}</h1>
              <h2 class="fs-spotify-artist" id="fsSpotArtist">${escapeHTML(artist)}</h2>
            </div>
            <div class="fs-spotify-scrub-wrap">
              <div class="fs-spotify-progress" id="fsScrubBar" style="cursor: pointer;">
                <div class="fs-spotify-progress-fill" id="fs-spotify-progress" style="width:${pct}%;"></div>
              </div>
              <div class="fs-spotify-time-row">
                <span id="fs-spotify-time-current">${escapeHTML(sp.progress_text || formatMsToMinSec(progressMs))}</span>
                <span id="fs-spotify-time-duration">${escapeHTML(sp.duration_text || formatMsToMinSec(durationMs))}</span>
              </div>
            </div>
            <div class="fs-spotify-controls">
              <button class="fs-ctrl-btn" id="fsSpotPrev"><i class="fa-solid fa-backward-step"></i></button>
              <button class="fs-ctrl-btn fs-play-btn" id="fsSpotPlay">
                <i class="fa-solid ${isPlaying ? 'fa-pause' : 'fa-play'}" id="fsSpotPlayIcon"></i>
              </button>
              <button class="fs-ctrl-btn" id="fsSpotNext"><i class="fa-solid fa-forward-step"></i></button>
            </div>
          </div>
        </div>
      `;
      attachOverlayEventListeners("spotify", data);
    }

    // Direct DOM updates on every 250ms poll
    const elTitle = document.getElementById("fsSpotTitle");
    if (elTitle && elTitle.innerText !== track) elTitle.innerText = track;

    const elArtist = document.getElementById("fsSpotArtist");
    if (elArtist && elArtist.innerText !== artist) elArtist.innerText = artist;

    const elArtImg = document.getElementById("fsSpotArtImg");
    if (elArtImg) {
      if (albumArt) {
        if (elArtImg.src !== albumArt) {
          elArtImg.src = albumArt;
          elArtImg.style.display = "block";
          const sweep = document.getElementById("fsSpotSweep");
          if (sweep) {
            sweep.classList.remove("flash-active");
            void sweep.offsetWidth;
            sweep.classList.add("flash-active");
          }
        }
      } else {
        elArtImg.style.display = "none";
      }
    }

    const elProg = document.getElementById("fs-spotify-progress");
    if (elProg) elProg.style.width = `${pct}%`;

    const elCurTime = document.getElementById("fs-spotify-time-current");
    if (elCurTime) {
      const curText = sp.progress_text || formatMsToMinSec(progressMs);
      if (elCurTime.innerText !== curText) elCurTime.innerText = curText;
    }

    const elDurTime = document.getElementById("fs-spotify-time-duration");
    if (elDurTime) {
      const durText = sp.duration_text || formatMsToMinSec(durationMs);
      if (elDurTime.innerText !== durText) elDurTime.innerText = durText;
    }

    const elPlayIcon = document.getElementById("fsSpotPlayIcon");
    if (elPlayIcon) {
      const iconClass = `fa-solid ${isPlaying ? 'fa-pause' : 'fa-play'}`;
      if (elPlayIcon.className !== iconClass) elPlayIcon.className = iconClass;
    }

    // Live background image & accent color update
    const bgImage = sp.artist_image_url || sp.album_art_url;
    if (bgImage) {
      updateSpotifyAccentColor(bgImage, sp.album_art_url || bgImage);
    }
  }

  // Render Full Screen App Content
  function renderOverlayAppContent(appId, data) {
    if (appId === "spotify") {
      updateFullScreenSpotifyUI(data);
      return;
    }

    let html = "";
    if (appId === "timer") {
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

    const sp = data.apps.spotify || data.widgets.spotify || {};
    const overlayStateKey = appId + "_" + (sp.track_name || "") + "_" + (sp.album_art_url || "") + "_" + (sp.is_playing ? "1" : "0");

    if (lastOverlayStateKey !== overlayStateKey) {
      lastOverlayStateKey = overlayStateKey;
      elOverlayContent.innerHTML = html;
      attachOverlayEventListeners(appId, data);
    }
  }

  function attachSeekHandler(barId, fillId) {
    const bar = document.getElementById(barId);
    if (!bar) return;

    const handleSeek = (e) => {
      if (e.type === "touchstart") {
        e.preventDefault(); // Prevents ghost click event from firing 300ms later on touch screens!
      }
      e.stopPropagation();

      const rect = bar.getBoundingClientRect();
      let clientX = e.clientX;
      if (e.touches && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
      } else if (e.changedTouches && e.changedTouches.length > 0) {
        clientX = e.changedTouches[0].clientX;
      }

      if (clientX === undefined || clientX === null || isNaN(clientX)) return;

      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const sp = state.latestData?.apps?.spotify || state.latestData?.widgets?.spotify || {};
      const duration = sp.duration_ms || 1;
      const targetMs = Math.round(ratio * duration);

      const fill = document.getElementById(fillId);
      if (fill) fill.style.width = `${ratio * 100}%`;

      sendAction("spotify_seek", { position_ms: targetMs });
    };

    bar.addEventListener("click", handleSeek);
    bar.addEventListener("touchstart", handleSeek, { passive: false });
  }

  // Attach Full Screen Overlay Action Handlers
  function attachOverlayEventListeners(appId, data) {
    if (appId === "spotify") {
      const btnPlay = document.getElementById("fsSpotPlay");
      const btnPrev = document.getElementById("fsSpotPrev");
      const btnNext = document.getElementById("fsSpotNext");

      if (btnPlay) btnPlay.addEventListener("click", () => sendAction("spotify_toggle"));
      if (btnPrev) btnPrev.addEventListener("click", () => sendAction("spotify_prev"));
      if (btnNext) btnNext.addEventListener("click", () => sendAction("spotify_next"));

      attachSeekHandler("fsScrubBar", "fs-spotify-progress");
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

  // Screen Restoration after Reload
  function restoreSavedScreenState() {
    try {
      const saved = JSON.parse(sessionStorage.getItem("dash_saved_screen") || "null");
      if (saved && saved.type === "app" && saved.id) {
        openOverlayApp(saved.id);
      } else if (saved && saved.type === "settings") {
        openSettingsOverlay();
      }

      const savedModal = sessionStorage.getItem("dash_saved_modal");
      if (savedModal === "widget_picker") {
        openWidgetModal();
      }
    } catch (e) {
      console.warn("Could not restore saved screen state:", e);
    }
  }

  // Modal Widget Picker Handlers
  function openWidgetModal() {
    state.pickerSelected = [...state.slots];
    try {
      sessionStorage.setItem("dash_saved_modal", "widget_picker");
    } catch (e) { }
    renderPickerGrid();
    elWidgetModal.classList.remove("hidden");
  }

  function closeWidgetModal() {
    try {
      sessionStorage.removeItem("dash_saved_modal");
    } catch (e) { }
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
