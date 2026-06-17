const POLL_MS = 400;
let pollHandle = null;
let latestState = null;

const widgetBody = document.getElementById("widgetBody");
const widgetName = document.getElementById("widgetName");
const widgetHint = document.getElementById("widgetHint");
const widgetTabs = document.getElementById("widgetTabs");
const displayMode = document.getElementById("displayMode");
const motionState = document.getElementById("motionState");
const lastUpdate = document.getElementById("lastUpdate");
const controlButtons = Array.from(document.querySelectorAll("[data-action]"));
const holdButton = document.querySelector("[data-action='hold']");
let holdKeyActive = false;

function updateStamp() {
  const now = new Date();
  lastUpdate.textContent = now.toLocaleTimeString();
}

async function fetchState() {
  try {
    const response = await fetch("/api/state", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    latestState = await response.json();
    render(latestState);
  } catch (error) {
    widgetName.textContent = "Connection issue";
    widgetHint.textContent = "Unable to load state from the backend.";
    widgetBody.innerHTML = `<p class="counter-help">${String(error)}</p>`;
  }
}

async function sendAction(action) {
  try {
    const response = await fetch("/api/action", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ action })
    });

    if (!response.ok) {
      throw new Error(`Action failed: HTTP ${response.status}`);
    }

    latestState = await response.json();
    render(latestState);
  } catch (error) {
    console.error(error);
  }
}

let photoUploadStatus = "";
const STATUS_CLEAR_MS = 5000;
let weatherLocationStatus = "";
const WEATHER_STATUS_CLEAR_MS = 5000;

async function handlePhotoUpload(event) {
  const file = event.target.files[0];
  if (!file) {
    return;
  }

  photoUploadStatus = "Uploading and converting\u2026";

  const MAX_DIM = 1024;
  const url = URL.createObjectURL(file);
  const img = new Image();

  img.onload = async function () {
    try {
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      if (w > MAX_DIM || h > MAX_DIM) {
        const scale = MAX_DIM / Math.max(w, h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);

      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);

      const response = await fetch("/api/photo/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: dataUrl })
      });
      if (!response.ok) {
        const err = await response.json();
        photoUploadStatus = "Upload failed: " + (err.error || response.status);
        console.error("Photo upload failed:", err.error || response.status);
        setTimeout(function () { photoUploadStatus = ""; }, STATUS_CLEAR_MS);
        return;
      }
      photoUploadStatus = "";
      fetchState();
    } catch (error) {
      photoUploadStatus = "Upload error: " + error.message;
      console.error("Photo upload error:", error);
      setTimeout(function () { photoUploadStatus = ""; }, STATUS_CLEAR_MS);
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  img.onerror = function () {
    URL.revokeObjectURL(url);
    photoUploadStatus = "Unable to load image. Format may not be supported by your browser.";
    console.error("Photo load error: could not decode image");
    setTimeout(function () { photoUploadStatus = ""; }, STATUS_CLEAR_MS);
  };

  img.src = url;
}

async function setWeatherLocation(query) {
  const trimmed = String(query || "").trim();
  if (!trimmed) {
    weatherLocationStatus = "Enter a location to continue.";
    setTimeout(function () { weatherLocationStatus = ""; }, WEATHER_STATUS_CLEAR_MS);
    if (latestState) {
      render(latestState);
    }
    return;
  }

  try {
    const response = await fetch("/api/weather/location", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ location: trimmed })
    });
    const payload = await response.json();

    if (!response.ok) {
      weatherLocationStatus = payload.error || `Error: HTTP ${response.status}`;
      setTimeout(function () { weatherLocationStatus = ""; }, WEATHER_STATUS_CLEAR_MS);
      if (latestState) {
        render(latestState);
      }
      return;
    }

    weatherLocationStatus = "";
    latestState = payload;
    render(latestState);
  } catch (error) {
    weatherLocationStatus = "Unable to update location.";
    setTimeout(function () { weatherLocationStatus = ""; }, WEATHER_STATUS_CLEAR_MS);
    console.error(error);
  }
}

