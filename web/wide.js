(function () {
  "use strict";

  // Available apps definition using Font Awesome Icon Classes
  const AVAILABLE_APPS = [
    { id: "spotify", name: "Spotify Player", icon: "fa-brands fa-spotify", desc: "Playback & Album Art" },
    { id: "weather", name: "Weather Forecast", icon: "fa-solid fa-cloud-sun", desc: "Local Temp & Forecast" },
    { id: "timer", name: "Countdown Timer", icon: "fa-solid fa-stopwatch", desc: "Timer & Alarm Controls" },
    { id: "click_counter", name: "Tally Counter", icon: "fa-solid fa-calculator", desc: "Touch Click Counter" },
    { id: "photos", name: "Photos", icon: "fa-regular fa-images", desc: "Daily Photo Frame" },
    { id: "photo", name: "OLED Photo", icon: "fa-solid fa-image", desc: "Physical Display Image" },
    { id: "motion_status", name: "System Status", icon: "fa-solid fa-sliders", desc: "Motion & System Diagnostics" }
  ];

  let state = {
    activeOverlayApp: null,
    settingsOpen: false,
    settingsSubpage: "main",
    latestData: null
  };

  let isSpotifyScrubbing = false;

  // State key refs to prevent innerHTML tearing
  let lastOverlayStateKey = "";

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

  // Dynamic Color Extraction for Spotify Album Art (Fetch Blob Same-Origin Canvas)
  let currentAlbumArtUrl = null;
  let currentSpotifyBackgroundUrl = null;
  let activeSpotifyBgLayer = "A";
  let spotifyBgPreloadToken = 0;
  const spotifyFocalCache = new Map();

  function toCssUrl(url) {
    return `url("${String(url).replace(/["\\\n\r]/g, "")}")`;
  }

  /**
   * Detects the optimal vertical focal point (Y percentage: 15% - 75%)
   * using Native FaceDetector (Option 2) with Canvas Skin & Edge Saliency Fallback (Option 1).
   * Safe for non-human images, abstract art, dark/low-contrast photos, and unsupported browsers.
   */
  async function detectArtistFocalPosY(bgImageUrl) {
    if (!bgImageUrl) return 30;
    if (spotifyFocalCache.has(bgImageUrl)) {
      return spotifyFocalCache.get(bgImageUrl);
    }

    let computedY = 30; // Default safe fallback

    try {
      // 1. Fetch blob for clean canvas & detector access without CORS taint
      const response = await fetch(bgImageUrl, { mode: 'cors' });
      if (!response.ok) throw new Error("Image fetch failed");
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);

      const img = new Image();
      img.src = objectUrl;
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });

      const imgH = img.naturalHeight || img.height || 640;
      let detectedRatioY = null;

      // 2. Hardware-Accelerated Native FaceDetector API (Option 2)
      if (typeof window !== 'undefined' && 'FaceDetector' in window) {
        try {
          const detector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 10 });
          const faces = await detector.detect(img);
          if (faces && faces.length > 0) {
            let totalWeight = 0;
            let weightedSumY = 0;
            for (const face of faces) {
              const box = face.boundingBox;
              // Eye-line/upper face is approximately top + 40% height of face box
              const faceY = box.top + box.height * 0.40;
              const weight = Math.max(1, box.width * box.height);
              weightedSumY += faceY * weight;
              totalWeight += weight;
            }
            if (totalWeight > 0 && imgH > 0) {
              detectedRatioY = (weightedSumY / totalWeight) / imgH;
            }
          }
        } catch (faceErr) {
          // Native FaceDetector fallback
        }
      }

      // 3. Fallback: High-Speed Saliency & Skin/Edge Density on Canvas (Option 1)
      if (detectedRatioY === null) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const W = 64, H = 64;
        canvas.width = W;
        canvas.height = H;
        ctx.drawImage(img, 0, 0, W, H);

        const imgData = ctx.getImageData(0, 0, W, H).data;
        const rowEnergies = new Float32Array(H);
        let totalSkinPixels = 0;
        let totalEdgeEnergy = 0;

        for (let y = 0; y < H; y++) {
          let rowEnergy = 0;
          for (let x = 0; x < W; x++) {
            const idx = (y * W + x) * 4;
            const r = imgData[idx];
            const g = imgData[idx + 1];
            const b = imgData[idx + 2];

            const lum = (0.299 * r + 0.587 * g + 0.114 * b);

            // Edge gradient
            let edge = 0;
            if (x > 0) {
              const prevIdx = idx - 4;
              const prevLum = 0.299 * imgData[prevIdx] + 0.587 * imgData[prevIdx + 1] + 0.114 * imgData[prevIdx + 2];
              edge += Math.abs(lum - prevLum);
            }
            if (y > 0) {
              const upIdx = idx - W * 4;
              const upLum = 0.299 * imgData[upIdx] + 0.587 * imgData[upIdx + 1] + 0.114 * imgData[upIdx + 2];
              edge += Math.abs(lum - upLum);
            }

            // YCbCr Skin Tone Filter (Normalized Chromaticity)
            const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
            const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
            const isSkin = (cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173 && lum > 35 && lum < 235);

            let pixelScore = 0;
            if (isSkin) {
              pixelScore += 4.5;
              totalSkinPixels++;
            }
            if (edge > 20) {
              const normEdge = Math.min(3.0, (edge - 20) / 25);
              pixelScore += normEdge;
              totalEdgeEnergy += normEdge;
            }

            rowEnergy += pixelScore;
          }
          rowEnergies[y] = rowEnergy;
        }

        // Calculate weighted vertical center of mass
        let energySum = 0;
        let weightedYSum = 0;
        for (let y = 0; y < H; y++) {
          const e = rowEnergies[y];
          energySum += e;
          weightedYSum += y * e;
        }

        // Only compute if distinct subject or skin pixels detected
        if (energySum > 20 && (totalSkinPixels > 8 || totalEdgeEnergy > 25)) {
          detectedRatioY = (weightedYSum / energySum) / H;
        }
      }

      URL.revokeObjectURL(objectUrl);

      // 4. Map detected focal Y to optimal CSS background-position-y percentage
      if (detectedRatioY !== null && Number.isFinite(detectedRatioY)) {
        // Map detected ratio: higher subject (e.g. 0.25) -> top bias (20%),
        // mid-lower subject (e.g. 0.45-0.55 like Passion) -> center/mid bias (45-55%),
        // clamped comfortably so heads aren't clipped and controls don't cover faces.
        let targetPercent = detectedRatioY * 100;
        targetPercent = Math.max(15, Math.min(75, targetPercent));
        computedY = Math.round(targetPercent);
      } else {
        // Non-human or uniform image default
        computedY = 30;
      }
    } catch (err) {
      computedY = 30;
    }

    spotifyFocalCache.set(bgImageUrl, computedY);
    return computedY;
  }

  function ensureSpotifyBackgroundStage() {
    let stage = document.getElementById("spotifyBgStage");
    if (stage || !elAppOverlayView) return stage;

    stage = document.createElement("div");
    stage.id = "spotifyBgStage";
    stage.className = "spotify-bg-stage";
    stage.setAttribute("aria-hidden", "true");
    stage.innerHTML = `
      <div id="spotifyBgLayerA" class="spotify-bg-layer is-active"></div>
      <div id="spotifyBgLayerB" class="spotify-bg-layer"></div>
    `;
    elAppOverlayView.prepend(stage);
    return stage;
  }

  function updateSpotifyBackgroundImage(bgImageUrl) {
    ensureSpotifyBackgroundStage();
    const layerA = document.getElementById("spotifyBgLayerA");
    const layerB = document.getElementById("spotifyBgLayerB");

    if (!bgImageUrl) {
      currentSpotifyBackgroundUrl = null;
      spotifyBgPreloadToken++;
      if (layerA) { layerA.style.backgroundImage = 'none'; layerA.className = 'spotify-bg-layer'; }
      if (layerB) { layerB.style.backgroundImage = 'none'; layerB.className = 'spotify-bg-layer'; }
      return;
    }

    if (currentSpotifyBackgroundUrl === bgImageUrl) return;

    const cssUrl = toCssUrl(bgImageUrl);

    if (!currentSpotifyBackgroundUrl) {
      currentSpotifyBackgroundUrl = bgImageUrl;
      activeSpotifyBgLayer = "A";
      const cachedY = spotifyFocalCache.get(bgImageUrl) || 30;
      if (layerA) {
        layerA.style.backgroundPosition = `center ${cachedY}%`;
        layerA.style.backgroundImage = cssUrl;
        layerA.className = "spotify-bg-layer is-active";
        layerA.style.transition = "none";
        void layerA.offsetWidth;
        layerA.style.transition = "";
      }
      if (layerB) {
        layerB.style.backgroundImage = "none";
        layerB.className = "spotify-bg-layer";
      }

      if (!spotifyFocalCache.has(bgImageUrl)) {
        detectArtistFocalPosY(bgImageUrl).then(posY => {
          if (currentSpotifyBackgroundUrl === bgImageUrl && layerA) {
            layerA.style.backgroundPosition = `center ${posY}%`;
          }
        });
      }
      return;
    }

    currentSpotifyBackgroundUrl = bgImageUrl;
    const thisToken = ++spotifyBgPreloadToken;

    // Preload image and compute focal position concurrently
    const focalPromise = detectArtistFocalPosY(bgImageUrl);
    const img = new Image();
    let handled = false;

    const startTransition = async () => {
      if (handled || thisToken !== spotifyBgPreloadToken) return;
      handled = true;

      if (!layerA || !layerB) return;

      const posY = await focalPromise.catch(() => 30);
      if (thisToken !== spotifyBgPreloadToken) return;

      const incoming = activeSpotifyBgLayer === "A" ? layerB : layerA;
      const outgoing = activeSpotifyBgLayer === "A" ? layerA : layerB;

      // 1. Prepare incoming layer state with transition temporarily disabled
      incoming.style.transition = "none";
      incoming.style.backgroundPosition = `center ${posY}%`;
      incoming.style.backgroundImage = cssUrl;
      incoming.className = "spotify-bg-layer"; // opacity 0, scale 1.22, blur 28px
      void incoming.offsetWidth; // force reflow

      // 2. Re-enable transition and trigger smooth zoom & blur transition
      incoming.style.transition = "";
      incoming.className = "spotify-bg-layer is-active";
      outgoing.className = "spotify-bg-layer is-outgoing";

      // 3. Swap active layer reference
      activeSpotifyBgLayer = activeSpotifyBgLayer === "A" ? "B" : "A";
    };

    img.onload = startTransition;
    img.onerror = startTransition;
    img.src = bgImageUrl;
    if (img.complete) startTransition();
    setTimeout(startTransition, 500);
  }

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

  async function extractArtMetadataFromUrl(artUrl) {
    if (!artUrl) return { vibrantColor: null, edgeLuminance: 0.5 };
    try {
      const response = await fetch(artUrl, { mode: 'cors' });
      if (!response.ok) return { vibrantColor: null, edgeLuminance: 0.5 };
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
      const W = 40, H = 40;
      canvas.width = W;
      canvas.height = H;
      ctx.drawImage(img, 0, 0, W, H);
      URL.revokeObjectURL(objectUrl);

      const imageData = ctx.getImageData(0, 0, W, H);
      const data = imageData.data;

      // 1. Calculate average luminance specifically from the EDGES (outer 2 perimeter rows & columns)
      let sumLuminance = 0;
      let edgeCount = 0;

      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const isEdge = (x < 2 || x >= W - 2 || y < 2 || y >= H - 2);
          if (!isEdge) continue;

          const idx = (y * W + x) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
          sumLuminance += lum;
          edgeCount++;
        }
      }

      const edgeLuminance = edgeCount > 0 ? (sumLuminance / edgeCount) : 0.5;

      // 2. Extract vibrant accent color
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

      const vibrantColor = bestScore > -1 ? ensureHighContrastColor(bestR, bestG, bestB) : null;

      // 3. Extract shadow tint color specifically from bottom-right corner/edge region
      let brSumR = 0, brSumG = 0, brSumB = 0, brCount = 0;
      let brMaxSat = 0, brBestR = 0, brBestG = 0, brBestB = 0;

      for (let y = Math.floor(H * 0.45); y < H; y++) {
        for (let x = Math.floor(W * 0.45); x < W; x++) {
          const idx = (y * W + x) * 4;
          const r = data[idx], g = data[idx + 1], b = data[idx + 2];
          brSumR += r; brSumG += g; brSumB += b;
          brCount++;

          const max = Math.max(r, g, b), min = Math.min(r, g, b);
          const sat = max > 0 ? (max - min) / max : 0;
          if (sat > brMaxSat) {
            brMaxSat = sat;
            brBestR = r; brBestG = g; brBestB = b;
          }
        }
      }

      let shadowTint = '#000000';
      if (brCount > 0) {
        const avgR = Math.round(brSumR / brCount);
        const avgG = Math.round(brSumG / brCount);
        const avgB = Math.round(brSumB / brCount);
        const max = Math.max(avgR, avgG, avgB), min = Math.min(avgR, avgG, avgB);
        const avgSat = max > 0 ? (max - min) / max : 0;
        const isGrey = (avgSat < 0.10) || (Math.abs(avgR - avgG) < 14 && Math.abs(avgG - avgB) < 14 && Math.abs(avgR - avgB) < 14);
        if (!isGrey) {
          shadowTint = brMaxSat > 0.20 ? `#${((1 << 24) + (brBestR << 16) + (brBestG << 8) + brBestB).toString(16).slice(1)}` : `#${((1 << 24) + (avgR << 16) + (avgG << 8) + avgB).toString(16).slice(1)}`;
        }
      }

      return { vibrantColor, edgeLuminance, shadowTint };
    } catch (err) {
      console.warn("Client color/luminance extraction notice:", err);
      return { vibrantColor: null, edgeLuminance: 0.5, shadowTint: '#000000' };
    }
  }

  function updateSpotifyAccentColor(bgImageUrl, colorExtractUrl) {
    if (!bgImageUrl) {
      document.documentElement.style.setProperty('--spotify-accent', '#ffffff');
      document.documentElement.style.setProperty('--art-shadow-tint', '#000000');
      document.documentElement.style.setProperty('--art-bevel-scale', '1.0');
      updateSpotifyBackgroundImage(null);
      return;
    }
    updateSpotifyBackgroundImage(bgImageUrl);

    const extractUrl = colorExtractUrl || bgImageUrl;
    if (extractUrl === currentAlbumArtUrl) return;
    currentAlbumArtUrl = extractUrl;

    extractArtMetadataFromUrl(extractUrl).then(({ vibrantColor, edgeLuminance, shadowTint }) => {
      if (vibrantColor) {
        document.documentElement.style.setProperty('--spotify-accent', vibrantColor);
      } else {
        document.documentElement.style.setProperty('--spotify-accent', '#ffffff');
      }

      if (shadowTint) {
        document.documentElement.style.setProperty('--art-shadow-tint', shadowTint);
      } else {
        document.documentElement.style.setProperty('--art-shadow-tint', '#000000');
      }

      // Dynamic opacity scale based strictly on edge luminance:
      // Edge luminance 0.0 (pitch black) -> scale = 0.5 (half opacity)
      // Edge luminance 1.0 (bright white) -> scale = 1.0 (full opacity)
      const bevelScale = 0.5 + (0.5 * Math.max(0, Math.min(1, edgeLuminance)));
      document.documentElement.style.setProperty('--art-bevel-scale', bevelScale.toFixed(3));
    }).catch(() => {
      document.documentElement.style.setProperty('--spotify-accent', '#ffffff');
      document.documentElement.style.setProperty('--art-shadow-tint', '#000000');
      document.documentElement.style.setProperty('--art-bevel-scale', '1.0');
    });
  }

  // Connection state management
  let failedFetchCount = 0;
  let isOffline = false;
  let isFetchingState = false;
  let lastSuccessfulFetchTime = Date.now();
  let lastClockChangeTime = Date.now();

  let lastSpotifyFetchTime = 0;
  function showConnectionLostOverlay() {
    isOffline = true;
    window.DashFrame?.setConnection(false);
  }
  function hideConnectionLostOverlay() {
    isOffline = false;
    failedFetchCount = 0;
    window.DashFrame?.setConnection(true);
  }
  function tickRealtimeProgress() {
    if (isSpotifyScrubbing) return;
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
    window.DashFrame?.init({ openApp: openOverlayApp, openSettings: openSettingsOverlay, sendAction });
    setupEventListeners();
    fetchState();
    setInterval(fetchState, 250);
    setInterval(tickRealtimeProgress, 100);
    setInterval(checkConnectionWatchdog, 250);
  }

  // Setup Event Listeners
  function setupEventListeners() {
    window.addEventListener("resize", updateAllWideMarquees);
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(updateAllWideMarquees);
    }

    let spotifyUiTimeout = null;
    const wakeSpotifyUi = () => {
      if (!elAppOverlayView.classList.contains("spotify-active")) return;
      elAppOverlayView.classList.add("ui-visible");
      if (spotifyUiTimeout) clearTimeout(spotifyUiTimeout);
      spotifyUiTimeout = setTimeout(() => {
        if (!isSpotifyScrubbing) {
          elAppOverlayView.classList.remove("ui-visible");
        } else {
          wakeSpotifyUi();
        }
      }, 3500);
    };

    elAppOverlayView.addEventListener("focusin", wakeSpotifyUi);
    elAppOverlayView.addEventListener("keydown", wakeSpotifyUi);
    elAppOverlayView.addEventListener("click", wakeSpotifyUi);
    elAppOverlayView.addEventListener("touchstart", wakeSpotifyUi, { passive: true });
    elAppOverlayView.addEventListener("touchmove", wakeSpotifyUi, { passive: true });
    elAppOverlayView.addEventListener("mousemove", wakeSpotifyUi);

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
      lastSpotifyFetchTime = lastSuccessfulFetchTime;
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
        lastSpotifyFetchTime = Date.now();
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

    // Spotify Dynamic Color Extraction & Background Image
    const spData = data.apps?.spotify || data.widgets?.spotify || {};
    const bgImage = spData.artist_image_url || spData.album_art_url;
    if (bgImage) {
      updateSpotifyAccentColor(bgImage, spData.album_art_url || bgImage);
    } else {
      document.documentElement.style.setProperty('--spotify-accent', '#ffffff');
      updateSpotifyBackgroundImage(null);
    }

    window.DashFrame?.update(data);

    // If Overlay App is open, update its content live!
    if (state.activeOverlayApp) {
      renderOverlayAppContent(state.activeOverlayApp, data);
    }
    if (state.activeOverlayApp !== "spotify" && isSpotifyOverlayVisible()) {
      updateFullScreenSpotifyUI(data);
    }

    // Recalculate conditional marquees after layout/text updates
    updateAllWideMarquees();

    // If Settings overlay is open, update metrics
    if (state.settingsOpen) {
      updateSettingsMetrics(data);
    }

    // Web visibility follows phone presence / Sleep Focus independently of the
    // OLED's motion timer. Browsing photos must never wake physical hardware.
    const elDisplayOff = document.getElementById("displayOffOverlay");
    if (elDisplayOff) {
      const phone = data.phone_state || {};
      const suspended = phone.is_home === false || phone.sleep_focus === true
        || String(phone.focus_mode || "").trim().toLowerCase() === "sleep";
      for (const id of ["appContainer", "appOverlayView", "settingsOverlayView"]) {
        const surface = document.getElementById(id);
        if (surface) surface.inert = suspended || (id === "appContainer" && (Boolean(state.activeOverlayApp) || state.settingsOpen));
      }
      if (suspended && document.getElementById("frameAppsDialog")?.open) document.getElementById("frameAppsDialog").close();
      elDisplayOff.classList.toggle("is-off", suspended);
      elDisplayOff.classList.toggle("hidden", !suspended);
    }
  }

  // Dynamic OLED-matching marquee: only when text exceeds allowed line count
  function updateMarqueeForElement(el, maxLines) {
    if (!el) return;
    const parentBox = el.closest(".marquee-clip-box") || el.parentElement;
    if (!parentBox) return;

    const parentWidth = parentBox.clientWidth;
    if (parentWidth === 0) {
      requestAnimationFrame(() => {
        if (el.closest(".marquee-clip-box")?.clientWidth > 0) {
          updateMarqueeForElement(el, maxLines);
        }
      });
      return;
    }

    const textNode = el.querySelector(".title-text, .artist-text") || el;
    const textContent = textNode.textContent || "";
    if (!textContent.trim()) {
      el.classList.remove("marquee-container");
      el.style.removeProperty("--marquee-width");
      el.style.removeProperty("--marquee-duration");
      parentBox.style.removeProperty("--marquee-duration");
      return;
    }

    const cs = window.getComputedStyle(el);
    const fontSize = cs.fontSize;
    const fontFamily = cs.fontFamily;
    const fontWeight = cs.fontWeight;
    const letterSpacing = cs.letterSpacing;
    const lineHeightRaw = parseFloat(cs.lineHeight);
    const fontSizePx = parseFloat(fontSize);
    const lineHeight = (!isNaN(lineHeightRaw) && lineHeightRaw > 0)
      ? lineHeightRaw
      : fontSizePx * (maxLines === 2 ? 1.25 : 1.2);

    const measureSpan = document.createElement("span");
    measureSpan.style.cssText = [
      "position:absolute",
      "top:-9999px",
      "left:-9999px",
      "visibility:hidden",
      `font-size:${fontSize}`,
      `font-family:${fontFamily}`,
      `font-weight:${fontWeight}`,
      `letter-spacing:${letterSpacing}`,
      `line-height:${cs.lineHeight}`,
      "width:" + parentWidth + "px",
      "max-width:" + parentWidth + "px",
      "margin:0",
      "padding:0",
      "border:none",
      "white-space:normal",
      "word-break:break-word"
    ].join(";");
    measureSpan.textContent = textContent;
    document.body.appendChild(measureSpan);

    let exceedsAllowedLines;
    if (maxLines === 2) {
      // Title: keep full 2-line layout; marquee only if content overflows a 2-line clamp
      measureSpan.style.display = "-webkit-box";
      measureSpan.style.webkitBoxOrient = "vertical";
      measureSpan.style.overflow = "hidden";
      measureSpan.style.webkitLineClamp = "2";
      exceedsAllowedLines = measureSpan.scrollHeight > measureSpan.clientHeight + 1;
    } else {
      // Artist: marquee only if text would wrap to more than one line
      measureSpan.style.display = "block";
      measureSpan.style.overflow = "visible";
      measureSpan.style.webkitLineClamp = "unset";
      const wrappedHeight = measureSpan.getBoundingClientRect().height;
      exceedsAllowedLines = wrappedHeight > lineHeight * 1.15;
    }

    measureSpan.style.whiteSpace = "nowrap";
    measureSpan.style.display = "inline-block";
    measureSpan.style.width = "auto";
    measureSpan.style.maxWidth = "none";
    measureSpan.style.webkitLineClamp = "unset";
    const singleLineWidth = measureSpan.getBoundingClientRect().width;
    document.body.removeChild(measureSpan);

    const needsHorizontalScroll = singleLineWidth > parentWidth + 2;
    const shouldMarquee = exceedsAllowedLines && needsHorizontalScroll;

    if (shouldMarquee) {
      const scrollDistance = Math.max(0, singleLineWidth - parentWidth);
      // Scroll phase is 25% of cycle; ~100px/s during scroll → ~2× slower than fixed 12s on long titles
      const durationSec = Math.min(56, Math.max(12, scrollDistance / 25));
      const durationStr = `${durationSec.toFixed(1)}s`;

      el.classList.add("marquee-container");
      el.style.setProperty("--marquee-width", `${parentWidth}px`);
      if (el.style.getPropertyValue("--marquee-duration") !== durationStr) {
        el.style.setProperty("--marquee-duration", durationStr);
        parentBox.style.setProperty("--marquee-duration", durationStr);
      }
    } else {
      el.classList.remove("marquee-container");
      el.style.removeProperty("--marquee-width");
      el.style.removeProperty("--marquee-duration");
      parentBox.style.removeProperty("--marquee-duration");
    }
  }

  function updateAllWideMarquees() {
    updateMarqueeForElement(document.getElementById("fsSpotTitle"), 2);
    updateMarqueeForElement(document.getElementById("fsSpotArtist"), 1);
    updateMarqueeForElement(document.getElementById("widgetSpotTitle"), 2);
    updateMarqueeForElement(document.getElementById("widgetSpotArtist"), 1);
  }

  function updateSpotifyText(elId, textSelector, value, maxLines) {
    const el = document.getElementById(elId);
    if (!el) return;
    const textEl = el.querySelector(textSelector) || el;
    if (textEl.textContent !== value) {
      textEl.textContent = value;
    }
    updateMarqueeForElement(el, maxLines);
  }

  function updateSpotifyArtImage(img, albumArt, sweepId) {
    if (!img) return;
    const nextAlbumArt = albumArt || "";
    const currentAlbumArt = img.dataset.albumArtUrl || img.getAttribute("src") || "";

    if (!nextAlbumArt) {
      img.dataset.albumArtUrl = "";
      img.removeAttribute("src");
      img.style.display = "none";
      return;
    }

    if (currentAlbumArt === nextAlbumArt) {
      img.style.display = "block";
      return;
    }

    img.dataset.albumArtUrl = nextAlbumArt;
    img.setAttribute("src", nextAlbumArt);
    img.style.display = "block";

    const sweep = sweepId ? document.getElementById(sweepId) : img.parentElement?.querySelector(".art-sweep-flash");
    if (sweep) {
      sweep.classList.remove("flash-active");
      void sweep.offsetWidth;
      sweep.classList.add("flash-active");
    }
  }

  function isSpotifyOverlayVisible() {
    return Boolean(
      elAppOverlayView &&
      elAppOverlayView.classList.contains("spotify-active") &&
      !elAppOverlayView.classList.contains("hidden")
    );
  }

  // Create Card HTML for Dashboard Grid
  // Full Screen Overlay Management
  let overlayReturnFocus = null;
  function openOverlayApp(appId) {
    if (!AVAILABLE_APPS.some(app => app.id === appId)) return;
    overlayReturnFocus = document.activeElement;
    document.getElementById("appContainer").inert = true;
    elAppOverlayView.classList.toggle("photos-active", appId === "photos");
    state.activeOverlayApp = appId;
    lastOverlayStateKey = "";
    try {
      sessionStorage.setItem("dash_saved_screen", JSON.stringify({ type: "app", id: appId }));
    } catch (e) { }

    const appDef = AVAILABLE_APPS.find(a => a.id === appId) || { name: appId, icon: "fa-solid fa-square-app" };

    if (appId === "spotify") {
      elAppOverlayView.classList.add("spotify-active");
      elAppOverlayView.classList.remove("ui-visible");
      if (elOverlayAppTitle) elOverlayAppTitle.innerHTML = "";
      if (elOverlayAppSubtitle) elOverlayAppSubtitle.textContent = "";
    } else {
      elAppOverlayView.classList.remove("spotify-active");
      if (elOverlayAppTitle) elOverlayAppTitle.innerHTML = `<i class="${appDef.icon}"></i> ${appDef.name}`;
      if (elOverlayAppSubtitle) elOverlayAppSubtitle.textContent = `Full Screen View`;
    }

    revealSurface(elAppOverlayView);
    requestAnimationFrame(() => elBtnBackToDash?.focus({ preventScroll: true }));
    const dataToRender = state.latestData || MOCK_DEMO_DATA;
    renderOverlayAppContent(appId, dataToRender);

    if (appId === "spotify") {
      requestAnimationFrame(() => {
        updateMarqueeForElement(document.getElementById("fsSpotTitle"), 2);
        updateMarqueeForElement(document.getElementById("fsSpotArtist"), 1);
      });
      setTimeout(updateAllWideMarquees, 350);
    }
  }

  function closeOverlayApp(isUserAction = true) {
    state.activeOverlayApp = null;
    document.getElementById("appContainer").inert = state.settingsOpen;
    window.DashFrame?.showControls();
    if (overlayReturnFocus?.isConnected && overlayReturnFocus.getClientRects().length && !overlayReturnFocus.closest("dialog:not([open]), .hidden")) overlayReturnFocus.focus?.({ preventScroll: true });
    else document.getElementById("dashboardView").focus({ preventScroll: true });
    lastOverlayStateKey = "";
    try {
      sessionStorage.setItem("dash_saved_screen", JSON.stringify({ type: "dashboard" }));
    } catch (e) { }
    concealSurface(elAppOverlayView, () => {
      elAppOverlayView.classList.remove("spotify-active", "photos-active");
      elOverlayContent.innerHTML = "";
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
    document.getElementById("appContainer").inert = Boolean(state.activeOverlayApp);
    window.DashFrame?.showControls();
    elBtnOpenSettings?.focus({ preventScroll: true });
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
      if (!document.getElementById("fsSpotifyNotConnected")) {
        elOverlayContent.innerHTML = `
          <div id="fsSpotifyNotConnected" style="display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; height:100%; gap:1.5rem;">
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
      }
      return;
    }

    if (!sp.track_name || connState === "idle") {
      document.documentElement.style.setProperty('--spotify-bg-image', 'none');
      document.documentElement.style.setProperty('--spotify-accent', '#1db954');
      if (!document.getElementById("fsSpotifyNothingPlaying")) {
        elOverlayContent.innerHTML = `
          <div id="fsSpotifyNothingPlaying" style="display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; height:100%; gap:1.5rem;">
            <div style="width:100px; height:100px; border-radius:50%; background:rgba(29,185,84,0.1); border:2px solid rgba(29,185,84,0.3); display:flex; align-items:center; justify-content:center;">
              <i class="fa-brands fa-spotify" style="font-size:3.5rem; color:#1db954;"></i>
            </div>
            <div>
              <h1 style="font-size:2.2rem; font-weight:700; color:#ffffff; margin-bottom:0.5rem;">Nothing Playing</h1>
              <p style="color:var(--text-muted); font-size:1.15rem; max-width:520px; line-height:1.5;">Play music on any phone, desktop app, or smart speaker</p>
            </div>
          </div>
        `;
      }
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
    if (!container || !document.querySelector("#fsSpotArtist")?.querySelector(".artist-text")) {
      elOverlayContent.innerHTML = `
        <div class="fs-spotify-container" id="fsSpotifyContainer">
          <div class="fs-spotify-art-wrapper" id="fsSpotArtWrap">
            <img src="${escapeHTML(albumArt)}" class="fs-spotify-art-large" id="fsSpotArtImg" data-album-art-url="${escapeHTML(albumArt)}" alt="Album Art" />
            <div class="art-sweep-flash flash-active" id="fsSpotSweep"></div>
          </div>
          <div class="fs-spotify-details">
            <div style="width: 100%; min-width: 0; max-width: 100%;">
              <div class="marquee-clip-box">
                <h1 class="fs-spotify-title" id="fsSpotTitle"><span class="title-text">${escapeHTML(track)}</span></h1>
              </div>
              <div class="marquee-clip-box" style="margin-top: 0.3rem;">
                <h2 class="fs-spotify-artist" id="fsSpotArtist"><span class="artist-text">${escapeHTML(artist)}</span></h2>
              </div>
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
      updateMarqueeForElement(document.getElementById("fsSpotTitle"), 2);
      updateMarqueeForElement(document.getElementById("fsSpotArtist"), 1);
    }

    // Direct DOM updates on every 250ms poll
    updateSpotifyText("fsSpotTitle", ".title-text", track, 2);
    updateSpotifyText("fsSpotArtist", ".artist-text", artist, 1);
    updateSpotifyArtImage(document.getElementById("fsSpotArtImg"), albumArt, "fsSpotSweep");

    const elProg = document.getElementById("fs-spotify-progress");
    if (elProg) elProg.style.width = `${pct}%`;

    const elCurTime = document.getElementById("fs-spotify-time-current");
    if (elCurTime) {
      const curText = formatMsToMinSec(progressMs);
      if (elCurTime.innerText !== curText) elCurTime.innerText = curText;
    }

    const elDurTime = document.getElementById("fs-spotify-time-duration");
    if (elDurTime) {
      const durText = formatMsToMinSec(durationMs);
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
    if (appId === "photos") { window.DashFrame?.renderPhotos(elOverlayContent); return; }
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
              <h3 class="fs-motion-value" style="font-size:1.8rem; margin-top:0.5rem; color:var(--accent-cyan);">${(data.display_mode || 'ON').toUpperCase()}</h3>
            </div>
            <div style="background:#0e121c; border:1px solid var(--border-card); padding:1.5rem; border-radius:16px; text-align:center;">
              <span style="color:var(--text-muted); font-size:0.9rem;">Motion Sensor</span>
              <h3 class="fs-motion-value" style="font-size:1.8rem; margin-top:0.5rem; color:var(--accent-green);">${m.motion_detected ? 'ACTIVE' : 'IDLE'}</h3>
            </div>
            <div style="background:#0e121c; border:1px solid var(--border-card); padding:1.5rem; border-radius:16px; text-align:center;">
              <span style="color:var(--text-muted); font-size:0.9rem;">Idle Time</span>
              <h3 class="fs-motion-value" style="font-size:1.8rem; margin-top:0.5rem;">${m.idle || '00:00'}</h3>
            </div>
          </div>
          <button class="touch-btn btn-primary" id="fsSimulateMotion" style="font-size:1.2rem; padding:1rem 2.5rem;"><i class="fa-solid fa-person-walking"></i> Simulate Motion Activity</button>
        </div>
      `;
    }

    // Mount interactive controls once; update changing values independently of Spotify.
    const payload = appId === "weather" ? data.widgets.weather : appId === "photo" ? data.widgets.photo : null;
    const overlayStateKey = appId + (payload ? JSON.stringify(payload) : "");

    if (lastOverlayStateKey !== overlayStateKey) {
      lastOverlayStateKey = overlayStateKey;
      elOverlayContent.innerHTML = html;
      attachOverlayEventListeners(appId, data);
    }
    updateOverlayValues(appId, data);
  }

  function updateOverlayValues(appId, data) {
    if (appId === "timer") {
      const timer = data.widgets.timer || {};
      const digits = document.getElementById("fs-timer-text");
      if (digits) digits.textContent = timer.time_text || "05:00";
      const toggle = document.getElementById("fsTimerToggle");
      const label = timer.running ? "Pause" : "Start";
      if (toggle && toggle.dataset.label !== label) {
        toggle.dataset.label = label;
        toggle.innerHTML = `<i class="fa-solid ${timer.running ? 'fa-pause' : 'fa-play'}"></i> ${label}`;
      }
    } else if (appId === "click_counter") {
      const digits = elOverlayContent.querySelector(".fs-counter-digits");
      if (digits) digits.textContent = data.widgets.click_counter?.count ?? 0;
    } else if (appId === "motion_status") {
      const motion = data.motion || {};
      const values = elOverlayContent.querySelectorAll(".fs-motion-value");
      [data.display_mode || "ON", motion.motion_detected ? "ACTIVE" : "IDLE", motion.idle || "00:00"].forEach((value, index) => {
        if (values[index]) values[index].textContent = value;
      });
    }
  }

  function attachSeekHandler(barId, fillId) {
    const bar = document.getElementById(barId);
    if (!bar) return;

    if (bar.dataset.seekAttached === "true") return;
    bar.dataset.seekAttached = "true";

    const getTargetMsAndRatio = (e) => {
      const currentBar = document.getElementById(barId) || bar;
      const rect = currentBar.getBoundingClientRect();
      let clientX = e.clientX;
      if (e.touches && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
      } else if (e.changedTouches && e.changedTouches.length > 0) {
        clientX = e.changedTouches[0].clientX;
      }

      if (clientX === undefined || clientX === null || isNaN(clientX)) return null;

      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const sp = state.latestData?.apps?.spotify || state.latestData?.widgets?.spotify || {};
      const duration = sp.duration_ms || 1;
      const targetMs = Math.round(ratio * duration);
      
      return { ratio, targetMs };
    };

    const updateUI = (ratio, targetMs) => {
      const fill = document.getElementById(fillId);
      if (fill) fill.style.width = `${ratio * 100}%`;
      
      if (barId === "fsScrubBar") {
        const elCurTime = document.getElementById("fs-spotify-time-current");
        if (elCurTime) {
          elCurTime.innerText = formatMsToMinSec(targetMs);
        }
      }
    };

    let isDragging = false;

    const handleMove = (e) => {
      if (!isDragging) return;
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
      const res = getTargetMsAndRatio(e);
      if (res) updateUI(res.ratio, res.targetMs);
    };

    const handleEnd = (e) => {
      if (!isDragging) return;
      isDragging = false;
      isSpotifyScrubbing = false;
      e.stopPropagation();

      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleEnd);
      window.removeEventListener("touchmove", handleMove);
      window.removeEventListener("touchend", handleEnd);
      window.removeEventListener("touchcancel", handleEnd);
      
      const res = getTargetMsAndRatio(e);
      if (res) {
        updateUI(res.ratio, res.targetMs);
        sendAction("spotify_seek", { position_ms: res.targetMs });
        if (state.latestData) {
           const sp = state.latestData.apps?.spotify || state.latestData.widgets?.spotify;
           if (sp) {
             sp.progress_ms = res.targetMs;
             lastSpotifyFetchTime = Date.now();
           }
        }
      }
    };

    const handleStart = (e) => {
      e.stopPropagation();
      isDragging = true;
      isSpotifyScrubbing = true;

      const res = getTargetMsAndRatio(e);
      if (res) updateUI(res.ratio, res.targetMs);

      window.addEventListener("mousemove", handleMove, { passive: false });
      window.addEventListener("mouseup", handleEnd);
      window.addEventListener("touchmove", handleMove, { passive: false });
      window.addEventListener("touchend", handleEnd);
      window.addEventListener("touchcancel", handleEnd);
    };

    bar.addEventListener("mousedown", handleStart);
    bar.addEventListener("touchstart", handleStart, { passive: true });
  }

  // Attach Full Screen Overlay Action Handlers
  function attachOverlayEventListeners(appId, data) {
    if (appId === "spotify") {
      const btnPlay = document.getElementById("fsSpotPlay");
      const btnPrev = document.getElementById("fsSpotPrev");
      const btnNext = document.getElementById("fsSpotNext");

      const blurSelf = (e) => { if (e && e.currentTarget) e.currentTarget.blur(); };

      if (btnPlay) btnPlay.addEventListener("click", (e) => { blurSelf(e); sendAction("spotify_toggle"); });
      if (btnPrev) btnPrev.addEventListener("click", (e) => { blurSelf(e); sendAction("spotify_prev"); });
      if (btnNext) btnNext.addEventListener("click", (e) => { blurSelf(e); sendAction("spotify_next"); });

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
      if (elCur) elCur.innerText = formatMsToMinSec(sp.progress_ms || 0);
      const elDur = document.getElementById("fs-spotify-time-duration");
      if (elDur) elDur.innerText = formatMsToMinSec(sp.duration_ms || 0);
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

      sessionStorage.removeItem("dash_saved_modal");
    } catch (e) {
      console.warn("Could not restore saved screen state:", e);
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
    return formatMsToMinSec(ms);
  }

  // Start app on DOM ready
  document.addEventListener("DOMContentLoaded", init);
})();
