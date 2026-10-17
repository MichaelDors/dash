(function () {
  'use strict';
  // Preserve the existing Spotify presentation; each mount owns its DOM and effects.
  function create(host, context) {
    const root = document.createElement('section');
    root.className = 'workspace-app ws-spotify app-overlay-view spotify-active is-visible';
    root.setAttribute('aria-label', 'Music');
    root.innerHTML = '<button type="button" class="ws-reveal" aria-label="Show music controls"></button><header class="overlay-header workspace-layout-header" aria-hidden="true" inert></header><div class="workspace-music-content overlay-content"></div>';
    const content = root.querySelector('.workspace-music-content');
    const get = id => root.querySelector(`[id="${id}"]`);
    const abort = new AbortController();
    const on = (node, type, listener) => node.addEventListener(type, listener, { signal: abort.signal });
    const text = (node, value) => window.DashValueMotion.setText(node, value);
    const formatMsToMinSec = ms => { const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
    let latest = {}, updatedAt = 0, scrubbing = false, visible = false, mode, sizeKey;
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
      const response = await fetch(bgImageUrl, { mode: 'cors', signal: abort.signal });
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
    let stage = get("spotifyBgStage");
    if (stage || !root) return stage;

    stage = document.createElement("div");
    stage.id = "spotifyBgStage";
    stage.className = "spotify-bg-stage";
    stage.setAttribute("aria-hidden", "true");
    stage.innerHTML = `
      <div id="spotifyBgLayerA" class="spotify-bg-layer is-active"></div>
      <div id="spotifyBgLayerB" class="spotify-bg-layer"></div>
    `;
    root.prepend(stage);
    return stage;
  }

  function updateSpotifyBackgroundImage(bgImageUrl) {
    ensureSpotifyBackgroundStage();
    const layerA = get("spotifyBgLayerA");
    const layerB = get("spotifyBgLayerB");

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
          if (!abort.signal.aborted && currentSpotifyBackgroundUrl === bgImageUrl && layerA) {
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
      if (abort.signal.aborted || handled || thisToken !== spotifyBgPreloadToken) return;
      handled = true;

      if (!layerA || !layerB) return;

      const posY = await focalPromise.catch(() => 30);
      if (abort.signal.aborted || thisToken !== spotifyBgPreloadToken) return;

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
      const response = await fetch(artUrl, { mode: 'cors', signal: abort.signal });
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
      currentAlbumArtUrl = null;
      root.style.setProperty('--spotify-accent', '#ffffff');
      root.style.setProperty('--art-shadow-tint', '#000000');
      root.style.setProperty('--art-bevel-scale', '1.0');
      updateSpotifyBackgroundImage(null);
      return;
    }
    updateSpotifyBackgroundImage(bgImageUrl);

    const extractUrl = colorExtractUrl || bgImageUrl;
    if (extractUrl === currentAlbumArtUrl) return;
    currentAlbumArtUrl = extractUrl;

    extractArtMetadataFromUrl(extractUrl).then(({ vibrantColor, edgeLuminance, shadowTint }) => {
      if (abort.signal.aborted || currentAlbumArtUrl !== extractUrl) return;
      if (vibrantColor) {
        root.style.setProperty('--spotify-accent', vibrantColor);
      } else {
        root.style.setProperty('--spotify-accent', '#ffffff');
      }

      if (shadowTint) {
        root.style.setProperty('--art-shadow-tint', shadowTint);
      } else {
        root.style.setProperty('--art-shadow-tint', '#000000');
      }

      // Dynamic opacity scale based strictly on edge luminance:
      // Edge luminance 0.0 (pitch black) -> scale = 0.5 (half opacity)
      // Edge luminance 1.0 (bright white) -> scale = 1.0 (full opacity)
      const bevelScale = 0.5 + (0.5 * Math.max(0, Math.min(1, edgeLuminance)));
      root.style.setProperty('--art-bevel-scale', bevelScale.toFixed(3));
    }).catch(() => {
      root.style.setProperty('--spotify-accent', '#ffffff');
      root.style.setProperty('--art-shadow-tint', '#000000');
      root.style.setProperty('--art-bevel-scale', '1.0');
    });
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
    root.appendChild(measureSpan);

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
    root.removeChild(measureSpan);

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

    const sweep = sweepId ? get(sweepId) : img.parentElement?.querySelector(".art-sweep-flash");
    if (sweep) {
      sweep.classList.remove("flash-active");
      void sweep.offsetWidth;
      sweep.classList.add("flash-active");
    }
  }


    function refreshMarquees() { updateMarqueeForElement(get('fsSpotTitle'), 2); updateMarqueeForElement(get('fsSpotArtist'), 1); }
    function showTrack() {
      content.innerHTML = `<div class="fs-spotify-container" id="fsSpotifyContainer">
          <div class="fs-spotify-art-wrapper" id="fsSpotArtWrap">
            <img src="" class="fs-spotify-art-large" id="fsSpotArtImg" data-album-art-url="" alt="Album Art" />
            <div class="art-sweep-flash flash-active" id="fsSpotSweep"></div>
          </div>
          <div class="fs-spotify-details">
            <div style="width: 100%; min-width: 0; max-width: 100%;">
              <div class="marquee-clip-box">
                <h1 class="fs-spotify-title" id="fsSpotTitle"><span class="title-text"></span></h1>
              </div>
              <div class="marquee-clip-box" style="margin-top: 0.3rem;">
                <h2 class="fs-spotify-artist" id="fsSpotArtist"><span class="artist-text"></span></h2>
              </div>
            </div>
            <div class="fs-spotify-scrub-wrap">
              <div class="fs-spotify-progress" id="fsScrubBar" style="cursor: pointer;">
                <input class="ws-seek" type="range" min="0" max="1000" value="0" aria-label="Playback position"/><div class="fs-spotify-progress-fill" id="fs-spotify-progress" style="width:0%;"></div>
              </div>
              <div class="fs-spotify-time-row">
                <span id="fs-spotify-time-current">0:00</span>
                <span id="fs-spotify-time-duration">0:00</span>
              </div>
            </div>
            <div class="fs-spotify-controls">
              <button class="fs-ctrl-btn" id="fsSpotPrev"><i class="fa-solid fa-backward-step"></i></button>
              <button class="fs-ctrl-btn fs-play-btn" id="fsSpotPlay">
                <i class="fa-solid fa-play" id="fsSpotPlayIcon"></i>
              </button>
              <button class="fs-ctrl-btn" id="fsSpotNext"><i class="fa-solid fa-forward-step"></i></button>
            </div>
          </div>
        </div>`;
      get('fsSpotPrev').setAttribute('aria-label', 'Previous track'); get('fsSpotNext').setAttribute('aria-label', 'Next track');
      on(get('fsSpotPrev'), 'click', () => context.sendAction('spotify_prev'));
      on(get('fsSpotNext'), 'click', () => context.sendAction('spotify_next'));
      on(get('fsSpotPlay'), 'click', () => context.sendAction('spotify_toggle'));
      const seek = root.querySelector('.ws-seek');
      on(seek, 'pointerdown', () => { scrubbing = true; context.showControls(); });
      on(seek, 'input', () => { scrubbing = true; progress((latest.duration_ms || 0) * seek.value / 1000); });
      on(seek, 'change', () => { scrubbing = false; context.sendAction('spotify_seek', { position_ms: Math.round((latest.duration_ms || 0) * seek.value / 1000) }); });
      on(seek, 'pointercancel', () => { scrubbing = false; });
      on(get('fsSpotArtImg'), 'error', () => { get('fsSpotArtImg').style.display = 'none'; });
      setControls(visible);
    }
    function setControls(next) {
      visible = next; root.classList.toggle('ui-visible', next);
      root.querySelectorAll('.fs-spotify-controls').forEach(node => { node.inert = !next; });
    }
    function progress(ms) {
      const fill = get('fs-spotify-progress');
      if (fill) fill.style.width = `${latest.duration_ms ? Math.max(0, Math.min(100, ms / latest.duration_ms * 100)) : 0}%`;
      text(get('fs-spotify-time-current'), formatMsToMinSec(ms));
    }
    function update(data, now) {
      latest = data.apps?.spotify || data.widgets?.spotify || {}; updatedAt = now;
      const connection = latest.connection_state;
      const nextMode = !latest.authenticated || ['not_authenticated','not_configured'].includes(connection) ? 'connect' : !latest.track_name || connection === 'idle' ? 'idle' : 'track';
      if (mode !== nextMode) {
        mode = nextMode;
        if (mode === 'track') showTrack();
        else {
          content.innerHTML = mode === 'connect' ? `<div id="fsSpotifyNotConnected" style="display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; height:100%; gap:1.5rem;">
            <i class="fa-brands fa-spotify" style="font-size:5rem; color:#1db954;"></i>
            <div>
              <h1 style="font-size:2rem; font-weight:700; margin-bottom:0.5rem;">Spotify Not Connected</h1>
              <p style="color:var(--text-muted); font-size:1.1rem; max-width:500px;">Connect your Spotify account in Settings to view full-screen playback, artwork, and controls.</p>
            </div>
            <button class="touch-btn btn-primary" id="fsOpenSettingsBtn" style="font-size:1.2rem; padding:0.8rem 2.2rem; margin-top:0.5rem;">
              <i class="fa-solid fa-gear"></i> Open System Settings
            </button>
          </div>` : `<div id="fsSpotifyNothingPlaying" style="display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; height:100%; gap:1.5rem;">
            <div style="width:100px; height:100px; border-radius:50%; background:rgba(29,185,84,0.1); border:2px solid rgba(29,185,84,0.3); display:flex; align-items:center; justify-content:center;">
              <i class="fa-brands fa-spotify" style="font-size:3.5rem; color:#1db954;"></i>
            </div>
            <div>
              <h1 style="font-size:2.2rem; font-weight:700; color:#ffffff; margin-bottom:0.5rem;">Nothing Playing</h1>
              <p style="color:var(--text-muted); font-size:1.15rem; max-width:520px; line-height:1.5;">Play music on any phone, desktop app, or smart speaker</p>
            </div>
          </div>`;
          const button = content.querySelector('button'); if (button) on(button, 'click', context.openSettings);
        }
      }
      updateSpotifyAccentColor(latest.artist_image_url || latest.album_art_url, latest.album_art_url);
      if (mode !== 'track') { root.style.setProperty('--spotify-accent', mode === 'idle' ? '#1db954' : '#00f2fe'); return; }
      const trackText = get('fsSpotTitle').querySelector('.title-text');
      const artistText = get('fsSpotArtist').querySelector('.artist-text');
      const changed = trackText.textContent !== latest.track_name || artistText.textContent !== latest.artist_name;
      text(trackText, latest.track_name); text(artistText, latest.artist_name || 'Unknown Artist');
      updateSpotifyArtImage(get('fsSpotArtImg'), latest.album_art_url, 'fsSpotSweep');
      const playIcon = get('fsSpotPlay').querySelector('i');
      playIcon.className = `fa-solid ${latest.is_playing ? 'fa-pause' : 'fa-play'}`;
      get('fsSpotPlay').setAttribute('aria-label', latest.is_playing ? 'Pause music' : 'Play music');
      text(get('fs-spotify-time-duration'), formatMsToMinSec(latest.duration_ms));
      updateSpotifyAccentColor(latest.artist_image_url || latest.album_art_url, latest.album_art_url);
      if (changed) refreshMarquees();
    }
    on(root.querySelector('.ws-reveal'), 'click', context.showControls);
    return { root, mount() { host.appendChild(root); }, update, resize() {
      const nextSize = `${root.clientWidth}x${root.clientHeight}`;
      if (sizeKey !== nextSize) { sizeKey = nextSize; refreshMarquees(); }
    }, setControls,
      tick(now) {
        if (mode !== 'track' || scrubbing) return;
        const ms = Math.min(latest.duration_ms || 0, (latest.progress_ms || 0) + (latest.is_playing && !context.isOffline() ? Math.max(0, now - updatedAt) : 0));
        root.querySelector('.ws-seek').value = latest.duration_ms ? Math.round(ms / latest.duration_ms * 1000) : 0;
        progress(ms);
      },
      isInteracting() { return scrubbing; },
      destroy() { abort.abort(); spotifyBgPreloadToken++; root.remove(); }
    };
  }
  window.DashWorkspaceMusic = { create };
})();