function handleGlobalWeatherSubmit(event) {
  event.preventDefault();
  const input = document.getElementById("globalWeatherLocation");
  if (!input) {
    return;
  }
  setWeatherLocation(input.value);
}

const globalWeatherForm = document.getElementById("globalWeatherForm");
if (globalWeatherForm) {
  globalWeatherForm.addEventListener("submit", handleGlobalWeatherSubmit);
}

function render(state) {
  updateStamp();

  const motion = state.motion || {};
  const active = state.active_widget || null;
  const mode = state.mode || "widgets";
  const activeApp = state.active_app || null;
  const appExit = state.app_exit || {};

  displayMode.textContent = `DISPLAY ${String(state.display_mode || "on").toUpperCase()}`;
  motionState.textContent = motion.motion_detected ? "MOTION YES" : "MOTION NO";

  document.body.classList.toggle("app-mode", mode === "app");
  renderTabs(state.widgets || [], mode);
  updateControls(mode);

  if (mode === "app" && activeApp) {
    widgetName.textContent = activeApp.name || "App";
    widgetHint.textContent = "Hold dial for 3 seconds to exit.";
    widgetBody.classList.add("app-mode");
    widgetBody.innerHTML = renderApp(activeApp, appExit);
    return;
  }

  widgetBody.classList.remove("app-mode");

  if (!active) {
    widgetName.textContent = "No widget";
    widgetHint.textContent = "No active widget available.";
    widgetBody.innerHTML = "";
    return;
  }

  widgetName.textContent = active.name || "Widget";
  widgetHint.textContent = hintForWidget(active.type);
  widgetBody.innerHTML = renderWidget(active, motion);

  // Ensure photo upload handler is bound even if 'change' doesn't bubble reliably.
  if (active.type === "photo") {
    const input = widgetBody.querySelector(".photo-upload-input");
    if (input && !input.__dashPhotoBound) {
      input.addEventListener("change", handlePhotoUpload);
      input.__dashPhotoBound = true;
    }
  }
  // Sync global weather input if not focused
  const weatherWidget = state.widgets && state.widgets.find(w => w.type === "weather");
  if (weatherWidget) {
    const globalInput = document.getElementById("globalWeatherLocation");
    if (globalInput && document.activeElement !== globalInput) {
      globalInput.value = weatherWidget.location_query || "";
    }
  }
}

function updateControls(mode) {
  const appMode = mode === "app";
  controlButtons.forEach((button) => {
    const action = button.dataset.action;
    const disable = appMode && action === "simulate_motion";
    button.disabled = disable;
    button.classList.toggle("disabled", disable);
  });
}

widgetBody.addEventListener("change", function (event) {
  if (event.target.classList.contains("photo-upload-input")) {
    handlePhotoUpload(event);
  }
});

function renderTabs(widgets, mode) {
  widgetTabs.innerHTML = "";
  const appMode = mode === "app";

  widgets.forEach((widget) => {
    const button = document.createElement("button");
    button.className = `widget-tab${widget.active ? " active" : ""}${widget.kind === "app" ? " app" : ""}`;
    button.type = "button";
    button.textContent = widget.name;
    if (widget.kind === "app") {
      const tag = document.createElement("span");
      tag.className = "widget-tag";
      tag.textContent = "APP";
      button.appendChild(tag);
    }
    button.disabled = appMode;

    if (!appMode) {
      button.addEventListener("click", () => {
        if (!latestState || !Array.isArray(latestState.widgets)) {
          return;
        }

        const currentIndex = latestState.widgets.findIndex((item) => item.active);
        const targetIndex = latestState.widgets.findIndex((item) => item.id === widget.id);
        if (currentIndex === -1 || targetIndex === -1 || currentIndex === targetIndex) {
          return;
        }

        const total = latestState.widgets.length;
        const forward = (targetIndex - currentIndex + total) % total;
        const backward = (currentIndex - targetIndex + total) % total;
        const direction = forward <= backward ? "next" : "previous";
        const count = Math.min(forward, backward);

        for (let i = 0; i < count; i += 1) {
          sendAction(direction);
        }
      });
    }

    widgetTabs.appendChild(button);
  });
}

