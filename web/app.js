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
}

function updateControls(mode) {
  const appMode = mode === "app";
  controlButtons.forEach((button) => {
    const action = button.dataset.action;
    const disable = appMode && action !== "hold" && action !== "simulate_motion";
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
  return `<p class="counter-help">Unsupported app type: ${app.type}</p>`;
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

  if (widget.type === "version_status") {
    const local = widget.local ?? "unknown";
    const remote = widget.remote ?? "n/a";
    const status = String(widget.status || "unknown").toUpperCase();
    const branch = widget.branch || "";
    const repo = widget.repo || "";
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
