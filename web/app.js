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

  displayMode.textContent = `DISPLAY ${String(state.display_mode || "on").toUpperCase()}`;
  motionState.textContent = motion.motion_detected ? "MOTION YES" : "MOTION NO";

  renderTabs(state.widgets || []);

  if (!active) {
    widgetName.textContent = "No widget";
    widgetHint.textContent = "No active widget available.";
    widgetBody.innerHTML = "";
    return;
  }

  widgetName.textContent = active.name || "Widget";
  widgetHint.textContent = hintForWidget(active.type);
  widgetBody.innerHTML = renderWidget(active, motion);
}

widgetBody.addEventListener("change", function (event) {
  if (event.target.classList.contains("photo-upload-input")) {
    handlePhotoUpload(event);
  }
});

function renderTabs(widgets) {
  widgetTabs.innerHTML = "";

  widgets.forEach((widget) => {
    const button = document.createElement("button");
    button.className = `widget-tab${widget.active ? " active" : ""}`;
    button.type = "button";
    button.textContent = widget.name;

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
    default:
      return "Use controls below to interact.";
  }
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
        <p class="counter-help">Encoder press increments. Hold resets to 0.</p>
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

  return `<p class="counter-help">Unsupported widget type: ${widget.type}</p>`;
}

document.querySelectorAll("[data-action]").forEach((button) => {
  button.addEventListener("click", () => {
    sendAction(button.dataset.action);
  });
});

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
    sendAction("hold");
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

fetchState();
pollHandle = window.setInterval(fetchState, POLL_MS);