function hintForWidget(type) {
  switch (type) {
    case "time":
      return "Clock view updates continuously.";
    case "click_counter":
      return "Press to increment. Hold to reset.";
    case "timer":
      return "Press to start/stop. Use +/- minute controls.";
    case "motion_status":
      return "Shows PIR and inactivity state.";
    case "weather":
      return "Enter a location to fetch current weather.";
    case "version_status":
      return "Shows local/remote VERSION details.";
    case "photo":
      return "Upload a photo to convert to black & white. Hold to clear.";
    case "app_launcher":
      return "Press dial to launch. Hold dial 3s to exit the app.";
    default:
      return "Use controls below to interact.";
  }
}

function renderApp(app, exitState) {
  if (app.type === "pong") {
    return renderPong(app, exitState);
  }
  if (app.type === "spotify") {
    return renderSpotify(app, exitState);
  }
  if (app.type === "settings") {
    return renderSettings(app, exitState);
  }
  return `<p class="counter-help">Unsupported app type: ${app.type}</p>`;
}

function renderSettings(app, exitState) {
  const exitProgressRaw = Number(exitState.progress || 0);
  const exitProgress = Math.max(0, Math.min(1, exitProgressRaw));
  const view = app.current_view || "main";
  
  let content = "";
  
  if (view === "main") {
    const idx = app.main_menu_idx;
    const options = app.main_menu_options || [];
    content = `<div style="display: flex; flex-direction: column; width: 100%; gap: 0.5rem; margin-top: 1rem;">`;
    options.forEach((opt, i) => {
      const active = i === idx ? "background: var(--text-color); color: var(--bg-color);" : "border: 1px solid var(--border-color);";
      const val = opt.is_subpage ? ">" : (opt.value || "");
      content += `<div style="display: flex; justify-content: space-between; padding: 0.5rem 1rem; border-radius: 4px; ${active}">
        <span>${opt.name}</span>
        <span>${val}</span>
      </div>`;
    });
    content += `</div>`;
  } else if (view === "updates") {
    const focused = app.updates_focused || 0;
    const arrowStyle = focused === 0 ? "background: var(--text-color); color: var(--bg-color);" : "border: 1px solid var(--border-color);";
    const btnStyle = focused === 1 ? "background: var(--text-color); color: var(--bg-color);" : "border: 1px solid var(--border-color);";
    const status = app.update_status || "Checking...";
    const local = app.local_version || "?";
    const branch = app.branch || "main";
    let timeStr = "";
    if (app.checked_at) {
      const d = new Date(app.checked_at);
      timeStr = d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
    }
    
    content = `<div style="display: flex; flex-direction: column; width: 100%; gap: 0.5rem;">
      <div style="padding: 0.2rem 0.5rem; width: fit-content; border-radius: 4px; ${arrowStyle}">&lt; Back</div>
      <div style="margin-top: 0.5rem; font-size: 0.9rem;">Status: ${status}</div>`;
      
    if (app.remote_newer) {
      content += `<div style="font-size: 0.9rem;">v${app.remote_version || "?"} available</div>
        <div style="padding: 0.5rem; text-align: center; border-radius: 4px; margin-top: 0.5rem; ${btnStyle}">Update Now</div>`;
    } else {
      content += `<div style="font-size: 0.9rem;">Current: v${local}</div>
        <div style="font-size: 0.9rem;">Branch: ${branch}</div>
        <div style="font-size: 0.9rem;">Checked: ${timeStr}</div>`;
    }
    content += `</div>`;
  } else {
    // Dropdown
    const idx = app.sub_menu_idx;
    const options = app.sub_menu_options || [];
    content = `<div style="display: flex; flex-direction: column; width: 100%; gap: 0.3rem; margin-top: 1rem; align-items: center; max-height: 200px; overflow-y: hidden;">`;
    
    // Calculate sliding window to show ~5 items
    const displayCount = Math.min(options.length, 5);
    const startIdx = Math.max(0, Math.min(idx - 2, options.length - displayCount));
    const endIdx = startIdx + displayCount;
    
    for (let i = startIdx; i < endIdx; i++) {
      const active = i === idx ? "background: var(--text-color); color: var(--bg-color);" : "color: var(--text-color);";
      const scale = i === idx ? "font-size: 1.2rem; padding: 0.5rem 2rem;" : "font-size: 0.9rem; padding: 0.2rem 1rem; opacity: 0.6;";
      content += `<div style="border-radius: 4px; text-align: center; transition: all 0.2s; ${active} ${scale}">${options[i]}</div>`;
    }
    content += `</div>`;
  }
  
  return `
    <section class="app-settings" style="--exit-progress:${exitProgress}; position: relative; width: 100%; height: 100%; display: flex; flex-direction: column; box-sizing: border-box; padding: 0.5rem;">
      ${content}
      <div class="pong-exit"></div>
    </section>
  `;
}

