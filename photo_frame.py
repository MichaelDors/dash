"""Private, cached color photos for the web frame, independent of OLED state.

Cloud checksums identify the original JPEGs and optional transparent PNGs.
Cached images are oriented, resized, and stripped of metadata; their separate
checksums detect local corruption. Foregrounds share the photo's full canvas.
"""

from __future__ import annotations

import hashlib
import io
import json
import math
import os
import re
import shutil
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Dict, Optional
from urllib.error import HTTPError
from urllib.parse import quote, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

try:
    from PIL import Image, ImageOps
except ImportError:
    Image = None  # type: ignore[assignment]
    ImageOps = None  # type: ignore[assignment]


MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_FOREGROUND_BYTES = 20 * 1024 * 1024
MAX_PHOTOS = 24
MAX_MANIFEST_BYTES = 128 * 1024
ROTATION_SECONDS = 900
SYNC_INTERVAL_SECONDS = 60
REQUEST_TIMEOUT_SECONDS = 12
PHOTO_ID_RE = re.compile(r"^[a-f0-9]{64}$")
CACHE_DIR_RE = re.compile(r"^(?:batch|stage)-[a-f0-9]{32}$")
CLOCK_POSITIONS = frozenset({
    "auto", "top-left", "top-center", "top-right", "middle-left", "middle-right",
    "bottom-left", "bottom-center", "bottom-right",
})


class _FrameError(Exception):
    """An intentionally safe error message suitable for the settings screen."""


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # A frame token must never be forwarded to another host.
        return None


