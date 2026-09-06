(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const APPS = [
    ['photos', 'Photos', 'fa-regular fa-images'],
    ['spotify', 'Music', 'fa-brands fa-spotify'],
    ['weather', 'Weather', 'fa-solid fa-cloud-sun'],
    ['timer', 'Timer', 'fa-solid fa-stopwatch'],
    ['click_counter', 'Counter', 'fa-solid fa-plus-minus'],
    ['motion_status', 'System status', 'fa-solid fa-sliders']
  ];
  // The ambient surface works without a font or icon CDN. Existing app/settings
  // icons keep their own styling; only these frame controls use local SVGs.
  const ICON_PATHS = {
    'fa-shapes': '<rect x="3" y="3" width="7" height="7" rx="2"/><circle cx="17" cy="6.5" r="3.5"/><path d="m6.5 14 4 7h-8z"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
    'fa-gear': '<path d="m10 3-.7 2.3-2.1 1.2-2.4-.5-2 3.5 1.6 1.8v2.4l-1.6 1.8 2 3.5 2.4-.5 2.1 1.2.7 2.3h4l.7-2.3 2.1-1.2 2.4.5 2-3.5-1.6-1.8v-2.4l1.6-1.8-2-3.5-2.4.5-2.1-1.2L14 3z"/><circle cx="12" cy="12" r="3"/>',
    'fa-cloud-sun': '<path d="M7 9a4 4 0 1 1 7.7-2M7 1v2M1 7h2m.1-3.9 1.4 1.4M14.5 2.5l-1.4 1.4"/><path d="M7 20a4 4 0 0 1-.5-8A5.5 5.5 0 0 1 17 11a4.5 4.5 0 0 1 .5 9z"/>',
    'fa-sun': '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    'fa-cloud-rain': '<path d="M5 15a4 4 0 0 1 .5-8 6 6 0 0 1 11.5-.5A4.5 4.5 0 0 1 19 15M7 17l-1 3m6-3-1 3m6-3-1 3"/>',
    'fa-cloud-bolt': '<path d="M6 16a4 4 0 0 1-.5-8A6 6 0 0 1 17 7a4.5 4.5 0 0 1 1 9M12 12l-3 6h5l-3 5"/>',
    'fa-snowflake': '<path d="M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7M9 4l3 3 3-3M9 20l3-3 3 3M4 10l4-1-1-4m10 14-1-4 4-1M4 14l4 1-1 4M17 5l-1 4 4 1"/>',
    'fa-smog': '<path d="M5 11a3 3 0 0 1 .5-6A5 5 0 0 1 15 5a3 3 0 0 1 3 6M3 15h18M5 19h14"/>',
    'fa-hourglass-half': '<path d="M6 3h12M6 21h12M7 3v4c0 2 2 3 5 5-3 2-5 3-5 5v4M17 3v4c0 2-2 3-5 5 3 2 5 3 5 5v4M8 7h8M8 18h8"/>',
    'fa-pause': '<path d="M8 5v14M16 5v14" stroke-width="3.6"/>',
    'fa-play': '<path d="m8 4 12 8-12 8z" fill="currentColor" stroke="none"/>',
    'fa-xmark': '<path d="m6 6 12 12M6 18 18 6"/>',
    'fa-images': '<rect x="6" y="3" width="15" height="15" rx="3"/><path d="M3 7v11a3 3 0 0 0 3 3h11m-11-8 4-4 4 4 3-3 4 4"/><circle cx="16.5" cy="7.5" r="1"/>',
    'fa-spotify': '<path d="M9 17V5l12-2v12M9 8l12-2"/><ellipse cx="6" cy="17.5" rx="3" ry="2.5"/><ellipse cx="18" cy="15.5" rx="3" ry="2.5"/>',
    'fa-stopwatch': '<circle cx="12" cy="14" r="8"/><path d="M9 2h6m-3 0v4m0 4v5m6-8 2-2"/>',
    'fa-plus-minus': '<path d="M6 3v8M2 7h8m4 11h8M4 21 20 3"/>',
    'fa-sliders': '<path d="M4 3v6m0 4v8M12 3v11m0 4v3M20 3v3m0 4v11M1 9h6m2 9h6m2-12h6"/>',
    'fa-chevron-right': '<path d="m9 5 7 7-7 7"/>',
    'fa-bolt': '<path d="m13 2-9 12h7l-1 8 10-13h-8z"/>',
    'fa-arrow-up-right-from-square': '<path d="M14 3h7v7m0-7L10 14M10 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-5"/>',
    'fa-arrows-rotate': '<path d="M3 10a9 9 0 0 1 15-6l3 3M21 2v5h-5M21 14A9 9 0 0 1 6 20l-3-3m0 5v-5h5"/>'
  };
  function paintIcon(element) {
    const name = [...element.classList].find(value => ICON_PATHS[value]);
    if (!name || element.dataset.frameIcon === name) return;
    element.dataset.frameIcon = name;
    element.setAttribute('aria-hidden', 'true');
    element.innerHTML = `<svg class="frame-local-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true">${ICON_PATHS[name]}</svg>`;
  }
  function hydrateIcons(root) { root.querySelectorAll('i').forEach(paintIcon); }
  const POSITIONS = ['top-left', 'top-center', 'top-right', 'middle-left', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right'];
  const CLOCK_REGIONS = [[.06,.12],[.35,.12],[.65,.12],[.06,.39],[.65,.39],[.06,.69],[.35,.69],[.65,.69]];
  let bridge;
  let collection = { photos: [], photo_preferences: {}, status: {} };
  let frameConfig = {};
  let latestData = {};
  let activePhoto = null;
  let activeKey = '';
  let pendingKey = '';
  let pendingPhotoId = null;
  const ROTATION_STORAGE_KEY = 'dash.frame.rotation.v1';
  let manualRotation = null;
  try { manualRotation = JSON.parse(localStorage.getItem(ROTATION_STORAGE_KEY)); } catch (_) {}
  let loadVersion = 0;
  let activeLayer = 'B';
  let fetching = false;
  let controlsTimer;
  let lastMusicPlaying = 0;
  let completedTimerDismissed = false;
  let timerPhase = 'idle';
  let editorPhotoId = null;
  let editorDirty = false;
  let editorSaving = false;
  let editorDraft = {};
  let photosMount = null;
  let previousFocus = null;
  let photoConnectionError = '';
  const placementCache = new Map();
  const failedPhotos = new Map();
  const focalCropCache = new Map();
  const clockScrimCache = new Map();
  const html = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clamp = (v) => Number.isFinite(Number(v)) ? Math.min(100, Math.max(0, Number(v))) : 50;
  const preferences = (photo) => ({ clock: 'auto', ...(collection.photo_preferences[photo?.id] || {}) });

  function showControls() {
    $('dashboardView').classList.add('controls-visible');
    clearTimeout(controlsTimer);
    controlsTimer = setTimeout(() => {
      if ($('frameChrome').contains(document.activeElement) || $('frameAppsDialog').open) {
        showControls();
      } else {
        $('dashboardView').classList.remove('controls-visible');
      }
    }, 3500);
  }

  function openApps() {
    previousFocus = document.activeElement;
    $('frameAppsDialog').showModal();
    showControls();
  }

  function closeApps() {
    $('frameAppsDialog').close();
    previousFocus?.focus?.({ preventScroll: true });
    showControls();
  }

  function updateClock() {
    const now = new Date();
    $('frameTime').textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\s*[AP]M$/i, '');
    $('frameTime').dateTime = now.toISOString();
    $('frameDate').textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    if ($('framePreviewTime')) $('framePreviewTime').textContent = $('frameTime').textContent;
    if ($('framePreviewDate')) $('framePreviewDate').textContent = $('frameDate').textContent;
    if (latestData.widgets) updateActivities(latestData);
    selectScheduledPhoto();
  }

  function setConnection(connected) {
    $('frameConnectionStatus').textContent = connected ? photoConnectionError : 'Reconnecting · your photos stay here';
  }

  async function fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try { return await fetch(url, { ...options, signal: controller.signal }); }
    finally { clearTimeout(timeout); }
  }

  async function refreshPhotos() {
    if (fetching) return;
    fetching = true;
    try {
      const response = await fetchWithTimeout('/api/frame/photos', { cache: 'no-store' });
      if (!response.ok) throw new Error('Photo sync is unavailable');
      const data = await response.json();
      if (!Array.isArray(data.photos)) throw new Error('Photo collection is unavailable');
      collection = { ...data, photos: data.photos.filter(p => p && typeof p.id === 'string' && typeof p.url === 'string'), photo_preferences: data.photo_preferences || {}, status: data.status || {} };
      photoConnectionError = '';
      updateCollectionCaption();
      selectScheduledPhoto();
      if (photosMount?.isConnected) updatePhotosApp();
    } catch (error) {
      photoConnectionError = 'Photo sync unavailable · keeping current photos';
      if (photosMount?.isConnected) updatePhotosStatus();
    } finally {
      fetching = false;
    }
  }

  function updateCollectionCaption() {
    const count = collection.photos.length;
    const index = collection.photos.findIndex(p => p.id === activePhoto?.id);
    $('framePhotoCount').textContent = count ? `${Math.max(1, index + 1)} / ${count} photos · every 15 min` : 'Your daily frame';
  }

  function imageKey(photo, prefs) {
    return `${photo.id}:${prefs.position_x}:${prefs.position_y}:${prefs.clock}:${window.innerWidth}x${window.innerHeight}`;
  }

  function rotationBatchKey() {
    return `${collection.batch_id || collection.photos.map(photo => photo.id).join(',')}:${collection.activated_at || 0}`;
  }

  function scheduledPhotoIndex() {
    const interval = Math.max(60, Number(collection.rotation_seconds) || 900) * 1000;
    const manual = manualRotation?.batch === rotationBatchKey()
      && Number.isInteger(manualRotation.index) && manualRotation.index >= 0
      && Number.isFinite(manualRotation.startedAt) ? manualRotation : null;
    const start = manual ? manual.startedAt : Number(collection.activated_at) || 0;
    return ((manual?.index || 0) + Math.max(0, Math.floor((Date.now() - start) / interval))) % collection.photos.length;
  }

  function advancePhoto() {
    if (collection.photos.length < 2) return;
    const current = collection.photos.findIndex(photo => photo.id === (pendingPhotoId || activePhoto?.id));
    manualRotation = {
      batch: rotationBatchKey(),
      index: ((current < 0 ? scheduledPhotoIndex() : current) + 1) % collection.photos.length,
      startedAt: Date.now()
    };
    try { localStorage.setItem(ROTATION_STORAGE_KEY, JSON.stringify(manualRotation)); } catch (_) {}
    selectScheduledPhoto();
  }

  function selectScheduledPhoto() {
    if (!collection.photos.length) return;
    const index = scheduledPhotoIndex();
    let photo = null;
    for (let n = 0; n < collection.photos.length; n++) {
      const candidate = collection.photos[(index + n) % collection.photos.length];
      if ((failedPhotos.get(candidate.id) || 0) <= Date.now()) { photo = candidate; break; }
    }
    if (!photo) return;
    const prefs = preferences(photo);
    const key = imageKey(photo, prefs);
    if (key === pendingKey) return;
    if (key === activeKey) {
      // Rapid taps can wrap back to the visible image before another finishes.
      // Cancel that pending selection so its eventual load cannot replace it.
      if (pendingKey) { loadVersion++; pendingKey = ''; pendingPhotoId = null; }
      return;
    }
    pendingKey = key;
    pendingPhotoId = photo.id;
    const version = ++loadVersion;
    const image = new Image();
    image.decoding = 'async';
    const imageTimeout = setTimeout(() => image.onerror?.(), 12000);
    image.onload = () => {
      clearTimeout(imageTimeout);
      if (version !== loadVersion) return;
      const resolved = resolvePhotoPreferences(image, prefs);
      const placement = chooseClockPosition(image, resolved);
      const nextLayer = activeLayer === 'A' ? 'B' : 'A';
      const incoming = $(`framePhoto${nextLayer}`);
      const outgoing = $(`framePhoto${activeLayer}`);
      incoming.style.objectPosition = `${resolved.position_x}% ${resolved.position_y}%`;
      incoming.src = photo.url;
      incoming.classList.add('is-active');
      outgoing.classList.remove('is-active');
      $('frameClock').dataset.position = placement;
      scheduleActivityLayout();
      $('frameClock').style.setProperty('--frame-clock-scrim', clockScrimStrength(image, resolved, placement));
      activeLayer = nextLayer;
      activePhoto = photo;
      activeKey = key;
      pendingKey = '';
      pendingPhotoId = null;
      updateCollectionCaption();
      const next = collection.photos[(collection.photos.findIndex(p => p.id === photo.id) + 1) % collection.photos.length];
      if (next && next.id !== photo.id && !(failedPhotos.get(next.id) > Date.now())) {
        const preload = new Image();
        preload.src = next.url;
      }
    };
    image.onerror = () => {
      clearTimeout(imageTimeout);
      if (version !== loadVersion) return;
      failedPhotos.set(photo.id, Date.now() + 60000);
      pendingKey = '';
      pendingPhotoId = null;
      selectScheduledPhoto();
    };
    image.src = photo.url;
  }

  // Estimate the focal point from detail and color in a small source image. This
  // stays local and inexpensive; manual crop coordinates always take precedence.
  function resolvePhotoPreferences(image, prefs = {}) {
    const key = `${image.src}:${window.innerWidth}x${window.innerHeight}`;
    let automatic = focalCropCache.get(key);
    if (!automatic) {
      automatic = { position_x: 50, position_y: 50 };
      try {
        const canvas = document.createElement('canvas');
        const ratio = 96 / Math.max(image.naturalWidth, image.naturalHeight);
        canvas.width = Math.max(3, Math.round(image.naturalWidth * ratio));
        canvas.height = Math.max(3, Math.round(image.naturalHeight * ratio));
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        const gray = (x, y) => { const i = (y * canvas.width + x) * 4; return (pixels[i] * .2126 + pixels[i + 1] * .7152 + pixels[i + 2] * .0722) / 255; };
        let total = 0, weightedX = 0, weightedY = 0;
        for (let y = 1; y < canvas.height - 1; y++) {
          for (let x = 1; x < canvas.width - 1; x++) {
            const i = (y * canvas.width + x) * 4;
            const r = pixels[i] / 255, g = pixels[i + 1] / 255, b = pixels[i + 2] / 255;
            const light = gray(x, y);
            const detail = Math.abs(gray(x + 1, y) - gray(x - 1, y)) + Math.abs(gray(x, y + 1) - gray(x, y - 1));
            const color = Math.max(r, g, b) - Math.min(r, g, b);
            const skyWeight = b > r * 1.08 && b > g * .97 && light > .42 ? .28 : 1;
            const weight = Math.pow(detail, 1.35) * skyWeight + color * .015 * skyWeight;
            total += weight; weightedX += (x + .5) / canvas.width * weight; weightedY += (y + .5) / canvas.height * weight;
          }
        }
        if (total > .05) {
          const centerX = weightedX / total * image.naturalWidth;
          const centerY = weightedY / total * image.naturalHeight;
          const coverScale = Math.max(window.innerWidth / image.naturalWidth, window.innerHeight / image.naturalHeight);
          const cropWidth = window.innerWidth / coverScale;
          const cropHeight = window.innerHeight / coverScale;
          // CSS object-position is the fraction of the overflow, not of the image.
          const overflowX = image.naturalWidth - cropWidth;
          const overflowY = image.naturalHeight - cropHeight;
          automatic.position_x = overflowX > .01 ? clamp((centerX - cropWidth / 2) / overflowX * 100) : 50;
          automatic.position_y = overflowY > .01 ? clamp((centerY - cropHeight / 2) / overflowY * 100) : 50;
        }
      } catch (_) { /* Blank or unreadable images retain the centered crop. */ }
      if (focalCropCache.size > 100) focalCropCache.clear();
      focalCropCache.set(key, automatic);
    }
    return {
      position_x: typeof prefs.position_x === 'number' && Number.isFinite(prefs.position_x) ? clamp(prefs.position_x) : automatic.position_x,
      position_y: typeof prefs.position_y === 'number' && Number.isFinite(prefs.position_y) ? clamp(prefs.position_y) : automatic.position_y,
      clock: prefs.clock || 'auto'
    };
  }

  function clockScrimStrength(image, prefs, position) {
    const key = `${image.src}:${prefs.position_x}:${prefs.position_y}:${position}:${window.innerWidth}x${window.innerHeight}`;
    if (clockScrimCache.has(key)) return clockScrimCache.get(key);
    let strength = .15;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 96;
      canvas.height = Math.max(36, Math.round(96 * window.innerHeight / window.innerWidth));
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const scale = Math.max(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
      const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
      ctx.drawImage(image, (canvas.width - width) * prefs.position_x / 100, (canvas.height - height) * prefs.position_y / 100, width, height);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const gray = (x,y) => { const i = (y * canvas.width + x) * 4; return (pixels[i] * .2126 + pixels[i + 1] * .7152 + pixels[i + 2] * .0722) / 255; };
      const [left,top] = CLOCK_REGIONS[Math.max(0,POSITIONS.indexOf(position))];
      let total = 0, light = 0, edges = 0;
      for (let y = Math.floor(top * canvas.height); y < Math.min(canvas.height - 1, (top + .25) * canvas.height); y++) {
        for (let x = Math.floor(left * canvas.width); x < Math.min(canvas.width - 1, (left + .29) * canvas.width); x++) {
          const value = gray(x,y);
          light += value;
          edges += Math.abs(value - gray(x + 1,y)) + Math.abs(value - gray(x,y + 1));
          total++;
        }
      }
      if (total) strength = Math.min(.62, .08 + light / total * .37 + edges / total * 1.2);
    } catch (_) { /* A moderate local scrim also covers images that cannot be read. */ }
    if (clockScrimCache.size > 100) clockScrimCache.clear();
    clockScrimCache.set(key, strength.toFixed(3));
    return strength.toFixed(3);
  }

  // Score a tiny, already-cropped canvas. Quiet/darker areas give white clock type room.
  function chooseClockPosition(image, prefs) {
    if (POSITIONS.includes(prefs.clock)) return prefs.clock;
    const cacheKey = `${image.src}:${prefs.position_x}:${prefs.position_y}:${window.innerWidth}x${window.innerHeight}`;
    if (placementCache.has(cacheKey)) return placementCache.get(cacheKey);
    let choice = 'top-left';
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 120;
      canvas.height = Math.max(45, Math.round(120 * window.innerHeight / window.innerWidth));
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const scale = Math.max(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;
      ctx.drawImage(image, (canvas.width - width) * clamp(prefs.position_x) / 100, (canvas.height - height) * clamp(prefs.position_y) / 100, width, height);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const gray = (x, y) => { const i = (y * canvas.width + x) * 4; return (pixels[i] * .2126 + pixels[i + 1] * .7152 + pixels[i + 2] * .0722) / 255; };
      const regions = CLOCK_REGIONS;
      let best = Infinity;
      regions.forEach(([x,y], index) => {
        let sum = 0, squares = 0, edges = 0, count = 0;
        const endX = Math.min(canvas.width - 1, Math.floor((x + .29) * canvas.width));
        const endY = Math.min(canvas.height - 1, Math.floor((y + .25) * canvas.height));
        for (let row = Math.floor(y * canvas.height); row < endY; row++) {
          for (let col = Math.floor(x * canvas.width); col < endX; col++) {
            const light = gray(col,row);
            sum += light; squares += light * light;
            edges += Math.abs(light - gray(col + 1,row)) + Math.abs(light - gray(col,row + 1));
            count++;
          }
        }
        if (!count) return;
        const mean = sum / count;
        const score = edges / count * 2.5 + (squares / count - mean * mean) + mean * .15 + (index > 2 ? .045 : index * .004);
        if (score < best) { best = score; choice = POSITIONS[index]; }
      });
    } catch (_) { /* Image analysis is optional; the scrim keeps the fallback readable. */ }
    if (placementCache.size > 100) placementCache.clear();
    placementCache.set(cacheKey, choice);
    return choice;
  }

  // Keep the clock anchored to the photo; activities use the space around it.
  let activityLayoutPending = false;
  function scheduleActivityLayout() {
    if (activityLayoutPending) return;
    activityLayoutPending = true;
    requestAnimationFrame(() => {
      activityLayoutPending = false;
      const rail = document.querySelector('.frame-bottom');
      const clock = $('frameClock');
      const surface = $('dashboardView').getBoundingClientRect();
      if (!surface.width || !surface.height) return;
      const position = clock.dataset.position || '';
      if (!position.startsWith('bottom-')) {
        rail.removeAttribute('data-layout');
        rail.style.cssText = '';
        return;
      }
      const box = clock.getBoundingClientRect();
      const gap = 24;
      const margin = surface.width * .05;
      const leftSpace = box.left - surface.left - gap - margin;
      const rightSpace = surface.right - box.right - gap - margin;
      let layout = 'above';
      let left = margin, right = margin, bottom = surface.height * .06;
      if (position === 'bottom-left' && rightSpace >= 250) {
        layout = 'right'; left = box.right - surface.left + gap;
      } else if (position === 'bottom-right' && leftSpace >= 250) {
        layout = 'left'; right = surface.right - box.left + gap;
      } else if (position === 'bottom-center' && Math.min(leftSpace, rightSpace) >= 250) {
        layout = 'split';
      } else {
        bottom = surface.bottom - box.top + gap;
      }
      rail.dataset.layout = layout;
      rail.style.cssText = `left:${left}px;right:${right}px;bottom:${bottom}px;--frame-side-left:${leftSpace}px;--frame-side-right:${rightSpace}px`;
    });
  }

  function updateActivities(data) {
    const weather = data.widgets?.weather || {};
    $('frameTemperature').textContent = weather.temperature_f != null ? `${Math.round(weather.temperature_f)}°` : '—°';
    $('frameCondition').textContent = weather.temperature_f != null ? (weather.condition || 'Weather') : 'Weather unavailable';
    const condition = (weather.condition || '').toLowerCase();
    $('frameWeatherIcon').className = `fa-solid ${/snow/.test(condition) ? 'fa-snowflake' : /rain|drizzle/.test(condition) ? 'fa-cloud-rain' : /thunder/.test(condition) ? 'fa-cloud-bolt' : /cloud|overcast/.test(condition) ? 'fa-cloud-sun' : /fog|mist/.test(condition) ? 'fa-smog' : 'fa-sun'}`;
    paintIcon($('frameWeatherIcon'));
    const music = data.apps?.spotify || data.widgets?.spotify || {};
    if (music.is_playing && music.track_name) lastMusicPlaying = Date.now();
    const showMusic = Boolean(music.track_name && (music.is_playing || (lastMusicPlaying && Date.now() - lastMusicPlaying < 30000)));
    $('frameMusic').hidden = !showMusic;
    if (showMusic) {
      $('frameMusicTitle').textContent = music.track_name;
      $('frameMusicArtist').textContent = music.artist_name || '';
      $('frameMusicLabel').textContent = music.is_playing ? 'NOW PLAYING' : 'PAUSED';
      const art = $('frameMusicArt');
      if (music.album_art_url && art.getAttribute('src') !== music.album_art_url) art.src = music.album_art_url;
      else if (!music.album_art_url) art.removeAttribute('src');
      $('frameMusicToggle').setAttribute('aria-label', music.is_playing ? 'Pause music' : 'Play music');
      $('frameMusicToggle').firstElementChild.className = `fa-solid ${music.is_playing ? 'fa-pause' : 'fa-play'}`;
      paintIcon($('frameMusicToggle').firstElementChild);
      $('frameMusicProgress').style.width = `${music.duration_ms ? Math.min(100,Math.max(0,(music.progress_ms || 0) / music.duration_ms * 100)) : 0}%`;
    }
    const timer = data.widgets?.timer || {};
    const hasTimer = Number.isFinite(timer.minutes) && Number.isFinite(timer.seconds);
    const remaining = hasTimer ? timer.minutes * 60 + timer.seconds : null;
    const phase = timer.running ? 'running' : remaining === 0 ? 'completed' : remaining > 0 && remaining < Number(timer.set_minutes) * 60 ? 'paused' : 'idle';
    if (phase !== 'completed') completedTimerDismissed = false;
    timerPhase = phase;
    $('frameTimer').hidden = phase === 'idle' || (phase === 'completed' && completedTimerDismissed);
    $('frameTimer').classList.toggle('is-complete', phase === 'completed');
    $('frameTimerLabel').textContent = phase === 'completed' ? 'TIME’S UP' : phase === 'paused' ? 'PAUSED' : 'TIMER';
    $('frameTimerTime').textContent = timer.time_text || '00:00';
    $('frameTimerAction').setAttribute('aria-label', phase === 'completed' ? 'Dismiss finished timer' : phase === 'running' ? 'Pause timer' : 'Resume timer');
    $('frameTimerAction').firstElementChild.className = `fa-solid ${phase === 'completed' ? 'fa-xmark' : phase === 'running' ? 'fa-pause' : 'fa-play'}`;
    paintIcon($('frameTimerAction').firstElementChild);
    scheduleActivityLayout();
  }

  function renderPhotos(container) {
    if (photosMount === container && $('framePhotosApp')) { updatePhotosApp(); return; }
    photosMount = container;
    editorPhotoId = activePhoto?.id || collection.photos[0]?.id || null;
    editorDirty = false;
    container.innerHTML = `<div class="frame-photos-app" id="framePhotosApp">
      <div class="frame-photos-intro"><div><h2>A new view, every day.</h2><p id="frameCollectionSummary">Your photos change every 15 minutes.</p></div><a class="frame-secondary" href="/frame-setup" target="_blank" rel="noopener"><i class="fa-solid fa-bolt" aria-hidden="true"></i> Set up daily photos <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></a></div>
      <div class="frame-photo-layout"><div><div class="frame-photo-preview"><img id="framePreviewImage" alt="Selected photo crop preview" /><div id="framePreviewClock" class="frame-preview-clock" data-position="top-left"><small id="framePreviewDate"></small><span id="framePreviewTime"></span></div></div><div id="framePhotoThumbs" class="frame-photo-thumbs" aria-label="Choose a photo"></div><p id="framePhotosEmpty" class="frame-empty">Your frame is ready. Connect daily photos below, then send your first collection from Shortcuts.</p></div>
      <div class="frame-editor"><h3>Make room for the moment</h3><label class="frame-field"><span>Clock position</span><select id="frameClockChoice"><option value="auto">Automatic · find a quiet area</option><option value="top-left">Top left</option><option value="top-center">Top center</option><option value="top-right">Top right</option><option value="middle-left">Middle left</option><option value="middle-right">Middle right</option><option value="bottom-left">Bottom left</option><option value="bottom-center">Bottom center</option><option value="bottom-right">Bottom right</option></select></label><label class="frame-field"><span>Horizontal crop <output id="frameCropXValue">50%</output></span><input id="frameCropX" type="range" min="0" max="100" value="50" /></label><label class="frame-field"><span>Vertical crop <output id="frameCropYValue">50%</output></span><input id="frameCropY" type="range" min="0" max="100" value="50" /></label><p class="frame-editor-note">The frame finds a focal crop automatically. Adjust the sliders to choose your own; Reset restores the automatic crop and clock. Bottom clock positions move the widgets to make room.</p><div class="frame-editor-actions"><button id="frameSavePhoto" class="frame-primary">Save photo</button><button id="frameResetPhoto" class="frame-secondary">Reset</button></div><p id="framePhotoSaveStatus" class="frame-save-message" role="status"></p></div></div>
      <section class="frame-cloud"><div class="frame-cloud-heading"><div><h3>Daily photo connection</h3><p id="framePhotoSyncStatus">Checking your connection…</p></div><button id="frameSyncNow" class="frame-secondary"><i class="fa-solid fa-arrows-rotate" aria-hidden="true"></i> Sync now</button></div><form id="frameCloudForm" class="frame-cloud-fields"><label class="frame-field">Photo cloud URL<input id="frameCloudUrl" type="url" placeholder="https://your-deployment.convex.site" autocomplete="off" /></label><label class="frame-field">Photo token<input id="frameCloudToken" type="password" placeholder="Enter photo token" autocomplete="new-password" /></label><button class="frame-primary" type="submit">Save connection</button></form><p id="frameCloudSaveStatus" class="frame-save-message" role="status"></p></section>
    </div>`;
    hydrateIcons(container);
    $('frameClockChoice').addEventListener('change', () => updateEditorDraft(true));
    $('frameCropX').addEventListener('input', () => updateEditorDraft(false));
    $('frameCropY').addEventListener('input', () => updateEditorDraft(false));
    $('frameSavePhoto').addEventListener('click', savePhotoPreferences);
    $('frameResetPhoto').addEventListener('click', () => {
      editorDraft = {};
      editorDirty = true;
      populateEditorControls();
      updatePreview();
      savePhotoPreferences();
    });
    $('frameCloudForm').addEventListener('submit', saveCloudConfig);
    $('frameSyncNow').addEventListener('click', syncNow);
    $('framePreviewImage').addEventListener('load', () => {
      $('framePreviewImage').dataset.loadedUrl = $('framePreviewImage').getAttribute('src');
      updatePreview();
    });
    updatePhotosApp(true);
    fetchConfig();
    refreshPhotos();
  }

  async function fetchConfig() {
    try {
      const response = await fetchWithTimeout('/api/frame/config', { cache: 'no-store' });
      if (!response.ok) throw new Error('Could not load photo settings');
      frameConfig = await response.json();
      if (!$('frameCloudUrl')) return;
      if (document.activeElement !== $('frameCloudUrl')) $('frameCloudUrl').value = frameConfig.cloud_url || '';
      $('frameCloudToken').placeholder = frameConfig.token_configured ? 'Token saved · leave blank to keep' : 'Enter photo token';
    } catch (error) {
      if ($('frameCloudSaveStatus')) setMessage('frameCloudSaveStatus', error.message, true);
    }
  }

  function updatePhotosStatus() {
    if (!$('framePhotoSyncStatus')) return;
    const status = collection.status || {};
    const count = collection.photos.length;
    $('frameCollectionSummary').textContent = count ? `${count} photo${count === 1 ? '' : 's'} in this collection · a fresh view every 15 minutes` : 'Your photos change every 15 minutes.';
    $('framePhotoSyncStatus').textContent = status.syncing ? 'Fetching your latest collection…' : photoConnectionError || status.last_error || (status.configured ? `${count ? `${count} photo${count === 1 ? '' : 's'} ready` : 'Connected · waiting for your first collection'}${status.last_sync ? ' · last synced ' + formatSyncTime(status.last_sync) : ''}` : 'Connect your photo collection to get started.');
    $('framePhotoSyncStatus').classList.toggle('frame-error', Boolean(photoConnectionError || status.last_error));
  }

  function formatSyncTime(value) {
    const date = typeof value === 'number' ? new Date(value < 1e12 ? value * 1000 : value) : new Date(value);
    return Number.isNaN(date.getTime()) ? 'recently' : date.toLocaleTimeString([], { hour:'numeric', minute:'2-digit' });
  }

  function updatePhotosApp(force = false) {
    if (!$('framePhotosApp')) return;
    updatePhotosStatus();
    const signature = collection.photos.map(p => p.id).join(',');
    const thumbs = $('framePhotoThumbs');
    if (thumbs.dataset.signature !== signature) {
      thumbs.dataset.signature = signature;
      thumbs.innerHTML = collection.photos.map((photo, index) => `<button class="frame-photo-thumb" data-photo-id="${html(photo.id)}" aria-label="Edit photo ${index + 1}" aria-pressed="${photo.id === editorPhotoId}"><img src="${html(photo.url)}" alt="" loading="lazy" /></button>`).join('');
      thumbs.querySelectorAll('button').forEach(button => button.addEventListener('click', () => {
        if (editorSaving) return;
        editorPhotoId = button.dataset.photoId;
        editorDirty = false;
        setMessage('framePhotoSaveStatus', '');
        updatePhotosApp(true);
      }));
      if (!collection.photos.some(p => p.id === editorPhotoId)) {
        editorPhotoId = collection.photos[0]?.id || null;
        editorDirty = false;
        force = true;
      }
    }
    $('framePhotosEmpty').hidden = Boolean(collection.photos.length);
    ['frameClockChoice','frameCropX','frameCropY','frameSavePhoto','frameResetPhoto'].forEach(id => { $(id).disabled = !editorPhotoId || editorSaving; });
    if (force || !editorDirty) {
      const photo = collection.photos.find(p => p.id === editorPhotoId);
      editorDraft = preferences(photo);
      populateEditorControls();
      updatePreview();
    }
    thumbs.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.photoId === editorPhotoId)));
  }

  function populateEditorControls(values = editorDraft) {
    $('frameClockChoice').value = values.clock || 'auto';
    $('frameCropX').value = clamp(values.position_x);
    $('frameCropY').value = clamp(values.position_y);
    $('frameCropXValue').textContent = `${Math.round(clamp(values.position_x))}%`;
    $('frameCropYValue').textContent = `${Math.round(clamp(values.position_y))}%`;
  }

  function updateEditorDraft(clockOnly = false) {
    editorDraft = clockOnly ? { ...editorDraft, clock: $('frameClockChoice').value } : { position_x: clamp($('frameCropX').value), position_y: clamp($('frameCropY').value), clock: $('frameClockChoice').value };
    editorDirty = true;
    populateEditorControls();
    updatePreview();
    setMessage('framePhotoSaveStatus', 'Unsaved changes');
  }

  function updatePreview() {
    const photo = collection.photos.find(p => p.id === editorPhotoId);
    const preview = $('framePreviewImage');
    if (photo && preview.getAttribute('src') !== photo.url) preview.src = photo.url;
    if (!photo) preview.removeAttribute('src');
    const resolved = preview.naturalWidth && preview.dataset.loadedUrl === photo?.url ? resolvePhotoPreferences(preview, editorDraft) : { position_x: clamp(editorDraft.position_x), position_y: clamp(editorDraft.position_y), clock: editorDraft.clock || 'auto' };
    preview.style.objectPosition = `${resolved.position_x}% ${resolved.position_y}%`;
    populateEditorControls(resolved);
    updatePreviewClock();
    updateClock();
  }

  function updatePreviewClock() {
    const preview = $('framePreviewImage');
    if (!preview) return;
    const loaded = preview.complete && preview.naturalWidth && preview.dataset.loadedUrl === preview.getAttribute('src');
    const resolved = loaded ? resolvePhotoPreferences(preview, editorDraft) : editorDraft;
    const position = loaded ? chooseClockPosition(preview, resolved) : (POSITIONS.includes(editorDraft.clock) ? editorDraft.clock : 'top-left');
    $('framePreviewClock').dataset.position = position;
    $('framePreviewClock').style.setProperty('--frame-clock-scrim', loaded ? clockScrimStrength(preview, resolved, position) : '.15');
  }

  function setMessage(id, message, error = false) {
    if (!$(id)) return;
    $(id).textContent = message;
    $(id).classList.toggle('frame-error', error);
  }

  async function postConfig(body) {
    const response = await fetchWithTimeout('/api/frame/config', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok || result.ok === false || result.error) throw new Error(result.error || 'Could not save photo settings');
    return result;
  }

  async function savePhotoPreferences() {
    if (!editorPhotoId || editorSaving) return;
    const id = editorPhotoId;
    const draft = { ...editorDraft };
    editorSaving = true;
    updatePhotosApp();
    setMessage('framePhotoSaveStatus','Saving…');
    try {
      await postConfig({ photo_preferences:{ [id]:draft } });
      collection.photo_preferences[id] = draft;
      editorDirty = false;
      activeKey = '';
      selectScheduledPhoto();
      setMessage('framePhotoSaveStatus','Saved for this photo');
    } catch (error) { setMessage('framePhotoSaveStatus',error.message,true); }
    finally { editorSaving = false; updatePhotosApp(); }
  }

  async function saveCloudConfig(event) {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    submit.disabled = true;
    const body = { cloud_url:$('frameCloudUrl').value.trim(), sync_now:true };
    if ($('frameCloudToken').value.trim()) body.token = $('frameCloudToken').value.trim();
    setMessage('frameCloudSaveStatus','Saving connection…');
    try {
      await postConfig(body);
      $('frameCloudToken').value = '';
      setMessage('frameCloudSaveStatus','Connection saved. Your collection will appear after it syncs.');
      await fetchConfig();
      await refreshPhotos();
    } catch (error) { setMessage('frameCloudSaveStatus',error.message,true); }
    finally { if (submit.isConnected) submit.disabled = false; }
  }

  async function syncNow() {
    const button = $('frameSyncNow');
    button.disabled = true;
    setMessage('frameCloudSaveStatus','Checking for new photos…');
    try {
      await postConfig({ sync_now:true });
      await refreshPhotos();
      setMessage('frameCloudSaveStatus','Sync requested. This collection stays visible while new photos load.');
    } catch (error) { setMessage('frameCloudSaveStatus',error.message,true); }
    finally { if (button.isConnected) button.disabled = false; }
  }

  function init(api) {
    bridge = api;
    $('frameAppsGrid').innerHTML = APPS.map(([id,label,icon]) => `<button class="frame-app-tile" data-app="${id}"><i class="${icon}" aria-hidden="true"></i><span>${label}</span></button>`).join('');
    hydrateIcons($('dashboardView'));
    hydrateIcons($('frameAppsDialog'));
    document.querySelectorAll('.frame-settings-entry').forEach(hydrateIcons);
    $('frameAppsGrid').querySelectorAll('button').forEach(button => button.addEventListener('click', () => { closeApps(); bridge.openApp(button.dataset.app); }));
    $('btnOpenApps').addEventListener('click', openApps);
    $('frameCloseApps').addEventListener('click', closeApps);
    $('frameAppsDialog').addEventListener('click', event => {
      const rect = $('frameAppsDialog').getBoundingClientRect();
      if (event.target === $('frameAppsDialog') && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) closeApps();
    });
    $('frameAppsDialog').addEventListener('close', showControls);
    $('dashboardView').addEventListener('click', event => {
      showControls();
      if (event.button !== 0 || event.target.closest('button,a,input,select,textarea,[role="button"],#frameChrome,.frame-glass')) return;
      advancePhoto();
    });
    $('dashboardView').addEventListener('focusin', showControls);
    $('dashboardView').addEventListener('keydown', event => {
      showControls();
      if (event.target === $('dashboardView') && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); $('btnOpenApps').focus(); }
      if (event.target === $('dashboardView') && event.key === 'ArrowRight') { event.preventDefault(); advancePhoto(); }
    });
    $('frameWeather').addEventListener('click', () => bridge.openApp('weather'));
    $('frameMusicOpen').addEventListener('click', () => bridge.openApp('spotify'));
    $('frameMusicToggle').addEventListener('click', () => bridge.sendAction('spotify_toggle'));
    $('frameMusicArt').addEventListener('error', () => $('frameMusicArt').removeAttribute('src'));
    $('frameTimerOpen').addEventListener('click', () => bridge.openApp('timer'));
    $('frameTimerAction').addEventListener('click', () => {
      if (timerPhase === 'completed') { completedTimerDismissed = true; updateActivities(latestData); }
      else bridge.sendAction('timer_toggle');
    });
    const layoutObserver = new ResizeObserver(scheduleActivityLayout);
    ['dashboardView', 'frameClock', 'frameWeather', 'frameMusic', 'frameTimer'].forEach(id => layoutObserver.observe($(id)));
    window.addEventListener('resize', () => { scheduleActivityLayout(); activeKey = ''; selectScheduledPhoto(); updatePreviewClock(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { updateClock(); refreshPhotos(); } });
    updateClock();
    refreshPhotos();
    setInterval(updateClock,1000);
    setInterval(refreshPhotos,30000);
  }

  window.DashFrame = { init, update(data) { latestData = data; updateActivities(data); }, setConnection, renderPhotos, showControls, closeApps };
})();