function renderSpotify(app, exitState) {
  const trackName = app.track_name || "Waiting for track...";
  const artistName = app.artist_name || "";
  const isPlaying = app.is_playing ? "Playing \u25B6" : "Paused \u23F8";
  const auth = app.authenticated ? "" : "<p style='color:red; font-size: 0.8rem; margin: 0;'>Connect in web UI</p>";
  
  const progressText = app.progress_text || formatDuration(app.progress_ms);
  const durationText = app.duration_text || formatDuration(app.duration_ms);
  const progress = Number(app.progress_ms || 0);
  const duration = Number(app.duration_ms || 1);
  const pct = Math.max(0, Math.min(100, (progress / duration) * 100));

  const exitProgressRaw = Number(exitState.progress || 0);
  const exitProgress = Math.max(0, Math.min(1, exitProgressRaw));

  const trackHtml = `
    <div style="width: calc(100% - 60px); overflow: hidden;">
      <h2 class="\${trackName.length > 18 ? 'marquee-container' : ''}" style="--marquee-width: calc(100% - 60px); margin: 0; font-size: 1.2rem; white-space: nowrap;">\${trackName}</h2>
    </div>`;

  const artistHtml = `
    <div style="width: 100%; overflow: hidden;">
      <p class="${artistName.length > 25 ? 'marquee-container' : ''}" style="--marquee-width: 100%; margin: 0.2rem 0; font-size: 0.9rem; color: var(--text-muted); white-space: nowrap;">${artistName}</p>
    </div>`;

  const now = new Date();
  const timeString = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  const timeHtml = `<div style="position:absolute; right: 8px; top: 8px; text-align: right; display: flex; flex-direction: column; align-items: flex-end;">
      <span style="font-size:0.7rem;">${timeString}</span>
    </div>`;

  return `
    <section class="app-spotify" style="--exit-progress:${exitProgress}; position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; text-align: left; padding-left: 10px; box-sizing: border-box;">
      ${auth}
      ${timeHtml}
      ${trackHtml}
      ${artistHtml}
      <div style="display:flex; justify-content:space-between; align-items:center; width:100%; margin-top:0.5rem; padding-right:10px; box-sizing:border-box;">
        <p style="margin: 0; font-size: 0.8rem;">${isPlaying}</p>
        <div style="font-size:0.7rem; color: var(--text-muted);">${progressText} / ${durationText}</div>
      </div>
      <div style="position: absolute; left: 0; bottom: 0; width: 100%; height: 6px; background: rgba(255, 255, 255, 0.2);">
        <div style="width: ${pct}%; height: 100%; background: var(--text-color);"></div>
      </div>
      <div class="pong-exit"></div>
    </section>
  `;
}