class PhotoFrameManager:
    """Owns base_dir/photo_frame/{config.json,state.json,cache/}."""

    def __init__(self, base_dir: Path):
        self.root = Path(base_dir) / "photo_frame"
        self.cache_root = self.root / "cache"
        self.config_path = self.root / "config.json"
        self.state_path = self.root / "state.json"
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.cache_root.mkdir(exist_ok=True, mode=0o700)
        os.chmod(self.root, 0o700)
        os.chmod(self.cache_root, 0o700)
        self._lock = threading.RLock()
        self._sync_lock = threading.Lock()
        self._stop = threading.Event()
        self._wake = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._opener = build_opener(_NoRedirect())
        self._config = {"cloud_url": "", "token": "", "photo_preferences": {}}
        self._config_revision = 0
        self._active: Optional[Dict[str, Any]] = None
        self._previous: Optional[Dict[str, Any]] = None
        self._syncing = False
        self._last_error: Optional[str] = None
        self._last_sync: Optional[int] = None
        self._load_config()
        self._load_state()
        self._prune_cache()

    @staticmethod
    def _write_json(path: Path, data: Dict[str, Any]) -> None:
        temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
        try:
            with temporary.open("x", encoding="utf-8") as handle:
                os.chmod(temporary, 0o600)
                json.dump(data, handle, separators=(",", ":"), allow_nan=False)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)

    @staticmethod
    def _read_json(path: Path, limit: int) -> Dict[str, Any]:
        with path.open("rb") as handle:
            raw = handle.read(limit + 1)
        if len(raw) > limit:
            raise ValueError("Saved frame data is too large")
        value = json.loads(raw)
        if not isinstance(value, dict):
            raise ValueError("Invalid saved frame data")
        return value

    @staticmethod
    def _validate_cloud_url(value: Any) -> str:
        if not isinstance(value, str):
            raise ValueError("Cloud URL must be text")
        value = value.strip().rstrip("/")
        if not value:
            return ""
        parsed = urlparse(value)
        hostname = parsed.hostname or ""
        if (parsed.scheme != "https" or not re.fullmatch(r"[a-z0-9-]+\.convex\.site", hostname)
                or parsed.netloc != hostname or parsed.path or parsed.query or parsed.fragment):
            raise ValueError("Use your HTTPS Convex site URL ending in .convex.site")
        return "https://" + hostname

    @staticmethod
    def _validate_preferences(value: Any) -> Dict[str, Any]:
        if not isinstance(value, dict) or len(value) > 5000:
            raise ValueError("Photo preferences must be an object with at most 5000 photos")
        result = {}
        for photo_id, settings in value.items():
            if not isinstance(photo_id, str) or not PHOTO_ID_RE.fullmatch(photo_id):
                raise ValueError("Invalid photo ID in preferences")
            if not isinstance(settings, dict):
                raise ValueError("Each photo preference must be an object")
            if any(key not in {"position_x", "position_y", "clock", "depth"} for key in settings):
                raise ValueError("Unknown photo preference")
            preference = {}
            for key in ("position_x", "position_y"):
                if key in settings:
                    number = settings[key]
                    if isinstance(number, bool) or not isinstance(number, (int, float)) or not math.isfinite(number) or not 0 <= number <= 100:
                        raise ValueError("Photo position must be between 0 and 100")
                    preference[key] = number
            if "clock" in settings:
                if not isinstance(settings["clock"], str) or settings["clock"] not in CLOCK_POSITIONS:
                    raise ValueError("Invalid clock position")
                preference["clock"] = settings["clock"]
            if "depth" in settings:
                if not isinstance(settings["depth"], bool):
                    raise ValueError("Depth effect must be true or false")
                preference["depth"] = settings["depth"]
            result[photo_id] = preference
        return result

    def _load_config(self) -> None:
        if not self.config_path.exists():
            return
        try:
            raw = self._read_json(self.config_path, 1024 * 1024)
            token = raw.get("token", "")
            if not isinstance(token, str) or len(token) > 4096 or any(ord(c) < 32 or ord(c) > 126 for c in token):
                raise ValueError("Invalid saved token")
            self._config = {
                "cloud_url": self._validate_cloud_url(raw.get("cloud_url", "")),
                "token": token.strip(),
                "photo_preferences": self._validate_preferences(raw.get("photo_preferences", {})),
            }
            os.chmod(self.config_path, 0o600)
        except (OSError, ValueError, TypeError):
            self._last_error = "Saved photo settings could not be loaded. Re-enter the connection settings."

    def _load_state(self) -> None:
        if not self.state_path.exists():
            return
        try:
            state = self._read_json(self.state_path, MAX_MANIFEST_BYTES)
            active = self._validated_cached_batch(state.get("active"))
            previous = self._validated_cached_batch(state.get("previous"))
            self._active = active or previous
            self._previous = previous if active else None
            last_sync = state.get("last_sync")
            if isinstance(last_sync, (int, float)) and not isinstance(last_sync, bool) and math.isfinite(last_sync):
                self._last_sync = int(last_sync)
        except (OSError, ValueError, TypeError):
            self._last_error = "Saved photos could not be loaded. They will be downloaded again."

    def _validated_cached_batch(self, batch: Any) -> Optional[Dict[str, Any]]:
        if not isinstance(batch, dict) or not isinstance(batch.get("batch_id"), str):
            return None
        directory = batch.get("cache_dir")
        if not isinstance(directory, str) or not CACHE_DIR_RE.fullmatch(directory) or not directory.startswith("batch-"):
            return None
        activated_at = batch.get("activated_at")
        if isinstance(activated_at, bool) or not isinstance(activated_at, (int, float)) or not math.isfinite(activated_at) or activated_at < 0:
            return None
        photos = batch.get("photos")
        if not isinstance(photos, list) or not 1 <= len(photos) <= MAX_PHOTOS:
            return None
        for photo in photos:
            if not isinstance(photo, dict) or not self._cached_photo_valid(batch, photo):
                return None
            for key in ("width", "height"):
                if isinstance(photo.get(key), bool) or not isinstance(photo.get(key), int) or not 1 <= photo[key] <= 2048:
                    return None
            if "foreground" in photo:
                foreground = photo["foreground"]
                if (not isinstance(foreground, dict) or not self._cached_photo_valid(batch, foreground, foreground=True)
                        or any(isinstance(foreground.get(key), bool) or not isinstance(foreground.get(key), int)
                               or foreground.get(key) != photo[key]
                               for key in ("width", "height"))):
                    return None
        return batch

    def _cached_photo_path(self, batch: Dict[str, Any], photo_id: str, *, foreground: bool = False) -> Optional[Path]:
        directory = batch.get("cache_dir", "")
        if not isinstance(directory, str) or not CACHE_DIR_RE.fullmatch(directory) or not PHOTO_ID_RE.fullmatch(photo_id):
            return None
        candidate = self.cache_root / directory / (photo_id + (".png" if foreground else ".jpg"))
        if candidate.is_symlink() or candidate.parent.is_symlink():
            return None
        if candidate.resolve().parent.parent != self.cache_root.resolve():
            return None
        return candidate

    def _cached_photo_valid(self, batch: Dict[str, Any], photo: Dict[str, Any], *, foreground: bool = False) -> bool:
        photo_id, checksum = photo.get("id"), photo.get("cache_sha256")
        if not isinstance(photo_id, str) or not PHOTO_ID_RE.fullmatch(photo_id) or not isinstance(checksum, str) or not PHOTO_ID_RE.fullmatch(checksum):
            return False
        path = self._cached_photo_path(batch, photo_id, foreground=foreground)
        if path is None:
            return False
        try:
            limit = MAX_FOREGROUND_BYTES if foreground else MAX_IMAGE_BYTES
            with path.open("rb") as handle:
                raw = handle.read(limit + 1)
            return 0 < len(raw) <= limit and hashlib.sha256(raw).hexdigest() == checksum
        except OSError:
            return False

    def get_config(self) -> Dict[str, Any]:
        with self._lock:
            return {
                "cloud_url": self._config["cloud_url"],
                "token_configured": bool(self._config["token"]),
                "rotation_seconds": ROTATION_SECONDS,
                "photo_preferences": json.loads(json.dumps(self._config["photo_preferences"])),
            }

    def update_config(self, updates: Dict[str, Any]) -> Dict[str, Any]:
        """Partial update; supplied photo IDs replace only their own preferences.

        Omit token to retain it. An explicit empty token disconnects cloud sync.
        A photo's empty preference object restores its automatic defaults.
        This does not delete the last downloaded photographs.
        """
        if not isinstance(updates, dict):
            raise ValueError("Photo settings must be an object")
        if any(key not in {"cloud_url", "token", "photo_preferences", "sync_now"} for key in updates):
            raise ValueError("Unknown photo setting")
        if "sync_now" in updates and not isinstance(updates["sync_now"], bool):
            raise ValueError("Sync now must be true or false")
        with self._lock:
            updated = dict(self._config)
            if "cloud_url" in updates:
                updated["cloud_url"] = self._validate_cloud_url(updates["cloud_url"])
            if "token" in updates:
                token = updates["token"]
                if not isinstance(token, str) or len(token) > 4096 or any(ord(c) < 32 or ord(c) > 126 for c in token):
                    raise ValueError("Token must be plain text without line breaks")
                updated["token"] = token.strip()
            if "photo_preferences" in updates:
                supplied = self._validate_preferences(updates["photo_preferences"])
                updated["photo_preferences"] = self._validate_preferences({
                    **self._config["photo_preferences"], **supplied,
                })
            connection_changed = any(updated[key] != self._config[key] for key in ("cloud_url", "token"))
            try:
                self._write_json(self.config_path, updated)
            except OSError:
                raise ValueError("Photo settings could not be saved. Check the server's storage.") from None
            self._config = updated
            if connection_changed:
                self._config_revision += 1
                self._last_error = None
                self._wake.set()
        if updates.get("sync_now"):
            self.request_sync()
        return self.get_config()

    def get_manifest(self) -> Dict[str, Any]:
        with self._lock:
            active = self._active or {}
            photos = [{
                "id": photo["id"], "url": "/api/frame/photos/" + photo["id"],
                "width": photo["width"], "height": photo["height"],
                **({"foreground": {
                    "id": photo["foreground"]["id"], "url": "/api/frame/foregrounds/" + photo["foreground"]["id"],
                    "width": photo["foreground"]["width"], "height": photo["foreground"]["height"],
                }} if "foreground" in photo else {}),
            } for photo in active.get("photos", [])]
            return {
                "batch_id": active.get("batch_id"),
                "activated_at": active.get("activated_at"),
                "rotation_seconds": ROTATION_SECONDS,
                "photos": photos,
                "photo_preferences": json.loads(json.dumps(self._config["photo_preferences"])),
                "status": {
                    "configured": bool(self._config["cloud_url"] and self._config["token"]),
                    "syncing": self._syncing,
                    "last_error": self._last_error,
                    "last_sync": self._last_sync,
                },
            }

    def get_photo(self, photo_id: str) -> Optional[Path]:
        return self._get_cached_image(photo_id)

    def get_foreground(self, photo_id: str) -> Optional[Path]:
        return self._get_cached_image(photo_id, foreground=True)

    def _get_cached_image(self, photo_id: str, *, foreground: bool = False) -> Optional[Path]:
        if not isinstance(photo_id, str) or not PHOTO_ID_RE.fullmatch(photo_id):
            return None
        with self._lock:
            for batch in (self._active, self._previous):
                if batch and any((photo.get("foreground", {}) if foreground else photo).get("id") == photo_id
                                 for photo in batch["photos"]):
                    path = self._cached_photo_path(batch, photo_id, foreground=foreground)
                    if path is not None and path.is_file():
                        return path
        return None

    def start(self) -> None:
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                return
            self._stop.clear()
            self._thread = threading.Thread(target=self._run, name="web-photo-frame", daemon=True)
            self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._wake.set()
        thread = self._thread
        if thread is not None and thread is not threading.current_thread():
            thread.join(timeout=1)

    def request_sync(self) -> bool:
        with self._lock:
            if not self._config["cloud_url"] or not self._config["token"]:
                return False
        self._wake.set()
        self.start()
        return True

    def _run(self) -> None:
        while not self._stop.is_set():
            self._wake.clear()
            self.sync_now()
            self._wake.wait(SYNC_INTERVAL_SECONDS)

    def _request(self, config: Dict[str, Any], path: str, limit: int) -> bytes:
        request = Request(config["cloud_url"] + path, headers={
            "Authorization": "Bearer " + config["token"],
            "Accept": ("application/json" if path == "/frame/manifest" else
                       "image/png" if path.startswith("/frame/foregrounds/") else "image/jpeg"),
            "User-Agent": "Dash-Photo-Frame/1.0",
        })
        with self._opener.open(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            if response.status != 200:
                raise _FrameError("The photo service returned an unexpected response.")
            content_length = response.headers.get("Content-Length")
            if content_length is not None:
                try:
                    length = int(content_length)
                except (TypeError, ValueError):
                    raise _FrameError("The photo service returned an invalid response.") from None
                if length < 0 or length > limit:
                    raise _FrameError("A photo service response exceeded the size limit.")
            raw = response.read(limit + 1)
        if len(raw) > limit:
            raise _FrameError("A photo service response exceeded the size limit.")
        return raw

    @staticmethod
    def _parse_manifest(raw: bytes) -> Optional[Dict[str, Any]]:
        try:
            manifest = json.loads(raw)
        except (ValueError, UnicodeDecodeError):
            raise _FrameError("The photo service returned an invalid manifest.") from None
        if not isinstance(manifest, dict):
            raise _FrameError("The photo service returned an invalid manifest.")
        if manifest.get("batch_id") is None and manifest.get("photos") == []:
            return None
        batch_id, activated_at, photos = manifest.get("batch_id"), manifest.get("activated_at"), manifest.get("photos")
        if (not isinstance(batch_id, str) or not 1 <= len(batch_id) <= 256
                or isinstance(activated_at, bool) or not isinstance(activated_at, (int, float))
                or not math.isfinite(activated_at) or activated_at < 0
                or not isinstance(photos, list) or not 1 <= len(photos) <= MAX_PHOTOS):
            raise _FrameError("The photo service returned an invalid manifest.")
        parsed = []
        indices = set()
        for photo in photos:
            if not isinstance(photo, dict):
                raise _FrameError("The photo service returned invalid photo metadata.")
            storage_id, checksum, index, size = photo.get("id"), photo.get("sha256"), photo.get("index"), photo.get("size")
            if (not isinstance(storage_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,256}", storage_id)
                    or not isinstance(checksum, str) or not PHOTO_ID_RE.fullmatch(checksum)
                    or isinstance(index, bool) or not isinstance(index, int) or not 0 <= index < MAX_PHOTOS or index in indices
                    or isinstance(size, bool) or not isinstance(size, int) or not 1 <= size <= MAX_IMAGE_BYTES
                    or photo.get("mime_type") != "image/jpeg"):
                raise _FrameError("The photo service returned invalid photo metadata.")
            indices.add(index)
            record = {"storage_id": storage_id, "id": checksum, "index": index, "size": size}
            if "foreground" in photo:
                foreground = photo["foreground"]
                if not isinstance(foreground, dict):
                    raise _FrameError("The photo service returned invalid foreground metadata.")
                fg_storage_id, fg_checksum, fg_size = foreground.get("id"), foreground.get("sha256"), foreground.get("size")
                if (not isinstance(fg_storage_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,256}", fg_storage_id)
                        or not isinstance(fg_checksum, str) or not PHOTO_ID_RE.fullmatch(fg_checksum)
                        or isinstance(fg_size, bool) or not isinstance(fg_size, int) or not 1 <= fg_size <= MAX_FOREGROUND_BYTES
                        or foreground.get("mime_type") != "image/png"
                        or any(isinstance(foreground.get(key), bool) or not isinstance(foreground.get(key), int)
                               or not 1 <= foreground[key] <= 8192 for key in ("width", "height"))
                        or foreground["width"] * foreground["height"] > 32_000_000):
                    raise _FrameError("The photo service returned invalid foreground metadata.")
                record["foreground"] = {"storage_id": fg_storage_id, "id": fg_checksum, "size": fg_size,
                                        "width": foreground["width"], "height": foreground["height"]}
            parsed.append(record)
        if indices != set(range(len(photos))):
            raise _FrameError("The photo batch is incomplete.")
        return {"batch_id": batch_id, "activated_at": int(activated_at), "photos": sorted(parsed, key=lambda photo: photo["index"])}

    @staticmethod
    def _normalize_photo(raw: bytes, source: Dict[str, Any]) -> tuple[bytes, int, int, tuple[int, int]]:
        if len(raw) != source["size"] or hashlib.sha256(raw).hexdigest() != source["id"]:
            raise _FrameError("A photo failed its integrity check. The previous photos are still available.")
        if Image is None or ImageOps is None:
            raise _FrameError("Pillow is required to prepare frame photos.")
        try:
            with Image.open(io.BytesIO(raw)) as image:
                if image.format != "JPEG" or image.width > 8192 or image.height > 8192 or image.width * image.height > 40_000_000:
                    raise _FrameError("A photo has an unsupported format or dimensions.")
                image.verify()
            with Image.open(io.BytesIO(raw)) as image:
                image.load()
                oriented = ImageOps.exif_transpose(image)
                source_size = oriented.size
                rgb = oriented.convert("RGB")
                rgb.thumbnail((2048, 2048), Image.Resampling.LANCZOS)
                width, height = rgb.size
                # A fresh image avoids copying EXIF/GPS, comments, and profiles.
                clean = Image.new("RGB", rgb.size)
                clean.paste(rgb)
                output = io.BytesIO()
                clean.save(output, format="JPEG", quality=90, optimize=True)
                normalized = output.getvalue()
                if len(normalized) > MAX_IMAGE_BYTES:
                    raise _FrameError("A prepared photo exceeded the size limit.")
                return normalized, width, height, source_size
        except _FrameError:
            raise
        except Exception:
            raise _FrameError("A photo could not be decoded. The previous photos are still available.") from None

    @staticmethod
    def _normalize_foreground(raw: bytes, source: Dict[str, Any]) -> tuple[bytes, Dict[str, Any]]:
        if len(raw) != source["size"] or hashlib.sha256(raw).hexdigest() != source["id"]:
            raise _FrameError("A foreground failed its integrity check. The previous photos are still available.")
        if Image is None or ImageOps is None:
            raise _FrameError("Pillow is required to prepare frame photos.")
        try:
            with Image.open(io.BytesIO(raw)) as image:
                if (image.format != "PNG" or getattr(image, "n_frames", 1) != 1
                        or image.size != (source["width"], source["height"])
                        or image.width > 8192 or image.height > 8192 or image.width * image.height > 32_000_000):
                    raise _FrameError("A foreground has an unsupported format or dimensions.")
                image.verify()
            with Image.open(io.BytesIO(raw)) as image:
                image.load()
                oriented = ImageOps.exif_transpose(image)
                rgba = oriented.convert("RGBA")
                minimum, maximum = rgba.getchannel("A").getextrema()
                if minimum == 255 or maximum == 0:
                    raise _FrameError("A foreground must contain both visible content and transparency.")
                source_width, source_height = rgba.size
                rgba.thumbnail((2048, 2048), Image.Resampling.LANCZOS)
                minimum, maximum = rgba.getchannel("A").getextrema()
                if minimum == 255 or maximum == 0:
                    raise _FrameError("A foreground lost its visible content or transparency when resized.")
                # A fresh RGBA canvas preserves alpha but discards EXIF/GPS and other metadata.
                clean = Image.new("RGBA", rgba.size)
                clean.paste(rgba)
                output = io.BytesIO()
                clean.save(output, format="PNG", optimize=True)
                normalized = output.getvalue()
                if len(normalized) > MAX_FOREGROUND_BYTES:
                    raise _FrameError("A prepared foreground exceeded the size limit.")
                return normalized, {"id": source["id"], "width": clean.width, "height": clean.height,
                                    "source_width": source_width, "source_height": source_height,
                                    "encoded_width": image.width, "encoded_height": image.height,
                                    "cache_sha256": hashlib.sha256(normalized).hexdigest()}
        except _FrameError:
            raise
        except Exception:
            raise _FrameError("A foreground could not be decoded. The previous photos are still available.") from None

    @staticmethod
    def _has_source_canvas(photo: Dict[str, Any]) -> bool:
        return all(isinstance(photo.get(key), int) and not isinstance(photo[key], bool)
                   and 1 <= photo[key] <= 8192 for key in ("source_width", "source_height"))

    def _prepare_foreground(self, config: Dict[str, Any], source: Dict[str, Any], background: Dict[str, Any],
                            stage: Path, cached: list[Dict[str, Any]], prepared: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
        record = prepared.get(source["id"])
        destination = stage / (source["id"] + ".png")
        if record is None:
            for batch in cached:
                candidate = next((photo["foreground"] for photo in batch["photos"]
                                  if photo.get("foreground", {}).get("id") == source["id"]), None)
                if candidate and self._has_source_canvas(candidate) and self._cached_photo_valid(batch, candidate, foreground=True):
                    cached_path = self._cached_photo_path(batch, source["id"], foreground=True)
                    if cached_path is not None:
                        shutil.copyfile(cached_path, destination)
                        record = dict(candidate)
                        break
            if record is None:
                raw = self._request(config, "/frame/foregrounds/" + quote(source["storage_id"], safe=""), MAX_FOREGROUND_BYTES)
                normalized, record = self._normalize_foreground(raw, source)
                destination.write_bytes(normalized)
            os.chmod(destination, 0o600)
            prepared[source["id"]] = record
        if any(record.get("encoded_" + key) != source[key] for key in ("width", "height")):
            raise _FrameError("A foreground has inconsistent canvas metadata.")
        if any(record[key] != background[key] for key in ("source_width", "source_height", "width", "height")):
            raise _FrameError("A foreground does not align with its photo. Keep the full photo canvas when removing the background.")
        return dict(record)

    def _build_batch(self, config: Dict[str, Any], manifest: Dict[str, Any], stage: Path) -> Dict[str, Any]:
        photos = []
        prepared: Dict[str, Dict[str, Any]] = {}
        prepared_foregrounds: Dict[str, Dict[str, Any]] = {}
        with self._lock:
            cached = [batch for batch in (self._active, self._previous) if batch]
        for source in manifest["photos"]:
            if self._stop.is_set():
                raise _FrameError("Photo sync was stopped.")
            record = prepared.get(source["id"])
            if record is not None and "foreground" in source and not self._has_source_canvas(record):
                record = None
            destination = stage / (source["id"] + ".jpg")
            if record is None:
                for batch in cached:
                    candidate = next((photo for photo in batch["photos"] if photo["id"] == source["id"]), None)
                    if (candidate and self._cached_photo_valid(batch, candidate)
                            and ("foreground" not in source or self._has_source_canvas(candidate))):
                        cached_path = self._cached_photo_path(batch, source["id"])
                        if cached_path is not None:
                            shutil.copyfile(cached_path, destination)
                            record = {key: value for key, value in candidate.items() if key != "foreground"}
                            break
            if record is None:
                raw = self._request(config, "/frame/photos/" + quote(source["storage_id"], safe=""), MAX_IMAGE_BYTES)
                normalized, width, height, source_size = self._normalize_photo(raw, source)
                destination.write_bytes(normalized)
                record = {"id": source["id"], "width": width, "height": height,
                          "source_width": source_size[0], "source_height": source_size[1],
                          "cache_sha256": hashlib.sha256(normalized).hexdigest()}
            os.chmod(destination, 0o600)
            prepared[source["id"]] = record
            record = dict(record)
            if "foreground" in source:
                record["foreground"] = self._prepare_foreground(config, source["foreground"], record,
                                                                stage, cached, prepared_foregrounds)
            photos.append(record)
        return {"batch_id": manifest["batch_id"], "activated_at": manifest["activated_at"], "photos": photos}

    def sync_now(self) -> bool:
        """Synchronously refresh, retaining the previous batch on every failure."""
        if not self._sync_lock.acquire(blocking=False):
            return False
        stage: Optional[Path] = None
        installed: Optional[Path] = None
        try:
            with self._lock:
                config = dict(self._config)
                revision = self._config_revision
                if not config["cloud_url"] or not config["token"]:
                    return False
                self._syncing = True
            manifest = self._parse_manifest(self._request(config, "/frame/manifest", MAX_MANIFEST_BYTES))
            with self._lock:
                active = self._active
            unchanged = bool(manifest and active and manifest["batch_id"] == active["batch_id"]
                             and [(p["id"], p.get("foreground", {}).get("id")) for p in manifest["photos"]]
                             == [(p["id"], p.get("foreground", {}).get("id")) for p in active["photos"]]
                             and self._validated_cached_batch(active))
            if manifest is not None and not unchanged:
                stage = self.cache_root / ("stage-" + uuid.uuid4().hex)
                stage.mkdir(mode=0o700)
                incoming = self._build_batch(config, manifest, stage)
                installed = self.cache_root / ("batch-" + uuid.uuid4().hex)
                os.replace(stage, installed)
                stage = None
                incoming["cache_dir"] = installed.name
                with self._lock:
                    if revision != self._config_revision or self._stop.is_set():
                        return False
                    previous = self._active if self._active and self._active["batch_id"] != incoming["batch_id"] else self._previous
                    last_sync = int(time.time() * 1000)
                    self._write_json(self.state_path, {"active": incoming, "previous": previous, "last_sync": last_sync})
                    self._active, self._previous, self._last_sync = incoming, previous, last_sync
                    installed = None
                    self._last_error = None
                self._prune_cache()
            else:
                with self._lock:
                    if revision != self._config_revision or self._stop.is_set():
                        return False
                    last_sync = int(time.time() * 1000)
                    self._write_json(self.state_path, {"active": self._active, "previous": self._previous, "last_sync": last_sync})
                    self._last_sync = last_sync
                    self._last_error = None
            return True
        except HTTPError as error:
            if error.code in (401, 403):
                message = "Photo authentication failed. Check the connection token."
            elif error.code == 404:
                message = "The photo service or a photo was not found. Check the deployment and retry."
            else:
                message = "The photo service is unavailable. The last downloaded photos will keep playing."
            error.close()
            with self._lock:
                self._last_error = message
            return False
        except _FrameError as error:
            with self._lock:
                self._last_error = str(error)
            return False
        except Exception:
            # Do not return exception text: URLs, credentials, or photo metadata
            # can be included in exceptions raised by network and image libraries.
            with self._lock:
                self._last_error = "Photo sync could not finish. The last downloaded photos will keep playing."
            return False
        finally:
            for temporary in (stage, installed):
                if temporary is not None:
                    self._remove_cache_dir(temporary)
            with self._lock:
                self._syncing = False
            self._sync_lock.release()

    def _remove_cache_dir(self, path: Path) -> None:
        if path.parent != self.cache_root or not CACHE_DIR_RE.fullmatch(path.name):
            return
        try:
            if path.is_symlink():
                path.unlink()
            elif path.is_dir():
                shutil.rmtree(path)
        except OSError:
            pass

    def _prune_cache(self) -> None:
        with self._lock:
            retained = {batch["cache_dir"] for batch in (self._active, self._previous) if batch}
        for path in self.cache_root.iterdir():
            if path.name not in retained:
                self._remove_cache_dir(path)