function formatDuration(valueMs) {
  const total = Math.max(0, Math.floor(Number(valueMs || 0) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function renderPong(app, exitState) {
  const field = app.field || { width: 128, height: 64 };
  const ball = app.ball || { x: 0, y: 0, size: 2 };
  const player = app.player || { x: 0, y: 0, width: 2, height: 12 };
  const cpu = app.cpu || { x: 0, y: 0, width: 2, height: 12 };
  const score = app.score || { player: 0, cpu: 0 };
  const exitProgressRaw = Number(exitState.progress || 0);
  const exitProgress = Math.max(0, Math.min(1, exitProgressRaw));
  const pct = (value, total) => `${(value / total) * 100}%`;

  return `
    <section class="app-pong">
      <div class="pong-score">You ${score.player} : ${score.cpu} CPU</div>
      <div class="pong-field" style="--exit-progress:${exitProgress};">
        <div class="pong-divider"></div>
        <div class="pong-paddle player" style="left:${pct(player.x, field.width)}; top:${pct(player.y, field.height)}; width:${pct(player.width, field.width)}; height:${pct(player.height, field.height)};"></div>
        <div class="pong-paddle cpu" style="left:${pct(cpu.x, field.width)}; top:${pct(cpu.y, field.height)}; width:${pct(cpu.width, field.width)}; height:${pct(cpu.height, field.height)};"></div>
        <div class="pong-ball" style="left:${pct(ball.x, field.width)}; top:${pct(ball.y, field.height)}; width:${pct(ball.size, field.width)}; height:${pct(ball.size, field.height)};"></div>
        <div class="pong-exit"></div>
      </div>
      <p class="pong-hint">Turn the dial to move. Hold the dial for 3 seconds to exit.</p>
    </section>
  `;
}

function renderWidget(widget, motion) {
  if (widget.type === "time") {
    return `
      <section class="widget-time">
        <div class="time-main">${widget.time_main}<span class="seconds">:${widget.seconds}</span></div>
        <div class="time-date"><span class="day">${widget.day}</span><span>${widget.month}</span></div>
      </section>
    `;
  }

  if (widget.type === "click_counter") {
    return `
      <section class="widget-counter">
        <div class="counter-number">${widget.count}</div>
        <p class="counter-help">Dial press increments. Hold resets to 0.</p>
      </section>
    `;
  }

  if (widget.type === "timer") {
    const runningClass = widget.running ? "running" : "stopped";
    const runningText = widget.running ? "Running" : "Stopped";
    const flashClass = widget.flash ? "flash" : "";
    return `
      <section class="widget-timer ${flashClass}">
        <div class="timer-badges">
          <span class="timer-badge ${runningClass}">${runningText}</span>
          <span class="timer-badge">MM:SS</span>
        </div>
        <div class="timer-value">${widget.time_text}</div>
        <p class="timer-help">Timer flashes for 3 seconds when complete.</p>
      </section>
    `;
  }

  if (widget.type === "motion_status") {
    const sensorText = widget.sensor_available ? "Online" : "Not available";
    return `
      <section class="widget-motion">
        <div class="status-grid">
          <div class="status-tile">
            <div class="status-label">Motion</div>
            <div class="status-value">${widget.motion_detected ? "Yes" : "No"}</div>
          </div>
          <div class="status-tile">
            <div class="status-label">Display</div>
            <div class="status-value">${widget.display_state}</div>
          </div>
          <div class="status-tile">
            <div class="status-label">Idle</div>
            <div class="status-value">${widget.idle}</div>
          </div>
          <div class="status-tile">
            <div class="status-label">Sensor</div>
            <div class="status-value">${sensorText}</div>
          </div>
        </div>
      </section>
    `;
  }

  if (widget.type === "weather") {
    const temp = widget.temperature_f == null ? "--" : Math.round(widget.temperature_f);
    const feels = widget.apparent_f == null ? "--" : Math.round(widget.apparent_f);
    const wind = widget.wind_mph == null ? "--" : Math.round(widget.wind_mph);
    const needsLocation = Boolean(widget.needs_location);
    const condition = needsLocation ? "Waiting for location" : (widget.condition || "—");
    const locationLabel = needsLocation ? "Location not set" : (widget.location || widget.location_query || "Weather");
    let updatedText = "";
    if (widget.last_updated && !needsLocation) {
      const parts = String(widget.last_updated).split("T");
      updatedText = parts.length > 1 ? `Updated ${parts[1].slice(0, 5)}` : `Updated ${parts[0]}`;
    }
    const status = weatherLocationStatus || widget.error || "";
    return `
      <section class="widget-weather">
        <div class="weather-main">
          <div class="weather-temp">${temp}°F</div>
          <div class="weather-meta">
            <div class="weather-condition">${condition}</div>
            <div class="weather-feels">Feels like ${feels}°F</div>
            <div class="weather-wind">Wind ${wind} mph</div>
          </div>
        </div>
        <div class="weather-location">
          <span class="weather-location-label">${locationLabel}</span>
          <span class="weather-updated">${updatedText}</span>
        </div>
        ${status ? `<p class="weather-status">${status}</p>` : ""}
      </section>
    `;
  }

  if (widget.type === "version_status") {
    const local = widget.local ?? "unknown";
    const remote = widget.remote ?? "n/a";
    const status = String(widget.status || "unknown").toUpperCase();
    const branch = widget.branch || "";
    const repo = widget.repo || "";
    const checkedAt = widget.checked_at ? new Date(widget.checked_at).toLocaleTimeString() : "never";
    return `
      <section class="widget-motion">
        <div class="status-grid">
          <div class="status-tile">
            <div class="status-label">Local</div>
            <div class="status-value">${local}</div>
          </div>
          <div class="status-tile">
            <div class="status-label">Remote</div>
            <div class="status-value">${remote}</div>
          </div>
          <div class="status-tile">
            <div class="status-label">Status</div>
            <div class="status-value">${status}</div>
          </div>
          <div class="status-tile">
            <div class="status-label">Branch</div>
            <div class="status-value">${branch}</div>
          </div>
          <div class="status-tile">
            <div class="status-label">Checked</div>
            <div class="status-value">${checkedAt}</div>
          </div>
        </div>
        <p class="counter-help">${repo ? `Repo: ${repo}` : ""}</p>
      </section>
    `;
  }

  if (widget.type === "photo") {
    const imageHtml = widget.has_image && widget.image_base64
      ? `<img class="photo-bw" src="data:image/png;base64,${widget.image_base64}" alt="Black & white photo" />`
      : `<p class="counter-help">No photo uploaded yet.</p>`;
    let statusHtml = "";
    if (photoUploadStatus) {
      statusHtml = `<p class="counter-help photo-upload-status">${photoUploadStatus}</p>`;
    }
    return `
      <section class="widget-photo">
        ${imageHtml}
        ${statusHtml}
        <label class="photo-upload-label">
          Upload Photo
          <input type="file" accept="image/*" class="photo-upload-input" />
        </label>
      </section>
    `;
  }

  if (widget.type === "app_launcher") {
    if (widget.preview_type === "spotify" && widget.preview) {
      const preview = widget.preview;
      const trackName = preview.track_name || "Waiting for track...";
      const artistName = preview.artist_name || "";
      const hint = preview.authenticated ? "Press dial to open" : "Connect in web UI";
      
      const trackHtml = `
        <div style="width: calc(100% - 60px); overflow: hidden;">
          <h2 class="${trackName.length > 18 ? 'marquee-container' : ''}" style="--marquee-width: calc(100% - 60px); margin: 0; font-size: 1.2rem; white-space: nowrap;">${trackName}</h2>
        </div>`;
      
      const artistHtml = `
        <div style="width: 100%; overflow: hidden;">
          <p class="${artistName.length > 25 ? 'marquee-container' : ''}" style="--marquee-width: 100%; margin: 0.2rem 0; font-size: 0.9rem; color: var(--text-muted); white-space: nowrap;">${artistName}</p>
        </div>`;

      const now = new Date();
      const timeString = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

      const timeHtml = `<div style="position:absolute; right: 8px; top: 8px; text-align: right; display: flex; flex-direction: column; align-items: flex-end;">
          <span style="font-size:0.7rem;">${timeString}</span>
        </div>`;

      return `
        <section class="app-spotify" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; text-align: left; padding-left: 10px; box-sizing: border-box;">
          ${timeHtml}
          ${trackHtml}
          ${artistHtml}
          <p style="margin-top:0.6rem; font-size:0.75rem;">${hint}</p>
        </section>
      `;
    }
    const appName = widget.app_name || widget.name || "App";
    return `
      <section class="widget-app-launch">
        <div class="app-launch-title">${appName}</div>
        <p class="app-launch-hint">Press the dial to start.</p>
        <p class="app-launch-sub">Hold the dial for 3 seconds to exit.</p>
      </section>
    `;
  }

  return `<p class="counter-help">Unsupported widget type: ${widget.type}</p>`;
}

controlButtons.forEach((button) => {
  if (button === holdButton) {
    return;
  }
  button.addEventListener("click", () => {
    sendAction(button.dataset.action);
  });
});

if (holdButton) {
  const endHold = () => sendAction("dial_hold_end");
  holdButton.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }
    holdButton.setPointerCapture(event.pointerId);
    sendAction("dial_hold_start");
  });
  holdButton.addEventListener("pointerup", (event) => {
    if (holdButton.hasPointerCapture(event.pointerId)) {
      holdButton.releasePointerCapture(event.pointerId);
    }
    endHold();
  });
  holdButton.addEventListener("pointerleave", endHold);
  holdButton.addEventListener("pointercancel", endHold);
}

window.addEventListener("keydown", (event) => {
  if (event.repeat) {
    return;
  }
  const target = event.target;
  if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
    return;
  }

  if (event.key === "ArrowRight") {
    sendAction("next");
    event.preventDefault();
    return;
  }

  if (event.key === "ArrowLeft") {
    sendAction("previous");
    event.preventDefault();
    return;
  }

  if (event.key === " " || event.key === "Spacebar") {
    sendAction("press");
    event.preventDefault();
    return;
  }

  if (event.key.toLowerCase() === "h") {
    if (!holdKeyActive) {
      holdKeyActive = true;
      sendAction("dial_hold_start");
    }
    event.preventDefault();
    return;
  }

  if (event.key === "+" || event.key === "=") {
    sendAction("add_minute");
    event.preventDefault();
    return;
  }

  if (event.key === "-" || event.key === "_") {
    sendAction("subtract_minute");
    event.preventDefault();
  }
});

window.addEventListener("keyup", (event) => {
  if (event.key.toLowerCase() === "h" && holdKeyActive) {
    holdKeyActive = false;
    sendAction("dial_hold_end");
    event.preventDefault();
  }
});

fetchState();
pollHandle = window.setInterval(fetchState, POLL_MS);

// --- Spotify Settings ---
async function checkSpotifyStatus() {
  const statusEl = document.getElementById("spotifyStatus");
  const formEl = document.getElementById("spotifyForm");
  if (!statusEl || !formEl) return;

  try {
    const res = await fetch("/api/spotify/status");
    if (res.ok) {
      const data = await res.json();
      if (data.authenticated) {
        statusEl.textContent = "Connected \u2714";
        statusEl.style.color = "var(--accent-color)";
        formEl.style.display = "none";
      } else {
        statusEl.textContent = "Not connected. Please provide Client ID and Secret.";
        statusEl.style.color = "var(--text-muted)";
        formEl.style.display = "flex";
      }
    }
  } catch (e) {
    console.error("Spotify status error:", e);
  }
}

const spotifyForm = document.getElementById("spotifyForm");
if (spotifyForm) {
  spotifyForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const clientId = document.getElementById("spotifyClientId").value.trim();
    const clientSecret = document.getElementById("spotifyClientSecret").value.trim();
    const redirectUri = document.getElementById("spotifyRedirectUri") ? document.getElementById("spotifyRedirectUri").value.trim() : "";
    const statusEl = document.getElementById("spotifyStatus");
    
    statusEl.textContent = "Connecting...";
    try {
      const payload = { client_id: clientId, client_secret: clientSecret };
      if (redirectUri) payload.redirect_uri = redirectUri;
      
      const res = await fetch("/api/spotify/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const data = await res.json();
        if (data.auth_url) {
          window.location.href = data.auth_url;
        }
      } else {
        const err = await res.json();
        statusEl.textContent = "Error: " + (err.error || "Failed");
      }
    } catch (err) {
      statusEl.textContent = "Error: " + err.message;
    }
  });
}

checkSpotifyStatus();
