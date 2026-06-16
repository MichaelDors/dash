from __future__ import annotations

import base64
import io
import json
import os
import random

import signal
import socket
import sys
import threading
import time
from datetime import datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

try:
    # Optional: local launcher module that knows how to read/compare versions.
    import dash as dash_launcher  # type: ignore[import-untyped]

    DASH_LAUNCHER_AVAILABLE = True
except Exception:
    dash_launcher = None  # type: ignore[assignment]
    DASH_LAUNCHER_AVAILABLE = False

try:
    import RPi.GPIO as GPIO

    GPIO_AVAILABLE = True
except Exception:
    GPIO_AVAILABLE = False

    class _MockGPIO:
        BOARD = "BOARD"
        IN = "IN"
        HIGH = 1

        @staticmethod
        def setmode(_mode: Any) -> None:
            return

        @staticmethod
        def setup(_pin: int, _mode: Any, **_kwargs: Any) -> None:
            return

        @staticmethod
        def input(_pin: int) -> int:
            return 0

        @staticmethod
        def cleanup() -> None:
            return

    GPIO = _MockGPIO()  # type: ignore[assignment]

try:
    from gpiozero import Button, RotaryEncoder

    GPIOZERO_AVAILABLE = True
except Exception:
    GPIOZERO_AVAILABLE = False
    Button = None  # type: ignore[assignment]
    RotaryEncoder = None  # type: ignore[assignment]

try:
    from PIL import Image, ImageChops, ImageDraw, ImageFont

    PIL_AVAILABLE = True
except Exception:
    PIL_AVAILABLE = False
    Image = None  # type: ignore[assignment]
    ImageChops = None  # type: ignore[assignment]
    ImageDraw = None  # type: ignore[assignment]
    ImageFont = None  # type: ignore[assignment]

# --- PIN DEFINITIONS ---
# Same as nanobackup.py: RPi.GPIO uses BOARD for motion/display only; gpiozero uses these (BCM) for encoder/buttons
CLK_PIN = 5       # encoder CLK (physical 29)
DT_PIN = 6        # encoder DT (physical 31)
SW_PIN = 13       # main button (physical 33)
BUTTON1_PIN = 23  # button1 (physical 16)
BUTTON2_PIN = 26  # button2 (physical 37)
# BOARD numbering — RPi.GPIO only (motion + display); do not set up encoder/button pins with GPIO
MOTION_PIN = 36    # physical pin 36
OLED_A0_PIN = 22   # physical pin 22
OLED_RESN_PIN = 18 # physical pin 18

# --- MOTION SETTINGS ---
MOTION_DIM_DELAY = 30
MOTION_OFF_DELAY = 90
MOTION_CHECK_INTERVAL = 0.5
MOTION_DEBUG = True

# --- APP SETTINGS ---
HTTP_HOST = os.getenv("DASH_HOST", "0.0.0.0")
HTTP_PORT = int(os.getenv("DASH_PORT", "8080"))
ALLOW_SYSTEM_POWER_OFF = os.getenv("DASH_ALLOW_POWEROFF", "1") == "1"
OLED_ENABLED = os.getenv("DASH_OLED", "1") == "1"
DIAL_HOLD_WIDGET_SECONDS = 1.0
DIAL_HOLD_EXIT_SECONDS = 3.0
DIAL_EXIT_UNFILL_SECONDS = 0.6
SPOTIFY_BACKGROUND_POLL_SECONDS = 15.0
SPOTIFY_AUTO_SWITCH_IDLE_SECONDS = 60.0
SERVER_BIND_MAX_RETRIES = 5
SERVER_BIND_RETRY_DELAY = 1.0

BASE_DIR = Path(__file__).resolve().parent
WEB_DIR = BASE_DIR / "web"

try:
    from oled_driver import (
        DISPLAY_DIM_BRIGHTNESS,
        DISPLAY_FULL_BRIGHTNESS,
        SH1106Driver,
        image_to_sh1106_pages,
    )
except Exception:
    DISPLAY_DIM_BRIGHTNESS = 0x10
    DISPLAY_FULL_BRIGHTNESS = 0xCF
    SH1106Driver = None  # type: ignore[misc, assignment]
    image_to_sh1106_pages = None  # type: ignore[assignment]


def setup_gpio_pins() -> bool:
    """Set up GPIO pins used by the web dashboard runtime and optional OLED."""
    if not GPIO_AVAILABLE:
        print("RPi.GPIO not available; running in software-only mode.")
        return False

    try:
        GPIO.setwarnings(False)
        GPIO.setmode(GPIO.BOARD)
        GPIO.setup(MOTION_PIN, GPIO.IN)
        # Display pins for SH1106 (optional; used when OLED is enabled)
        if hasattr(GPIO, "OUT"):
            GPIO.setup(OLED_A0_PIN, GPIO.OUT, initial=GPIO.HIGH)
            GPIO.setup(OLED_RESN_PIN, GPIO.OUT, initial=GPIO.HIGH)
        print("GPIO setup completed (BOARD mode).")
        return True
    except Exception as exc:
        print(f"GPIO setup failed: {exc}")
        return False


class MotionSensorManager:
    """Tracks motion and display power states for the dashboard."""

    def __init__(self, sensor_available: bool):
        self.sensor_available = sensor_available
        self.last_activity_time = time.time()
        self.motion_detected = False
        self.display_dimmed = False
        self.display_off = False
        if os.environ.get("DASH_QUIET_UPDATE") == "1":
            self.last_activity_time = time.time() - 3600
            self.display_off = True
        self._lock = threading.Lock()
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._display_turn_off: Optional[Any] = None
        self._display_turn_on: Optional[Any] = None
        self._display_set_brightness: Optional[Any] = None

    def set_display_driver(
        self,
        turn_off: Optional[Any] = None,
        turn_on: Optional[Any] = None,
        set_brightness: Optional[Any] = None,
    ) -> None:
        """Set optional display driver callbacks for physical OLED on/dim/off."""
        self._display_turn_off = turn_off
        self._display_turn_on = turn_on
        self._display_set_brightness = set_brightness

    def start_monitoring(self) -> None:
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._monitor_loop, daemon=True)
        self._thread.start()
        print("Motion manager started.")

    def stop_monitoring(self) -> None:
        self._running = False
        if self._thread is not None:
            self._thread.join(timeout=1.0)
            print("Motion manager stopped.")

    def report_user_activity(self, motion: bool = False) -> None:
        with self._lock:
            self.last_activity_time = time.time()
            if motion:
                self.motion_detected = True

            if self.display_off:
                print("Motion/activity detected: restoring display from OFF.")
            elif self.display_dimmed:
                print("Motion/activity detected: restoring display from DIM.")

            self.display_dimmed = False
            self.display_off = False

            if self._display_turn_on:
                self._display_turn_on()
            if self._display_set_brightness:
                self._display_set_brightness(DISPLAY_FULL_BRIGHTNESS)

    def get_status(self) -> Dict[str, Any]:
        with self._lock:
            elapsed = max(0, int(time.time() - self.last_activity_time))
            return {
                "sensor_available": self.sensor_available,
                "motion_detected": self.motion_detected,
                "display_dimmed": self.display_dimmed,
                "display_off": self.display_off,
                "seconds_since_activity": elapsed,
                "minutes_since_activity": elapsed // 60,
            }

    def _monitor_loop(self) -> None:
        if MOTION_DEBUG:
            print("Motion monitor loop running.")

        while self._running:
            now = time.time()
            sensor_motion = False

            if self.sensor_available:
                try:
                    if GPIO_AVAILABLE:
                        sensor_motion = bool(GPIO.input(MOTION_PIN))
                    else:
                        sensor_motion = False
                except Exception as exc:
                    if MOTION_DEBUG:
                        print(f"Motion sensor read error: {exc}")

            with self._lock:
                if sensor_motion:
                    self.last_activity_time = now
                    if not self.motion_detected and MOTION_DEBUG:
                        print("Motion detected.")
                    self.motion_detected = True
                    self.display_dimmed = False
                    self.display_off = False
                    if self._display_turn_on:
                        self._display_turn_on()
                    if self._display_set_brightness:
                        self._display_set_brightness(DISPLAY_FULL_BRIGHTNESS)
                else:
                    if self.motion_detected and MOTION_DEBUG:
                        print("No motion detected.")
                    self.motion_detected = False
                    elapsed = now - self.last_activity_time
                    if elapsed >= MOTION_OFF_DELAY and not self.display_off:
                        self.display_off = True
                        self.display_dimmed = False
                        print("No activity threshold reached: display set to OFF state.")
                        if self._display_turn_off:
                            self._display_turn_off()
                    elif (
                        elapsed >= MOTION_DIM_DELAY
                        and not self.display_dimmed
                        and not self.display_off
                    ):
                        self.display_dimmed = True
                        print("No activity threshold reached: display set to DIM state.")
                        if self._display_set_brightness:
                            self._display_set_brightness(DISPLAY_DIM_BRIGHTNESS)

            time.sleep(MOTION_CHECK_INTERVAL)


class Widget:
    """Base widget with a consistent interaction surface."""

    def __init__(self, widget_id: str, name: str):
        self.widget_id = widget_id
        self.name = name
        self.last_button_press_time = 0.0
        self.button_cooldown = 0.15

    def should_process_button_press(self) -> bool:
        now = time.time()
        if now - self.last_button_press_time < self.button_cooldown:
            return False
        self.last_button_press_time = now
        return True

    def get_state(self) -> Dict[str, Any]:
        return {}

    def set_state(self, state: Dict[str, Any]) -> None:
        pass

    def update(self, _now: float) -> None:
        return

    def on_button_press(self) -> None:
        return

    def on_button_hold_start(self) -> None:
        return

    def to_payload(self) -> Dict[str, Any]:
        return {
            "id": self.widget_id,
            "name": self.name,
            "type": "unknown",
        }


class TimeWidget(Widget):
    def __init__(self) -> None:
        super().__init__("time", "Time")

    def to_payload(self) -> Dict[str, Any]:
        now = datetime.now()
        hour_12 = now.hour % 12 or 12
        return {
            "id": self.widget_id,
            "name": self.name,
            "type": "time",
            "time_main": f"{hour_12}:{now.minute:02d}",
            "seconds": f"{now.second:02d}",
            "day": now.day,
            "month": now.strftime("%b").upper(),
        }


class ClickCounterWidget(Widget):
    def __init__(self) -> None:
        super().__init__("click_counter", "Counter")
        self.click_count = 0

    def get_state(self) -> Dict[str, Any]:
        return {"count": self.click_count}

    def set_state(self, state: Dict[str, Any]) -> None:
        if "count" in state:
            self.click_count = int(state["count"])

    def on_button_press(self) -> None:
        self.click_count += 1
        print(f"Click count: {self.click_count}")

    def on_button_hold_start(self) -> None:
        self.click_count = 0
        print("Click counter reset to 0.")

    def to_payload(self) -> Dict[str, Any]:
        return {
            "id": self.widget_id,
            "name": self.name,
            "type": "click_counter",
            "count": self.click_count,
        }


class TimerWidget(Widget):
    def __init__(self) -> None:
        super().__init__("timer", "Timer")
        self.set_minutes = 5
        self.remaining_seconds = self.set_minutes * 60
        self.running = False
        self.last_update_time: Optional[float] = None
        self.flash_until: Optional[float] = None
        self.flash_state = False

    def get_state(self) -> Dict[str, Any]:
        return {"set_minutes": self.set_minutes}

    def set_state(self, state: Dict[str, Any]) -> None:
        if "set_minutes" in state:
            self.set_minutes = int(state["set_minutes"])
            self.remaining_seconds = self.set_minutes * 60
            self.running = False

    def on_button_press(self) -> None:
        if self.running:
            self._pause_timer()
            print("Timer paused.")
        else:
            self._start_timer()
            print("Timer started.")

    def add_minute(self) -> None:
        if self.running:
            return
        self.set_minutes = min(99, self.set_minutes + 1)
        self.remaining_seconds = self.set_minutes * 60
        print(f"Added 1 minute. New time: {self.set_minutes} minutes.")

    def subtract_minute(self) -> None:
        if self.running:
            return
        self.set_minutes = max(1, self.set_minutes - 1)
        self.remaining_seconds = self.set_minutes * 60
        print(f"Subtracted 1 minute. New time: {self.set_minutes} minutes.")

    def update(self, now: float) -> None:
        if self.running and self.last_update_time is not None:
            elapsed = now - self.last_update_time
            self.remaining_seconds -= elapsed
            if self.remaining_seconds <= 0:
                self.running = False
                self.remaining_seconds = 0
                self.flash_until = now + 3.0
                print("Timer finished.")
        
        self.last_update_time = now
        if self.flash_until and now < self.flash_until:
            self.flash_state = (int(now * 2) % 2) == 0
        else:
            self.flash_state = False

    def _start_timer(self) -> None:
        self.running = True
        self.last_update_time = time.time()

    def _pause_timer(self) -> None:
        self.running = False

    def to_payload(self) -> Dict[str, Any]:
        mins = int(self.remaining_seconds // 60)
        secs = int(self.remaining_seconds % 60)
        return {
            "id": self.widget_id,
            "name": self.name,
            "type": "timer",
            "running": self.running,
            "flash": self.flash_state,
            "minutes": mins,
            "seconds": secs,
            "time_text": f"{mins:02d}:{secs:02d}",
        }


class MotionStatusWidget(Widget):
    def __init__(self, motion_manager: MotionSensorManager) -> None:
        super().__init__("motion_status", "Motion Status")
        self.motion_manager = motion_manager

    def to_payload(self) -> Dict[str, Any]:
        status = self.motion_manager.get_status()
        display_state = "ON"
        if status["display_off"]:
            display_state = "OFF"
        elif status["display_dimmed"]:
            display_state = "DIM"

        return {
            "id": self.widget_id,
            "name": self.name,
            "type": "motion_status",
            "motion_detected": status["motion_detected"],
            "sensor_available": status["sensor_available"],
            "display_state": display_state,
            "idle": (
                f"{status['minutes_since_activity']:02d}:"
                f"{status['seconds_since_activity'] % 60:02d}"
            ),
        }


WEATHER_CODE_LABELS: dict[int, str] = {
    0: "Clear",
    1: "Mostly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Rime fog",
    51: "Drizzle light",
    53: "Drizzle",
    55: "Drizzle heavy",
    56: "Freezing drizzle",
    57: "Freezing drizzle heavy",
    61: "Rain light",
    63: "Rain",
    65: "Rain heavy",
    66: "Freezing rain",
    67: "Freezing rain heavy",
    71: "Snow light",
    73: "Snow",
    75: "Snow heavy",
    77: "Snow grains",
    80: "Rain showers",
    81: "Rain showers heavy",
    82: "Rain showers violent",
    85: "Snow showers",
    86: "Snow showers heavy",
    95: "Thunderstorm",
    96: "Thunderstorm hail",
    99: "Thunderstorm hail heavy",
}


def _weather_code_label(code: Optional[int]) -> str:
    if code is None:
        return "Unknown"
    try:
        return WEATHER_CODE_LABELS.get(int(code), "Unknown")
    except (TypeError, ValueError):
        return "Unknown"


class WeatherWidget(Widget):
    """Weather widget powered by the free Open-Meteo API (no API key required)."""

    GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"
    FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
    USER_AGENT = "Dash-Weather/1.0"
    FETCH_INTERVAL = 10 * 60
    BACKOFF_SECONDS = 120
    MAX_QUERY_LEN = 80

    def __init__(self) -> None:
        super().__init__("weather", "Weather")
        self.location_query: Optional[str] = None
        self.location_label: Optional[str] = None
        self.latitude: Optional[float] = None
        self.longitude: Optional[float] = None

        self.temperature_f: Optional[float] = None
        self.apparent_f: Optional[float] = None
        self.wind_mph: Optional[float] = None
        self.weather_code: Optional[int] = None
        self.is_day: Optional[int] = None
        self.last_updated: Optional[str] = None

        self.last_error: Optional[str] = None
        self._geocode_query: Optional[str] = None
        self._next_fetch_ts = 0.0

    def get_state(self) -> Dict[str, Any]:
        return {"location_query": self.location_query}

    def set_state(self, state: Dict[str, Any]) -> None:
        if "location_query" in state and state["location_query"]:
            self.location_query = state["location_query"]
            self._next_fetch_ts = 0.0

    def set_location(self, query: str) -> Optional[str]:
        cleaned = " ".join((query or "").strip().split())
        if not cleaned:
            self.location_query = None
            self.location_label = None
            self.latitude = None
            self.longitude = None
            self._geocode_query = None
            self._clear_weather()
            self.last_error = None
            self._next_fetch_ts = 0.0
            return None
        if len(cleaned) > self.MAX_QUERY_LEN:
            return f"Location must be {self.MAX_QUERY_LEN} characters or fewer."

        self.location_query = cleaned
        self.location_label = None
        self.latitude = None
        self.longitude = None
        self._geocode_query = None
        self._clear_weather()
        self.last_error = None
        self._next_fetch_ts = 0.0
        return None

    def update(self, now: float) -> None:
        if not self.location_query:
            return
        if now < self._next_fetch_ts:
            return
        try:
            if self._geocode_query != self.location_query or self.latitude is None or self.longitude is None:
                self._geocode_location()
            self._fetch_weather()
            self.last_error = None
            self._next_fetch_ts = now + self.FETCH_INTERVAL
        except Exception as exc:
            self.last_error = str(exc)
            self._next_fetch_ts = now + self.BACKOFF_SECONDS

    def to_payload(self) -> Dict[str, Any]:
        condition = _weather_code_label(self.weather_code)
        return {
            "id": self.widget_id,
            "name": self.name,
            "type": "weather",
            "location_query": self.location_query,
            "location": self.location_label or self.location_query,
            "temperature_f": self.temperature_f,
            "apparent_f": self.apparent_f,
            "wind_mph": self.wind_mph,
            "weather_code": self.weather_code,
            "condition": condition,
            "is_day": self.is_day,
            "last_updated": self.last_updated,
            "error": self.last_error,
            "needs_location": self.location_query is None,
        }

    def _clear_weather(self) -> None:
        self.temperature_f = None
        self.apparent_f = None
        self.wind_mph = None
        self.weather_code = None
        self.is_day = None
        self.last_updated = None

    def _geocode_location(self) -> None:
        if not self.location_query:
            raise ValueError("Location not set.")

        params = {
            "name": self.location_query,
            "count": 1,
            "format": "json",
        }
        data = self._fetch_json(self.GEOCODE_URL, params, timeout=6.0)
        results = data.get("results") or []
        if not results:
            raise ValueError("Location not found.")

        result = results[0] or {}
        self.latitude = self._to_float(result.get("latitude"))
        self.longitude = self._to_float(result.get("longitude"))
        if self.latitude is None or self.longitude is None:
            raise ValueError("Location lookup failed.")

        self.timezone = str(result.get("timezone") or "auto")
        self.location_label = self._format_location_label(result)
        self._geocode_query = self.location_query

    def _fetch_weather(self) -> None:
        if self.latitude is None or self.longitude is None:
            raise ValueError("Location coordinates missing.")

        params = {
            "latitude": f"{self.latitude:.4f}",
            "longitude": f"{self.longitude:.4f}",
            "current": "temperature_2m,apparent_temperature,weather_code,wind_speed_10m,is_day",
            "temperature_unit": "fahrenheit",
            "wind_speed_unit": "mph",
            "timezone": "auto",
        }
        data = self._fetch_json(self.FORECAST_URL, params, timeout=8.0)
        current = data.get("current") or {}
        if not current:
            raise ValueError("No current weather data.")

        self.temperature_f = self._to_float(current.get("temperature_2m"))
        self.apparent_f = self._to_float(current.get("apparent_temperature"))
        self.wind_mph = self._to_float(current.get("wind_speed_10m"))
        self.weather_code = self._to_int(current.get("weather_code"))
        self.is_day = bool(current.get("is_day")) if current.get("is_day") is not None else None
        self.last_updated = str(current.get("time") or "")

    def _fetch_json(self, base_url: str, params: Dict[str, Any], timeout: float) -> Dict[str, Any]:
        query = urlencode({k: v for k, v in params.items() if v is not None})
        url = f"{base_url}?{query}"
        req = Request(url, headers={"User-Agent": self.USER_AGENT})
        try:
            with urlopen(req, timeout=timeout) as resp:
                payload = resp.read()
        except HTTPError as exc:
            raise ValueError(f"Weather API error: HTTP {exc.code}") from exc
        except (URLError, OSError) as exc:
            raise ValueError("Weather API request failed.") from exc

        try:
            data = json.loads(payload.decode("utf-8"))
        except ValueError as exc:
            raise ValueError("Weather API response invalid.") from exc

        if isinstance(data, dict) and data.get("error"):
            reason = data.get("reason") or "Unknown error."
            raise ValueError(str(reason))
        if not isinstance(data, dict):
            raise ValueError("Weather API response invalid.")
        return data

    def _format_location_label(self, result: Dict[str, Any]) -> Optional[str]:
        name = str(result.get("name") or "").strip()
        admin1 = str(result.get("admin1") or "").strip()
        country = str(result.get("country_code") or result.get("country") or "").strip()
        parts = [p for p in (name, admin1, country) if p]
        return ", ".join(parts) if parts else None

    def _to_float(self, value: Any) -> Optional[float]:
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    def _to_int(self, value: Any) -> Optional[int]:
        try:
            return int(float(value))
        except (TypeError, ValueError):
            return None


class VersionStatusWidget(Widget):
    FETCH_INTERVAL = 30 * 60

    def __init__(self) -> None:
        super().__init__("version_status", "Version Debug")
        self.repo = os.getenv("GITHUB_REPO", "MichaelDors/dash").strip() or "MichaelDors/dash"
        self.branch = os.getenv("GITHUB_BRANCH", "main").strip() or "main"
        self.local_version = "unknown"
        self.remote_version: Optional[str] = None
        self.error: Optional[str] = None
        self.checked_at: Optional[datetime] = None
        self._next_fetch_ts = time.time() + self.FETCH_INTERVAL
        self._compute_versions()

    def update(self, now: float) -> None:
        if now >= self._next_fetch_ts:
            self._compute_versions()
            self._next_fetch_ts = now + self.FETCH_INTERVAL

    def _compute_versions(self) -> None:
        try:
            # Prefer using the launcher helpers if available so version parsing
            # and remote fetching logic stays in one place.
            if DASH_LAUNCHER_AVAILABLE and dash_launcher is not None:
                self.local_version = dash_launcher.read_local_version()
                self.remote_version = dash_launcher.fetch_remote_version(self.repo, self.branch)
                self.checked_at = datetime.now()
            else:
                version_file = BASE_DIR / "VERSION"
                if version_file.exists():
                    self.local_version = version_file.read_text(encoding="utf-8").strip()
        except Exception as exc:
            self.error = str(exc)

    def to_payload(self) -> Dict[str, Any]:
        remote = self.remote_version
        status = "unknown"
        remote_newer = False

        if remote is None:
            status = "no remote"
        else:
            try:
                if DASH_LAUNCHER_AVAILABLE and dash_launcher is not None:
                    if dash_launcher.is_newer(remote, self.local_version):
                        status = "remote newer"
                        remote_newer = True
                    else:
                        status = "up-to-date"
                else:
                    status = "remote available"
            except Exception:
                status = "compare error"

        return {
            "id": self.widget_id,
            "name": self.name,
            "type": "version_status",
            "local": self.local_version,
            "remote": remote,
            "repo": self.repo,
            "branch": self.branch,
            "status": status,
            "remote_newer": remote_newer,
            "checked_at": self.checked_at.isoformat(timespec="seconds") if self.checked_at else None,
            "error": self.error,
        }


class PhotoWidget(Widget):
    """Widget that displays an uploaded photo converted to pure black & white (1-bit)."""

    MAX_IMAGE_BYTES = 5 * 1024 * 1024  # 5 MB upload limit
    MAX_DIMENSION = 4096  # reject images larger than 4096 in either axis

    def __init__(self) -> None:
        super().__init__("photo", "Photo")
        self._bw_base64: Optional[str] = None
        self._lock = threading.Lock()

    def get_state(self) -> Dict[str, Any]:
        with self._lock:
            return {"bw_base64": self._bw_base64}

    def set_state(self, state: Dict[str, Any]) -> None:
        if "bw_base64" in state:
            with self._lock:
                self._bw_base64 = state["bw_base64"]

    def set_image(self, raw_bytes: bytes) -> str:
        """Accept raw image bytes, convert to pure black & white, store as base64 PNG.

        Returns an empty string on success or an error message.
        """
        if not PIL_AVAILABLE or Image is None:
            return "Pillow is not installed on the server."
        if len(raw_bytes) > self.MAX_IMAGE_BYTES:
            return "Image exceeds 5 MB limit."
        try:
            img = Image.open(io.BytesIO(raw_bytes))
            img.verify()  # validate image integrity
            # Re-open after verify (verify may leave file pointer in bad state)
            img = Image.open(io.BytesIO(raw_bytes))
            if img.width > self.MAX_DIMENSION or img.height > self.MAX_DIMENSION:
                return f"Image too large ({img.width}x{img.height}). Max {self.MAX_DIMENSION}px per side."
            bw = img.convert("1")  # 1-bit black & white (not greyscale)
            buf = io.BytesIO()
            bw.save(buf, format="PNG")
            encoded = base64.b64encode(buf.getvalue()).decode("ascii")
            with self._lock:
                self._bw_base64 = encoded
            return ""
        except Exception as exc:
            return f"Failed to process image: {exc}"

    def on_button_hold_start(self) -> None:
        with self._lock:
            self._bw_base64 = None
        print("Photo widget image cleared.")

    def to_payload(self) -> Dict[str, Any]:
        with self._lock:
            has_image = self._bw_base64 is not None
            image_data = self._bw_base64
        return {
            "id": self.widget_id,
            "name": self.name,
            "type": "photo",
            "has_image": has_image,
            "image_base64": image_data,
        }


class App:
    """Base class for full-screen apps that can take over the dial."""

    def __init__(self, app_id: str, name: str):
        self.app_id = app_id
        self.name = name

    def reset(self) -> None:
        return

    def update(self, _now: float, _dt: float) -> None:
        return

    def on_encoder(self, _delta: int) -> None:
        return

    def on_button1(self) -> None:
        return

    def on_button2(self) -> None:
        return

    def on_dial_press(self) -> None:
        return

    def to_payload(self) -> Dict[str, Any]:
        return {
            "id": self.app_id,
            "name": self.name,
            "type": "app",
        }


class PongApp(App):
    """Simple Pong clone for the 128x64 display."""

    FIELD_WIDTH = 128
    FIELD_HEIGHT = 64
    PADDLE_HEIGHT = 14
    PADDLE_WIDTH = 2
    BALL_SIZE = 2
    PLAYER_X = 4
    CPU_X = FIELD_WIDTH - PADDLE_WIDTH - 4
    PLAYER_STEP = 3
    BALL_SPEED = 46.0
    CPU_SPEED = 34.0
    SERVE_PAUSE = 0.4

    def __init__(self) -> None:
        super().__init__("pong", "Pong")
        self.player_y = 0.0
        self.cpu_y = 0.0
        self.ball_x = 0.0
        self.ball_y = 0.0
        self.ball_vx = self.BALL_SPEED
        self.ball_vy = self.BALL_SPEED * 0.6
        self.score_player = 0
        self.score_cpu = 0
        self._serve_until = 0.0
        self.reset()

    def reset(self) -> None:
        self.score_player = 0
        self.score_cpu = 0
        self._reset_round(time.time(), direction=random.choice([-1, 1]))

    def _reset_round(self, now: float, direction: int) -> None:
        self.player_y = (self.FIELD_HEIGHT - self.PADDLE_HEIGHT) / 2
        self.cpu_y = (self.FIELD_HEIGHT - self.PADDLE_HEIGHT) / 2
        self.ball_x = (self.FIELD_WIDTH - self.BALL_SIZE) / 2
        self.ball_y = (self.FIELD_HEIGHT - self.BALL_SIZE) / 2
        self.ball_vx = self.BALL_SPEED * (1 if direction >= 0 else -1)
        self.ball_vy = self.BALL_SPEED * random.choice([-0.6, 0.6])
        self._serve_until = now + self.SERVE_PAUSE

    def on_encoder(self, delta: int) -> None:
        self.player_y = min(
            max(0.0, self.player_y + delta * self.PLAYER_STEP),
            self.FIELD_HEIGHT - self.PADDLE_HEIGHT,
        )

    def update(self, now: float, dt: float) -> None:
        if now < self._serve_until:
            return

        # Simple CPU tracking
        ball_center = self.ball_y + self.BALL_SIZE / 2
        target = ball_center - self.PADDLE_HEIGHT / 2
        if self.ball_vx < 0:
            target = (self.FIELD_HEIGHT - self.PADDLE_HEIGHT) / 2
        max_move = self.CPU_SPEED * dt
        if self.cpu_y < target:
            self.cpu_y = min(self.cpu_y + max_move, target)
        else:
            self.cpu_y = max(self.cpu_y - max_move, target)
        self.cpu_y = min(max(self.cpu_y, 0.0), self.FIELD_HEIGHT - self.PADDLE_HEIGHT)

        # Move ball
        self.ball_x += self.ball_vx * dt
        self.ball_y += self.ball_vy * dt

        if self.ball_y <= 0:
            self.ball_y = 0
            self.ball_vy = abs(self.ball_vy)
        elif self.ball_y + self.BALL_SIZE >= self.FIELD_HEIGHT:
            self.ball_y = self.FIELD_HEIGHT - self.BALL_SIZE
            self.ball_vy = -abs(self.ball_vy)

        # Paddle collisions
        if self.ball_vx < 0 and self._intersects_paddle(self.PLAYER_X, self.player_y):
            self.ball_x = self.PLAYER_X + self.PADDLE_WIDTH + 0.1
            self.ball_vx = abs(self.ball_vx)
            self._apply_deflection(self.player_y)
        elif self.ball_vx > 0 and self._intersects_paddle(self.CPU_X, self.cpu_y):
            self.ball_x = self.CPU_X - self.BALL_SIZE - 0.1
            self.ball_vx = -abs(self.ball_vx)
            self._apply_deflection(self.cpu_y)

        # Scoring
        if self.ball_x + self.BALL_SIZE < 0:
            self.score_cpu += 1
            self._reset_round(now, direction=1)
        elif self.ball_x > self.FIELD_WIDTH:
            self.score_player += 1
            self._reset_round(now, direction=-1)

    def _intersects_paddle(self, paddle_x: int, paddle_y: float) -> bool:
        return (
            self.ball_x < paddle_x + self.PADDLE_WIDTH
            and self.ball_x + self.BALL_SIZE > paddle_x
            and self.ball_y < paddle_y + self.PADDLE_HEIGHT
            and self.ball_y + self.BALL_SIZE > paddle_y
        )

    def _apply_deflection(self, paddle_y: float) -> None:
        paddle_center = paddle_y + self.PADDLE_HEIGHT / 2
        ball_center = self.ball_y + self.BALL_SIZE / 2
        offset = (ball_center - paddle_center) / (self.PADDLE_HEIGHT / 2)
        offset = max(-1.0, min(1.0, offset))
        self.ball_vy = offset * self.BALL_SPEED

    def to_payload(self) -> Dict[str, Any]:
        return {
            "id": self.app_id,
            "name": self.name,
            "type": "pong",
            "field": {
                "width": self.FIELD_WIDTH,
                "height": self.FIELD_HEIGHT,
            },
            "ball": {
                "x": int(self.ball_x),
                "y": int(self.ball_y),
                "size": self.BALL_SIZE,
            },
            "player": {
                "x": self.PLAYER_X,
                "y": int(self.player_y),
                "width": self.PADDLE_WIDTH,
                "height": self.PADDLE_HEIGHT,
            },
            "cpu": {
                "x": self.CPU_X,
                "y": int(self.cpu_y),
                "width": self.PADDLE_WIDTH,
                "height": self.PADDLE_HEIGHT,
            },
            "score": {
                "player": self.score_player,
                "cpu": self.score_cpu,
            },
        }


class AppLauncherWidget(Widget):
    """Widget that launches a full-screen app."""

    def __init__(self, app: App):
        super().__init__(f"app_{app.app_id}", app.name)
        self.app = app
        self.app_id = app.app_id
        self.app_name = app.name

    def to_payload(self) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "id": self.widget_id,
            "name": self.name,
            "type": "app_launcher",
            "app_id": self.app_id,
            "app_name": self.app_name,
        }
        if self.app_id == "spotify":
            app_payload = self.app.to_payload()
            payload["preview_type"] = "spotify"
            payload["preview"] = {
                "track_name": app_payload.get("track_name"),
                "artist_name": app_payload.get("artist_name"),
                "is_playing": app_payload.get("is_playing"),
                "progress_ms": app_payload.get("progress_ms"),
                "duration_ms": app_payload.get("duration_ms"),
                "authenticated": app_payload.get("authenticated"),
                "progress_text": app_payload.get("progress_text"),
                "duration_text": app_payload.get("duration_text"),
            }
        return payload


class SpotifyClient:
    def __init__(self, token_file: Path):
        self.token_file = token_file
        self.client_id: Optional[str] = None
        self.client_secret: Optional[str] = None
        self.refresh_token: Optional[str] = None
        self.redirect_uri: Optional[str] = None
        self.access_token: Optional[str] = None
        self.expires_at: float = 0.0
        self._lock = threading.Lock()
        self.load_config()

    def load_config(self) -> None:
        with self._lock:
            if not self.token_file.exists():
                return
            try:
                data = json.loads(self.token_file.read_text(encoding="utf-8"))
                self.client_id = data.get("client_id")
                self.client_secret = data.get("client_secret")
                self.refresh_token = data.get("refresh_token")
                self.redirect_uri = data.get("redirect_uri")
            except Exception as e:
                print(f"Error loading spotify config: {e}")

    def save_config(self, client_id: str, client_secret: str, refresh_token: Optional[str] = None, redirect_uri: Optional[str] = None) -> None:
        with self._lock:
            self.client_id = client_id
            self.client_secret = client_secret
            if refresh_token is not None:
                self.refresh_token = refresh_token
            if redirect_uri is not None:
                self.redirect_uri = redirect_uri
            data = {
                "client_id": self.client_id,
                "client_secret": self.client_secret,
                "refresh_token": self.refresh_token,
                "redirect_uri": self.redirect_uri,
            }
            tmp_path = self.token_file.with_suffix('.tmp')
            tmp_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
            tmp_path.replace(self.token_file)

    def is_configured(self) -> bool:
        return bool(self.client_id and self.client_secret)

    def is_authenticated(self) -> bool:
        return bool(self.is_configured() and self.refresh_token)

    def get_auth_url(self, redirect_uri: str) -> str:
        if not self.client_id:
            return ""
        scopes = "user-read-playback-state user-modify-playback-state user-read-currently-playing"
        params = {
            "client_id": self.client_id,
            "response_type": "code",
            "redirect_uri": redirect_uri,
            "scope": scopes,
            "show_dialog": "true"
        }
        return "https://accounts.spotify.com/authorize?" + urlencode(params)

    def exchange_code(self, code: str, redirect_uri: str) -> bool:
        with self._lock:
            if not self.client_id or not self.client_secret:
                return False
            client_id = self.client_id
            client_secret = self.client_secret

        auth_str = f"{client_id}:{client_secret}"
        b64_auth = base64.b64encode(auth_str.encode()).decode()
        headers = {
            "Authorization": f"Basic {b64_auth}",
            "Content-Type": "application/x-www-form-urlencoded",
        }
        data = urlencode({
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
        }).encode()
        
        req = Request("https://accounts.spotify.com/api/token", data=data, headers=headers, method="POST")
        try:
            with urlopen(req, timeout=10) as resp:
                resp_data = json.loads(resp.read().decode())
                refresh_token = resp_data.get("refresh_token")
                if refresh_token:
                    self.save_config(client_id, client_secret, refresh_token)
                    return True
        except Exception as e:
            print(f"Failed to exchange Spotify code: {e}")
        return False

    def _get_access_token(self) -> Optional[str]:
        with self._lock:
            if not self.is_authenticated():
                return None
            if self.access_token and time.time() < self.expires_at:
                return self.access_token
            
            client_id = self.client_id
            client_secret = self.client_secret
            refresh_token = self.refresh_token
                
        auth_str = f"{client_id}:{client_secret}"
        b64_auth = base64.b64encode(auth_str.encode()).decode()
        headers = {
            "Authorization": f"Basic {b64_auth}",
            "Content-Type": "application/x-www-form-urlencoded",
        }
        data = urlencode({
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
        }).encode()
        
        req = Request("https://accounts.spotify.com/api/token", data=data, headers=headers, method="POST")
        try:
            with urlopen(req, timeout=5) as resp:
                resp_data = json.loads(resp.read().decode())
                with self._lock:
                    self.access_token = resp_data.get("access_token")
                    expires_in = resp_data.get("expires_in", 3600)
                    self.expires_at = time.time() + expires_in - 60
                    new_refresh = resp_data.get("refresh_token")
                    if new_refresh:
                        self.refresh_token = new_refresh
                        config_data = {
                            "client_id": self.client_id,
                            "client_secret": self.client_secret,
                            "refresh_token": self.refresh_token,
                            "redirect_uri": self.redirect_uri,
                        }
                        tmp_path = self.token_file.with_suffix('.tmp')
                        tmp_path.write_text(json.dumps(config_data, indent=2), encoding="utf-8")
                        tmp_path.replace(self.token_file)
                return self.access_token
        except Exception as e:
            print(f"Spotify token refresh failed: {e}")
            return None

    def _api_request(self, method: str, endpoint: str, params: Optional[Dict] = None, json_body: Optional[Dict] = None) -> Any:
        token = self._get_access_token()
        if not token:
            return None
        
        url = f"https://api.spotify.com/v1{endpoint}"
        if params:
            url += "?" + urlencode(params)
            
        headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        }
        
        data = None
        if json_body is not None:
            data = json.dumps(json_body).encode()
            headers["Content-Type"] = "application/json"
        elif method in ("POST", "PUT"):
            headers["Content-Length"] = "0"
            data = b""
            
        req = Request(url, data=data, headers=headers, method=method)
        try:
            with urlopen(req, timeout=5) as resp:
                if resp.status in (202, 204):
                    return {}
                body = resp.read().decode('utf-8').strip()
                if not body:
                    return {}
                try:
                    return json.loads(body)
                except Exception as e:
                    print(f"Spotify API JSON decode error: {e} for body: '{body}'")
                    return {}
        except HTTPError as e:
            if e.code in (202, 204):
                return {}
            print(f"Spotify API HTTP Error: {e.code} for {url}")
            return None
        except Exception as e:
            print(f"Spotify API Error: {e} for {url}")
            return None

    def get_currently_playing(self) -> Optional[Dict]:
        return self._api_request("GET", "/me/player/currently-playing")

    def play(self) -> None:
        self._api_request("PUT", "/me/player/play")

    def pause(self) -> None:
        self._api_request("PUT", "/me/player/pause")

    def next_track(self) -> None:
        self._api_request("POST", "/me/player/next")

    def previous_track(self) -> None:
        self._api_request("POST", "/me/player/previous")

    def seek(self, position_ms: int) -> None:
        self._api_request("PUT", "/me/player/seek", params={"position_ms": position_ms})


class SpotifyApp(App):
    def __init__(self, client: SpotifyClient):
        super().__init__("spotify", "Spotify")
        self.client = client
        self.track_name: str = ""
        self.artist_name: str = ""
        self.is_playing: bool = False
        self.progress_ms: int = 0
        self.duration_ms: int = 0
        self.last_fetch_time: float = 0
        self._scrub_target: Optional[int] = None
        self._last_scrub_time: float = 0
        self._last_btn1_time: float = 0
        self._last_btn2_time: float = 0
        self._last_dial_time: float = 0
        self._last_user_action_time: float = 0
        self._playback_stopped_time: float = time.time()
        self._fetch_in_flight = False
        self._playback_started_event = False
        self._playback_stopped_event = False

    def reset(self) -> None:
        self.track_name = ""
        self.artist_name = ""
        self.is_playing = False
        self.progress_ms = 0
        self.duration_ms = 0
        self._scrub_target = None
        self.last_fetch_time = 0
        self._last_user_action_time = time.time()
        self._playback_stopped_time = time.time()
        self._fetch_now()

    def _fetch_now(self) -> None:
        if self._fetch_in_flight:
            return
        self._fetch_in_flight = True

        def fetch() -> None:
            try:
                previous_playing = self.is_playing
                data = self.client.get_currently_playing()
                now = time.time()
                can_apply_playback_state = now - getattr(self, "_last_user_action_time", 0) > 3.0
                if isinstance(data, dict):
                    item = data.get("item")
                    if item:
                        self.track_name = item.get("name", "")
                        self.artist_name = ", ".join(a.get("name", "") for a in item.get("artists", []))
                        self.duration_ms = int(item.get("duration_ms", 0) or 0)
                    elif can_apply_playback_state:
                        self.track_name = ""
                        self.artist_name = ""
                        self.duration_ms = 0
                        self.progress_ms = 0

                    if can_apply_playback_state:
                        self.progress_ms = int(data.get("progress_ms", 0) or 0)
                        self.is_playing = bool(data.get("is_playing", False))
                elif can_apply_playback_state:
                    self.is_playing = False
                    self.progress_ms = 0

                if not previous_playing and self.is_playing:
                    self._playback_started_event = True
                if previous_playing and not self.is_playing:
                    self._playback_stopped_event = True
                    self._playback_stopped_time = now
                self.last_fetch_time = now
            finally:
                self._fetch_in_flight = False
        threading.Thread(target=fetch, daemon=True).start()

    def update(self, now: float, dt: float) -> None:
        if not self.client.is_authenticated():
            return

        if now - self.last_fetch_time > 2.0 and self._scrub_target is None:
            self._fetch_now()
            self.last_fetch_time = now
            
        if self._scrub_target is not None and now - self._last_scrub_time > 0.5:
            target = self._scrub_target
            self._scrub_target = None
            self._last_user_action_time = now
            threading.Thread(target=self.client.seek, args=(target,), daemon=True).start()
            self.progress_ms = target
            self.last_fetch_time = now

        if self.is_playing and self._scrub_target is None and now - self.last_fetch_time < 2.0:
            self.progress_ms = min(self.duration_ms, self.progress_ms + int(dt * 1000))

    def update_background(self, now: float, dt: float) -> None:
        if not self.client.is_authenticated():
            return
        if now - self.last_fetch_time > SPOTIFY_BACKGROUND_POLL_SECONDS and self._scrub_target is None:
            self._fetch_now()
            self.last_fetch_time = now
        if self.is_playing and self._scrub_target is None and self.duration_ms > 0:
            self.progress_ms = min(self.duration_ms, self.progress_ms + int(dt * 1000))

    def consume_playback_started_event(self) -> bool:
        started = self._playback_started_event
        self._playback_started_event = False
        return started

    def consume_playback_stopped_event(self) -> bool:
        stopped = self._playback_stopped_event
        self._playback_stopped_event = False
        return stopped

    def on_encoder(self, delta: int) -> None:
        if self.duration_ms == 0:
            return
        if self._scrub_target is None:
            self._scrub_target = self.progress_ms
        self._scrub_target += delta * 5000  # 5 seconds per tick
        self._scrub_target = max(0, min(self._scrub_target, self.duration_ms))
        self.progress_ms = self._scrub_target
        self._last_scrub_time = time.time()
        self._last_user_action_time = time.time()

    def on_dial_press(self) -> None:
        now = time.time()
        if now - getattr(self, "_last_dial_time", 0) < 0.5:
            return
        self._last_dial_time = now
        self._last_user_action_time = now
        
        if self.is_playing:
            threading.Thread(target=self.client.pause, daemon=True).start()
            self.is_playing = False
            self._playback_stopped_time = now
        else:
            threading.Thread(target=self.client.play, daemon=True).start()
            self.is_playing = True

    def _switch_track(self, direction: str) -> None:
        self._last_user_action_time = time.time()
        if direction == "prev":
            self.client.previous_track()
        else:
            self.client.next_track()
        time.sleep(0.4)
        self._fetch_now()

    def on_button1(self) -> None:
        now = time.time()
        if now - getattr(self, "_last_btn1_time", 0) < 0.5:
            return
        self._last_btn1_time = now
        threading.Thread(target=self._switch_track, args=("next",), daemon=True).start()

    def on_button2(self) -> None:
        now = time.time()
        if now - getattr(self, "_last_btn2_time", 0) < 0.5:
            return
        self._last_btn2_time = now
        threading.Thread(target=self._switch_track, args=("prev",), daemon=True).start()

    def to_payload(self) -> Dict[str, Any]:
        progress_ms = self._scrub_target if self._scrub_target is not None else self.progress_ms
        return {
            "id": self.app_id,
            "name": self.name,
            "type": "spotify",
            "track_name": self.track_name,
            "artist_name": self.artist_name,
            "is_playing": self.is_playing,
            "progress_ms": progress_ms,
            "duration_ms": self.duration_ms,
            "progress_text": _format_duration_ms(progress_ms),
            "duration_text": _format_duration_ms(self.duration_ms),
            "authenticated": self.client.is_authenticated()
        }


class DashboardController:
    """Coordinates widgets, motion state, and hardware/button actions."""

    def __init__(self, sensor_available: bool, spotify_client: Optional[SpotifyClient] = None):
        self.motion_manager = MotionSensorManager(sensor_available)
        self.spotify_client = spotify_client or SpotifyClient(BASE_DIR / "spotify_tokens.json")
        self.apps: List[App] = [
            PongApp(),
            SpotifyApp(self.spotify_client),
        ]
        self._app_by_id = {app.app_id: app for app in self.apps}
        self.active_app: Optional[App] = None
        self._dial_pressed_at: Optional[float] = None
        self._dial_exit_hold_active = False
        self._dial_exit_progress = 0.0
        self._dial_ignore_release = False
        self._power_off_hold_active = False
        self._spotify_widget_auto_opened = False
        self._previous_widget_index: Optional[int] = None
        self._power_off_progress = 0.0
        self._power_off_pressed_at: Optional[float] = None
        self._restart_hold_active = False
        self._restart_progress = 0.0
        self._restart_pressed_at: Optional[float] = None
        self._last_update_time: Optional[float] = None
        self.widgets: List[Widget] = [
            TimeWidget(),
            WeatherWidget(),
            ClickCounterWidget(),
            TimerWidget(),
            MotionStatusWidget(self.motion_manager),
            VersionStatusWidget(),
            PhotoWidget(),
            *[AppLauncherWidget(app) for app in self.apps],
        ]
        self.spotify_app: Optional[SpotifyApp] = next((app for app in self.apps if isinstance(app, SpotifyApp)), None)
        self.timer_widget: Optional[TimerWidget] = next((widget for widget in self.widgets if isinstance(widget, TimerWidget)), None)
        self.current_widget_index = 0
        self._last_interaction_time = time.time()

        self.button1_last_press = 0.0
        self.button2_last_press = 0.0
        self.button_cooldown = 0.1

        self._lock = threading.Lock()
        
        self._state_dirty = False
        self._last_save_time = 0.0
        self.load_widget_state()

    def mark_state_dirty(self) -> None:
        self._state_dirty = True

    def load_widget_state(self) -> None:
        try:
            path = BASE_DIR / "widget_state.json"
            if path.exists():
                state = json.loads(path.read_text())
                for widget in self.widgets:
                    if widget.widget_id in state:
                        widget.set_state(state[widget.widget_id])
                if "current_widget_index" in state:
                    idx = int(state["current_widget_index"])
                    if 0 <= idx < len(self.widgets):
                        self.current_widget_index = idx
        except Exception as exc:
            print(f"Error loading widget state: {exc}")

    def save_widget_state(self) -> None:
        try:
            path = BASE_DIR / "widget_state.json"
            tmp_path = path.with_suffix('.tmp')
            state = {widget.widget_id: widget.get_state() for widget in self.widgets}
            state["current_widget_index"] = self.current_widget_index
            tmp_path.write_text(json.dumps(state))
            tmp_path.replace(path)
        except Exception as exc:
            print(f"Error saving widget state: {exc}")

    def start(self) -> None:
        self.motion_manager.start_monitoring()

    def stop(self) -> None:
        self.motion_manager.stop_monitoring()

    def update_widgets(self) -> None:
        now = time.time()
        dt = 0.1
        if self._last_update_time is not None:
            dt = max(0.0, now - self._last_update_time)
        self._last_update_time = now
        with self._lock:
            for widget in self.widgets:
                widget.update(now)
            if self.active_app is not None:
                self.active_app.update(now, dt)
                self._update_exit_hold_locked(now, dt)
                if isinstance(self.active_app, SpotifyApp) and not self.active_app.is_playing:
                    idle_time = now - max(getattr(self.active_app, "_playback_stopped_time", 0), getattr(self.active_app, "_last_user_action_time", 0))
                    if idle_time > 300.0:
                        self._exit_app_locked(ignore_release=False)
                        time_widget_index = next((idx for idx, w in enumerate(self.widgets) if isinstance(w, TimeWidget)), 0)
                        self.current_widget_index = time_widget_index
            else:
                if self.spotify_app is not None:
                    self.spotify_app.update_background(now, dt)
                    if self.spotify_app.consume_playback_started_event() and self._should_auto_switch_to_spotify_locked(now):
                        spotify_widget_index = self._find_spotify_widget_index_locked()
                        if spotify_widget_index is not None and self.current_widget_index != spotify_widget_index:
                            self._previous_widget_index = self.current_widget_index
                            self.current_widget_index = spotify_widget_index
                            self._spotify_widget_auto_opened = True
                    stopped = self.spotify_app.consume_playback_stopped_event()
                    if stopped and self._spotify_widget_auto_opened:
                        if self._previous_widget_index is not None:
                            self.current_widget_index = self._previous_widget_index
                        self._spotify_widget_auto_opened = False
                self._dial_exit_progress = 0.0
                self._dial_exit_hold_active = False
            self._update_power_off_locked(now, dt)
            self._update_restart_locked(now, dt)
            
            self._check_auto_update(now)

            if self._state_dirty and now - self._last_save_time > 2.0:
                self.save_widget_state()
                self._state_dirty = False
                self._last_save_time = now

    def _check_auto_update(self, now: float) -> None:
        if getattr(self, "_last_auto_update_check", 0) + 60 > now:
            return
        self._last_auto_update_check = now

        now_dt = datetime.now()
        is_night = 1 <= now_dt.hour < 5
        if not is_night:
            return

        status = self.motion_manager.get_status()
        if status["seconds_since_activity"] < 3600:
            return

        version_widget = next((w for w in self.widgets if isinstance(w, VersionStatusWidget)), None)
        if not version_widget:
            return
            
        payload = version_widget.to_payload()
        if payload.get("remote_newer"):
            print("Auto-update conditions met (night time, idle > 1h, update available). Restarting quietly.")
            self._execute_update_software(quiet=True)

    def _find_spotify_widget_index_locked(self) -> Optional[int]:
        for idx, widget in enumerate(self.widgets):
            if isinstance(widget, AppLauncherWidget) and widget.app_id == "spotify":
                return idx
        return None

    def _should_auto_switch_to_spotify_locked(self, now: float) -> bool:
        if self.active_app is not None:
            return False
        if self.timer_widget is not None and self.timer_widget.running:
            return False
        if now - self._last_interaction_time < SPOTIFY_AUTO_SWITCH_IDLE_SECONDS:
            return False
        return True

    def _record_user_interaction(self) -> None:
        with self._lock:
            self._last_interaction_time = time.time()
            self._spotify_widget_auto_opened = False

    def next_widget(self) -> None:
        if self.active_app is not None:
            self.motion_manager.report_user_activity()
            return
        with self._lock:
            self.current_widget_index = (self.current_widget_index + 1) % len(self.widgets)
            current = self.widgets[self.current_widget_index]
            print(f"Switched to widget: {current.name}")
            self.mark_state_dirty()
        self.motion_manager.report_user_activity()

    def previous_widget(self) -> None:
        if self.active_app is not None:
            self.motion_manager.report_user_activity()
            return
        with self._lock:
            self.current_widget_index = (self.current_widget_index - 1) % len(self.widgets)
            current = self.widgets[self.current_widget_index]
            print(f"Switched to widget: {current.name}")
            self.mark_state_dirty()
        self.motion_manager.report_user_activity()

    def dial_rotate(self, delta: int) -> None:
        self._record_user_interaction()
        with self._lock:
            if self.active_app is not None:
                self.active_app.on_encoder(delta)
                app_mode = True
            else:
                app_mode = False
        if app_mode:
            self.motion_manager.report_user_activity()
            return
        if delta > 0:
            self.next_widget()
        else:
            self.previous_widget()

    def dial_rotate_clockwise(self) -> None:
        self.dial_rotate(1)

    def dial_rotate_counterclockwise(self) -> None:
        self.dial_rotate(-1)

    def dial_press_short(self) -> None:
        self._record_user_interaction()
        with self._lock:
            if self.active_app is not None:
                self.active_app.on_dial_press()
                self.motion_manager.report_user_activity()
                return
            self._handle_short_press_locked()
        self.motion_manager.report_user_activity()

    def dial_press_start(self) -> None:
        self._record_user_interaction()
        with self._lock:
            self._dial_pressed_at = time.time()
            self._dial_ignore_release = False
            if self.active_app is not None:
                self._dial_exit_hold_active = True
        self.motion_manager.report_user_activity()

    def dial_press_end(self) -> None:
        self._record_user_interaction()
        now = time.time()
        with self._lock:
            if self._dial_ignore_release:
                self._dial_ignore_release = False
                self._dial_pressed_at = None
                self._dial_exit_hold_active = False
                return
            start = self._dial_pressed_at
            if start is None:
                return
            self._dial_pressed_at = None
            duration = now - start if start is not None else 0.0
            if self.active_app is not None:
                self._dial_exit_hold_active = False
                if duration < 0.5:
                    self.active_app.on_dial_press()
                return
            if duration >= DIAL_HOLD_WIDGET_SECONDS:
                current = self.widgets[self.current_widget_index]
                current.on_button_hold_start()
            else:
                self._handle_short_press_locked()
        self.motion_manager.report_user_activity()

    def main_button_press(self) -> None:
        self.dial_press_short()

    def main_button_hold(self) -> None:
        if self.active_app is not None:
            return
        self._execute_dial_hold_locked()

    def _execute_dial_hold_locked(self) -> None:
        current = self.widgets[self.current_widget_index]
        current.on_button_hold_start()
        self.mark_state_dirty()
        self.motion_manager.report_user_activity()

    def launch_app(self, app_id: str) -> None:
        self._record_user_interaction()
        with self._lock:
            self._launch_app_locked(app_id)
        self.motion_manager.report_user_activity()

    def exit_app(self) -> None:
        self._record_user_interaction()
        with self._lock:
            self._exit_app_locked(ignore_release=False)
        self.motion_manager.report_user_activity()

    def _launch_app_locked(self, app_id: str) -> None:
        app = self._app_by_id.get(app_id)
        if app is None:
            return
        self.active_app = app
        app.reset()
        self._dial_exit_progress = 0.0
        self._dial_exit_hold_active = False
        self._dial_pressed_at = None
        self._dial_ignore_release = False
        print(f"Launched app: {app.name}")

    def _exit_app_locked(self, ignore_release: bool) -> None:
        if self.active_app is None:
            return
        print(f"Exiting app: {self.active_app.name}")
        self.active_app = None
        self._dial_exit_progress = 0.0
        self._dial_exit_hold_active = False
        self._dial_pressed_at = None
        if ignore_release:
            self._dial_ignore_release = True

    def _handle_short_press_locked(self) -> None:
        current = self.widgets[self.current_widget_index]
        if isinstance(current, AppLauncherWidget):
            self._launch_app_locked(current.app_id)
            return
        if current.should_process_button_press():
            current.on_button_press()
            self.mark_state_dirty()

    def _update_exit_hold_locked(self, now: float, dt: float) -> None:
        if self.active_app is None:
            self._dial_exit_progress = 0.0
            self._dial_exit_hold_active = False
            return
        if self._dial_exit_hold_active and self._dial_pressed_at is not None:
            progress = (now - self._dial_pressed_at) / max(DIAL_HOLD_EXIT_SECONDS, 0.01)
            self._dial_exit_progress = min(1.0, max(0.0, progress))
            if self._dial_exit_progress >= 1.0:
                self._exit_app_locked(ignore_release=True)
            return
        if self._dial_exit_progress > 0.0:
            decay = dt / max(DIAL_EXIT_UNFILL_SECONDS, 0.01)
            self._dial_exit_progress = max(0.0, self._dial_exit_progress - decay)

    def _update_power_off_locked(self, now: float, dt: float) -> None:
        if self._power_off_hold_active and self._power_off_pressed_at is not None:
            progress = (now - self._power_off_pressed_at) / max(5.0, 0.01)
            self._power_off_progress = min(1.0, max(0.0, progress))
            if self._power_off_progress >= 1.0:
                self._execute_power_off_locked()
            return
        
        if self._power_off_progress > 0.0:
            decay = dt / max(0.5, 0.01)
            self._power_off_progress = max(0.0, self._power_off_progress - decay)

    def _execute_power_off_locked(self) -> None:
        self._power_off_hold_active = False
        self.save_widget_state()
        if ALLOW_SYSTEM_POWER_OFF:
            print("Button2 held for power-off. Shutting down system.")
            os.system("sudo shutdown -h now")
        else:
            print("Button2 held, but power-off is disabled (set DASH_ALLOW_POWEROFF=1 to enable).")

    def _update_restart_locked(self, now: float, dt: float) -> None:
        if self._restart_hold_active and self._restart_pressed_at is not None:
            progress = (now - self._restart_pressed_at) / max(5.0, 0.01)
            self._restart_progress = min(1.0, max(0.0, progress))
            if self._restart_progress >= 1.0:
                self._execute_restart_locked()
            return
        
        if self._restart_progress > 0.0:
            decay = dt / max(0.5, 0.01)
            self._restart_progress = max(0.0, self._restart_progress - decay)

    def _execute_restart_locked(self) -> None:
        self._restart_hold_active = False
        self.save_widget_state()
        if ALLOW_SYSTEM_POWER_OFF:
            print("Button1 held for restart. Rebooting system.")
            os.system("sudo reboot")
        else:
            print("Button1 held, but restart is disabled (set DASH_ALLOW_POWEROFF=1 to enable).")

    def _execute_update_software(self, quiet: bool = False) -> None:
        print("Update Software requested. Restarting dash.py to fetch updates...")
        if quiet:
            os.environ["DASH_QUIET_UPDATE"] = "1"
        else:
            os.environ.pop("DASH_QUIET_UPDATE", None)
        dash_script = Path(__file__).resolve().parent / "dash.py"
        os.execv(sys.executable, [sys.executable, str(dash_script)] + sys.argv[1:])

    def button1_press_start(self) -> None:
        with self._lock:
            if self.active_app is None:
                self._restart_pressed_at = time.time()
                self._restart_hold_active = True
        self.button1_press()

    def button1_press_end(self) -> None:
        with self._lock:
            self._restart_hold_active = False
            self._restart_pressed_at = None

    def button1_press(self) -> None:
        self._record_user_interaction()
        if self.active_app is not None:
            self.active_app.on_button1()
            self.motion_manager.report_user_activity()
            return
        now = time.time()
        if now - self.button1_last_press < self.button_cooldown:
            return
        self.button1_last_press = now

        with self._lock:
            current = self.widgets[self.current_widget_index]
            if hasattr(current, "add_minute"):
                current.add_minute()  # type: ignore
                self.mark_state_dirty()
        self.motion_manager.report_user_activity()

    def button2_press_start(self) -> None:
        with self._lock:
            if self.active_app is None:
                self._power_off_pressed_at = time.time()
                self._power_off_hold_active = True
        self.button2_press()

    def button2_press_end(self) -> None:
        with self._lock:
            self._power_off_hold_active = False
            self._power_off_pressed_at = None

    def button2_press(self) -> None:
        self._record_user_interaction()
        if self.active_app is not None:
            self.active_app.on_button2()
            self.motion_manager.report_user_activity()
            return
        now = time.time()
        if now - self.button2_last_press < self.button_cooldown:
            return
        self.button2_last_press = now

        with self._lock:
            current = self.widgets[self.current_widget_index]
            if hasattr(current, "subtract_minute"):
                current.subtract_minute()  # type: ignore
                self.mark_state_dirty()
        self.motion_manager.report_user_activity()

    def simulate_motion(self) -> None:
        self.motion_manager.report_user_activity(motion=True)

    def register_activity(self) -> None:
        self._record_user_interaction()
        self.motion_manager.report_user_activity()

    def snapshot(self) -> Dict[str, Any]:
        with self._lock:
            active_widget = self.widgets[self.current_widget_index]
            widget_tabs = [
                {
                    "id": widget.widget_id,
                    "name": widget.name,
                    "active": idx == self.current_widget_index,
                    "kind": "app" if isinstance(widget, AppLauncherWidget) else "widget",
                }
                for idx, widget in enumerate(self.widgets)
            ]
            active_payload = active_widget.to_payload()
            active_app_payload = self.active_app.to_payload() if self.active_app is not None else None
            app_exit = {
                "progress": self._dial_exit_progress,
                "active": self._dial_exit_hold_active,
            }
            power_off = {
                "progress": self._power_off_progress,
                "active": self._power_off_hold_active,
            }
            restart = {
                "progress": self._restart_progress,
                "active": self._restart_hold_active,
            }

        motion = self.motion_manager.get_status()
        display_mode = "on"
        if motion["display_off"]:
            display_mode = "off"
        elif motion["display_dimmed"]:
            display_mode = "dim"

        return {
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "display_mode": display_mode,
            "mode": "app" if active_app_payload is not None else "widgets",
            "widgets": widget_tabs,
            "active_widget": active_payload,
            "active_app": active_app_payload,
            "app_exit": app_exit,
            "power_off": power_off,
            "restart": restart,
            "motion": motion,
        }


class HardwareControls:
    """Optional hardware bindings (rotary + buttons)."""

    def __init__(self, controller: DashboardController):
        self.controller = controller
        self.encoder_clk: Optional[Any] = None
        self.encoder_dt: Optional[Any] = None
        self.main_button: Optional[Any] = None
        self.button1: Optional[Any] = None
        self.button2: Optional[Any] = None

    def initialize(self) -> None:
        if not GPIOZERO_AVAILABLE:
            print("gpiozero not available; keyboard/web controls only.")
            return

        try:
            if RotaryEncoder is not None:
                self.encoder = RotaryEncoder(CLK_PIN, DT_PIN, max_steps=0)
                
                def _rotated_cw():
                    self.controller.dial_rotate_clockwise()
                    
                def _rotated_ccw():
                    self.controller.dial_rotate_counterclockwise()
                    
                self.encoder.when_rotated_clockwise = _rotated_cw
                self.encoder.when_rotated_counter_clockwise = _rotated_ccw
                print("Rotary encoder initialized using gpiozero.RotaryEncoder.")
            else:
                self.encoder_clk = Button(CLK_PIN, pull_up=True, bounce_time=0.01)
                self.encoder_dt = Button(DT_PIN, pull_up=True, bounce_time=0.01)

                def _enc_cb():
                    if not self.encoder_dt.is_active:
                        self.controller.dial_rotate_clockwise()
                    else:
                        self.controller.dial_rotate_counterclockwise()

                self.encoder_clk.when_pressed = _enc_cb
                print("Rotary encoder initialized (native bounce_time).")
        except Exception as exc:
            print(f"Failed to initialize rotary encoder: {exc}")

        try:
            self.main_button = Button(SW_PIN, hold_time=DIAL_HOLD_EXIT_SECONDS, hold_repeat=False)
            self.main_button.when_pressed = self.controller.dial_press_start
            self.main_button.when_released = self.controller.dial_press_end
            print("Main button initialized.")
        except Exception as exc:
            print(f"Failed to initialize main button: {exc}")

        try:
            self.button1 = Button(BUTTON1_PIN)
            self.button1.when_pressed = self.controller.button1_press_start
            self.button1.when_released = self.controller.button1_press_end
            print("Button1 initialized.")
        except Exception as exc:
            print(f"Failed to initialize button1: {exc}")

        try:
            self.button2 = Button(BUTTON2_PIN)
            self.button2.when_pressed = self.controller.button2_press_start
            self.button2.when_released = self.controller.button2_press_end
            print("Button2 initialized.")
        except Exception as exc:
            print(f"Failed to initialize button2: {exc}")

    def cleanup(self) -> None:
        for device in [self.encoder_clk, self.encoder_dt, self.main_button, self.button1, self.button2]:
            if device is None:
                continue
            try:
                device.close()
            except Exception:
                pass


def _escape_html(s: str) -> str:
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _format_duration_ms(value_ms: Any) -> str:
    try:
        total_seconds = max(0, int((value_ms or 0) // 1000))
    except Exception:
        total_seconds = 0
    minutes, seconds = divmod(total_seconds, 60)
    hours, minutes = divmod(minutes, 60)
    if hours > 0:
        return f"{hours:d}:{minutes:02d}:{seconds:02d}"
    return f"{minutes:02d}:{seconds:02d}"


def _render_oled_widget_html(state: Dict[str, Any]) -> str:
    """Server-side render of active widget/app HTML (mirrors oled.html render functions)."""
    mode = (state.get("mode") or "widgets").lower()
    if mode == "app":
        app = state.get("active_app") or {}
        app_type = (app.get("type") or "").lower()
        if app_type == "pong":
            field = app.get("field") or {}
            width = float(field.get("width") or 128)
            height = float(field.get("height") or 64)
            ball = app.get("ball") or {}
            player = app.get("player") or {}
            cpu = app.get("cpu") or {}
            score = app.get("score") or {}
            exit_state = state.get("app_exit") or {}
            exit_progress = float(exit_state.get("progress") or 0.0)

            def _pct(val: float, total: float) -> str:
                if total <= 0:
                    return "0%"
                return f"{(val / total) * 100:.2f}%"

            ball_x = float(ball.get("x") or 0)
            ball_y = float(ball.get("y") or 0)
            ball_size = float(ball.get("size") or 2)
            player_x = float(player.get("x") or 0)
            player_y = float(player.get("y") or 0)
            player_w = float(player.get("width") or 2)
            player_h = float(player.get("height") or 12)
            cpu_x = float(cpu.get("x") or 0)
            cpu_y = float(cpu.get("y") or 0)
            cpu_w = float(cpu.get("width") or 2)
            cpu_h = float(cpu.get("height") or 12)
            score_player = _escape_html(str(score.get("player") or 0))
            score_cpu = _escape_html(str(score.get("cpu") or 0))
            return (
                '<section class="app-pong">'
                f'<div class="pong-score">{score_player} : {score_cpu}</div>'
                f'<div class="pong-field" style="--exit-progress:{exit_progress:.3f};">'
                '<div class="pong-divider"></div>'
                f'<div class="pong-paddle player" style="left:{_pct(player_x, width)}; top:{_pct(player_y, height)}; width:{_pct(player_w, width)}; height:{_pct(player_h, height)};"></div>'
                f'<div class="pong-paddle cpu" style="left:{_pct(cpu_x, width)}; top:{_pct(cpu_y, height)}; width:{_pct(cpu_w, width)}; height:{_pct(cpu_h, height)};"></div>'
                f'<div class="pong-ball" style="left:{_pct(ball_x, width)}; top:{_pct(ball_y, height)}; width:{_pct(ball_size, width)}; height:{_pct(ball_size, height)};"></div>'
                '<div class="pong-exit"></div>'
                '</div>'
                '</section>'
            )

        if app_type == "spotify":
            track_name = _escape_html(str(app.get("track_name") or "Waiting for track..."))
            artist_name = _escape_html(str(app.get("artist_name") or ""))
            is_playing = "Playing" if app.get("is_playing") else "Paused"
            progress = float(app.get("progress_ms") or 0)
            duration = float(app.get("duration_ms") or 1)
            pct = min(100.0, max(0.0, (progress / duration) * 100))
            progress_text = _escape_html(str(app.get("progress_text") or _format_duration_ms(progress)))
            duration_text = _escape_html(str(app.get("duration_text") or _format_duration_ms(duration)))
            exit_state = state.get("app_exit") or {}
            exit_progress = float(exit_state.get("progress") or 0.0)
            
            time_str = datetime.now().strftime("%I:%M %p").lstrip("0")
            
            return (
                '<section class="app-spotify" style="position:absolute; top:0; left:0; width:100%; height:100%; display:flex; flex-direction:column; align-items:flex-start; justify-content:center; text-align:left; padding-left:4px; box-sizing:border-box;">'
                f'<div style="position:absolute; right:4px; top:4px; text-align:right;">'
                f'<div style="font-size:0.58rem; text-align:right;">{time_str}</div>'
                f'</div>'
                f'<div style="width:calc(100% - 35px); overflow:hidden; text-align:left;">'
                f'<h2 class="{"marquee-container" if len(track_name) > 13 else ""}" style="--marquee-width:calc(100% - 35px); margin:0; font-size:1.0rem; white-space:nowrap; text-align:left;">{track_name}</h2>'
                f'</div>'
                f'<div style="width:100%; overflow:hidden; text-align:left;">'
                f'<p class="{"marquee-container" if len(artist_name) > 22 else ""}" style="--marquee-width:100%; margin:0.2rem 0; font-size:0.75rem; white-space:nowrap; text-align:left;">{artist_name}</p>'
                f'</div>'
                f'<div style="display:flex; justify-content:space-between; align-items:center; width:100%; margin-top:0.2rem;">'
                f'<p style="margin:0; font-size:0.65rem; text-align:left;">{is_playing}</p>'
                f'<div style="font-size:0.5rem; color:#ccc; margin-right:4px;">{progress_text} / {duration_text}</div>'
                f'</div>'
                f'<div style="position:absolute; left:0; bottom:0; width:100%; height:6px; background:rgba(255,255,255,0.2); border-radius:6px 6px 0 0;">'
                f'<div style="width:{pct}%; height:100%; background:#fff; border-radius:6px 6px 0 0;"></div></div>'
                f'<div class="pong-exit" style="height:{exit_progress * 100}%"></div>'
                '</section>'
            )

        return '<section class="widget-time"><div class="time-main">APP</div></section>'

    w = state.get("active_widget") or {}
    wtype = (w.get("type") or "").lower()
    if wtype == "time":
        time_main = _escape_html(str(w.get("time_main") or "--:--"))
        seconds = _escape_html(str(w.get("seconds") or "--"))
        day = w.get("day")
        day_str = str(day) if day is not None else "-"
        month = _escape_html(str(w.get("month") or "---"))
        return (
            f'<section class="widget-time"><div class="time-main">'
            f"{time_main}<span class=\"seconds\">:{seconds}</span></div>"
            f'<div class="time-date"><span class="day">{_escape_html(day_str)}</span> <span class="month">{month}</span></div></section>'
        )
    if wtype == "click_counter":
        count = w.get("count", 0)
        return f'<section class="widget-counter"><div class="counter-number">{_escape_html(str(count))}</div></section>'
    if wtype == "timer":
        flash = " flash" if w.get("flash") else ""
        running = "Run" if w.get("running") else "Stop"
        time_text = _escape_html(str(w.get("time_text") or "05:00"))
        return (
            f'<section class="widget-timer{flash}"><div class="timer-badges">{_escape_html(running)}</div>'
            f'<div class="timer-value">{time_text}</div></section>'
        )
    if wtype == "motion_status":
        motion_yes = "Yes" if w.get("motion_detected") else "No"
        display_state = _escape_html(str(w.get("display_state") or "ON"))
        idle = _escape_html(str(w.get("idle") or "00:00"))
        return (
            f'<section class="widget-motion"><div class="status-grid">'
            f'<div class="status-tile"><div class="status-label">Motion</div><div class="status-value">{motion_yes}</div></div>'
            f'<div class="status-tile"><div class="status-label">Display</div><div class="status-value">{display_state}</div></div>'
            f'<div class="status-tile"><div class="status-label">Idle</div><div class="status-value">{idle}</div></div></div></section>'
        )
    if wtype == "weather":
        if w.get("needs_location"):
            return '<section class="widget-weather"><div class="weather-temp">SET LOCATION</div></section>'
        if w.get("error") and not w.get("temperature_f"):
            return '<section class="widget-weather"><div class="weather-temp">WEATHER ERROR</div></section>'
        location = _escape_html(str(w.get("location") or w.get("location_query") or "Weather"))
        temp_val = w.get("temperature_f")
        temp_text = "--°F"
        if isinstance(temp_val, (int, float)):
            temp_text = f"{round(temp_val)}°F"
        condition = _escape_html(str(w.get("condition") or ""))
        return (
            '<section class="widget-weather">'
            f'<div class="weather-location">{location}</div>'
            f'<div class="weather-temp">{temp_text}</div>'
            f'<div class="weather-meta">{condition}</div>'
            '</section>'
        )
    if wtype == "version_status":
        local = _escape_html(str(w.get("local") or "unknown"))
        remote = _escape_html(str(w.get("remote") or "n/a"))
        status = _escape_html(str(w.get("status") or "unknown"))
        branch = _escape_html(str(w.get("branch") or ""))
        return (
            f'<section class="widget-motion"><div class="status-grid">'
            f'<div class="status-tile"><div class="status-label">Local</div><div class="status-value">{local}</div></div>'
            f'<div class="status-tile"><div class="status-label">Remote</div><div class="status-value">{remote}</div></div>'
            f'<div class="status-tile"><div class="status-label">Status</div><div class="status-value">{status}</div></div>'
            f'<div class="status-tile"><div class="status-label">Branch</div><div class="status-value">{branch}</div></div></div></section>'
        )
    if wtype == "photo":
        image_b64 = w.get("image_base64")
        if image_b64:
            return (
                '<section class="widget-photo">'
                f'<img src="data:image/png;base64,{image_b64}" alt="BW Photo" style="max-width:128px;max-height:64px;" />'
                '</section>'
            )
        return '<section class="widget-photo"><div class="photo-placeholder">No photo</div></section>'
    if wtype == "app_launcher":
        app_name = _escape_html(str(w.get("app_name") or w.get("name") or "APP"))
        if str(w.get("preview_type") or "") == "spotify":
            preview = w.get("preview") or {}
            track_name = _escape_html(str(preview.get("track_name") or "Waiting for track..."))
            artist_name = _escape_html(str(preview.get("artist_name") or ""))
            authenticated = bool(preview.get("authenticated"))
            status_text = "Connect in web UI" if not authenticated else "PRESS DIAL TO OPEN"
            
            time_str = datetime.now().strftime("%I:%M %p").lstrip("0")
            
            return (
                '<section class="app-spotify" style="position:absolute; top:0; left:0; width:100%; height:100%; display:flex; flex-direction:column; align-items:flex-start; justify-content:center; text-align:left; padding-left:4px; box-sizing:border-box;">'
                f'<div style="position:absolute; right:4px; top:4px; text-align:right;">'
                f'<div style="font-size:0.58rem; text-align:right;">{time_str}</div>'
                f'</div>'
                f'<div style="width:calc(100% - 35px); overflow:hidden; text-align:left;">'
                f'<h2 class="{"marquee-container" if len(track_name) > 13 else ""}" style="--marquee-width:calc(100% - 35px); margin:0; font-size:1.0rem; white-space:nowrap; text-align:left;">{track_name}</h2>'
                f'</div>'
                f'<div style="width:100%; overflow:hidden; text-align:left;">'
                f'<p class="{"marquee-container" if len(artist_name) > 22 else ""}" style="--marquee-width:100%; margin:0.2rem 0; font-size:0.75rem; white-space:nowrap; text-align:left;">{artist_name}</p>'
                f'</div>'
                f'<p style="margin-top:0.35rem; font-size:0.62rem; text-align:left;">{_escape_html(status_text)}</p>'
                '</section>'
            )
        return (
            '<section class="widget-counter">'
            f'<div style="font-size:9px;text-align:center;line-height:1.2;">{app_name}<br/>PRESS DIAL</div>'
            '</section>'
        )
    return '<section class="widget-time"><div class="time-main">?</div></section>'


class DashRequestHandler(BaseHTTPRequestHandler):
    controller: DashboardController
    static_root: Path

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path

        if path in {"/", "/index.html"}:
            self._serve_file("index.html", "text/html; charset=utf-8")
            return
        if path == "/oled":
            self._serve_oled_page()
            return
        if path == "/oled.css":
            self._serve_file("oled.css", "text/css; charset=utf-8")
            return
        if path == "/styles.css":
            self._serve_file("styles.css", "text/css; charset=utf-8")
            return
        if path == "/app.js":
            self._serve_file("app.js", "application/javascript; charset=utf-8")
            return
        if path == "/api/state":
            self._send_json(self.controller.snapshot())
            return

        if path == "/api/spotify/status":
            client = self.controller.spotify_client
            self._send_json({
                "configured": client.is_configured(),
                "authenticated": client.is_authenticated()
            })
            return

        if path == "/api/spotify/callback":
            from urllib.parse import parse_qs
            query = parse_qs(parsed.query)
            code = query.get("code", [""])[0]
            if code:
                client = self.controller.spotify_client
                redirect_uri = client.redirect_uri
                if not redirect_uri:
                    host = self.headers.get("Host", "localhost:8080")
                    scheme = self.headers.get("X-Forwarded-Proto", "http")
                    redirect_uri = f"{scheme}://{host}/api/spotify/callback"
                client.exchange_code(code, redirect_uri)
            self.send_response(HTTPStatus.FOUND)
            self.send_header("Location", "/")
            self.end_headers()
            return

        if path == "/favicon.ico":
            # Avoid noisy 404s in browsers; fall back to the logo if present.
            if self._try_serve_static("favicon.ico"):
                return
            if self._try_serve_static("logo.png"):
                return
            self.send_response(HTTPStatus.NO_CONTENT)
            self.end_headers()
            return

        static_rel = path.lstrip("/")
        if static_rel and self._try_serve_static(static_rel):
            return

        self._send_json({"error": "Not found"}, status=HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)

        if parsed.path == "/api/photo/upload":
            self._handle_photo_upload()
            self.controller.mark_state_dirty()
            return

        if parsed.path == "/api/weather/location":
            self._handle_weather_location()
            self.controller.mark_state_dirty()
            return

        if parsed.path == "/api/spotify/config":
            body = self._read_json_body()
            if body is None:
                self._send_json({"error": "Invalid JSON body"}, status=HTTPStatus.BAD_REQUEST)
                return
            client_id = body.get("client_id")
            client_secret = body.get("client_secret")
            override_uri = body.get("redirect_uri")
            if not client_id or not client_secret:
                self._send_json({"error": "Missing client_id or client_secret"}, status=HTTPStatus.BAD_REQUEST)
                return
            
            if override_uri:
                redirect_uri = override_uri
            else:
                host = self.headers.get("Host", "localhost:8080")
                scheme = self.headers.get("X-Forwarded-Proto", "http")
                redirect_uri = f"{scheme}://{host}/api/spotify/callback"
                
            self.controller.spotify_client.save_config(client_id, client_secret, redirect_uri=redirect_uri)
            auth_url = self.controller.spotify_client.get_auth_url(redirect_uri)
            self._send_json({"auth_url": auth_url})
            return

        if parsed.path != "/api/action":
            self._send_json({"error": "Not found"}, status=HTTPStatus.NOT_FOUND)
            return

        body = self._read_json_body()
        if body is None:
            self._send_json({"error": "Invalid JSON body"}, status=HTTPStatus.BAD_REQUEST)
            return

        action = str(body.get("action", "")).strip().lower()
        if not self._dispatch_action(action):
            self._send_json({"error": f"Unsupported action: {action}"}, status=HTTPStatus.BAD_REQUEST)
            return

        self._send_json(self.controller.snapshot())

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def log_message(self, format_string: str, *args: Any) -> None:
        print(f"[HTTP] {self.address_string()} - {format_string % args}")

    def _dispatch_action(self, action: str) -> bool:
        actions = {
            "next": self.controller.next_widget,
            "previous": self.controller.previous_widget,
            "prev": self.controller.previous_widget,
            "press": self.controller.dial_press_short,
            "hold": self.controller.main_button_hold,
            "dial_hold_start": self.controller.dial_press_start,
            "dial_hold_end": self.controller.dial_press_end,
            "add_minute": self.controller.button1_press,
            "subtract_minute": self.controller.button2_press,
            "activity": self.controller.register_activity,
            "simulate_motion": self.controller.simulate_motion,
            "shutdown": self.controller._execute_power_off_locked,
            "restart": self.controller._execute_restart_locked,
            "update_software": self.controller._execute_update_software,
        }

        handler = actions.get(action)
        if handler is None:
            return False

        handler()
        return True

    def _handle_photo_upload(self) -> None:
        """Accept a base64-encoded image, convert to BW via the PhotoWidget, return status."""
        body = self._read_json_body()
        if body is None:
            self._send_json({"error": "Invalid JSON body"}, status=HTTPStatus.BAD_REQUEST)
            return

        image_b64 = body.get("image")
        if not image_b64 or not isinstance(image_b64, str):
            self._send_json({"error": "Missing 'image' field (base64)"}, status=HTTPStatus.BAD_REQUEST)
            return

        # Strip optional data-URI prefix (e.g. "data:image/png;base64,...")
        if "," in image_b64:
            image_b64 = image_b64.split(",", 1)[1]

        try:
            raw_bytes = base64.b64decode(image_b64)
        except Exception:
            self._send_json({"error": "Invalid base64 data"}, status=HTTPStatus.BAD_REQUEST)
            return

        photo_widget: Optional[PhotoWidget] = None
        with self.controller._lock:
            for w in self.controller.widgets:
                if isinstance(w, PhotoWidget):
                    photo_widget = w
                    break

        if photo_widget is None:
            self._send_json({"error": "Photo widget not found"}, status=HTTPStatus.INTERNAL_SERVER_ERROR)
            return

        err = photo_widget.set_image(raw_bytes)
        if err:
            self._send_json({"error": err}, status=HTTPStatus.BAD_REQUEST)
            return

        self._send_json({"ok": True})

    def _handle_weather_location(self) -> None:
        """Accept a user-entered location string and update the WeatherWidget."""
        body = self._read_json_body()
        if body is None:
            self._send_json({"error": "Invalid JSON body"}, status=HTTPStatus.BAD_REQUEST)
            return

        location = body.get("location")
        if location is None:
            location = body.get("query")
        if not isinstance(location, str):
            self._send_json({"error": "Missing 'location' field"}, status=HTTPStatus.BAD_REQUEST)
            return

        weather_widget: Optional[WeatherWidget] = None
        with self.controller._lock:
            for w in self.controller.widgets:
                if isinstance(w, WeatherWidget):
                    weather_widget = w
                    break

            if weather_widget is None:
                self._send_json(
                    {"error": "Weather widget not found"},
                    status=HTTPStatus.INTERNAL_SERVER_ERROR,
                )
                return

            err = weather_widget.set_location(location)

        if err:
            self._send_json({"error": err}, status=HTTPStatus.BAD_REQUEST)
            return

        self._send_json(self.controller.snapshot())

    def _serve_oled_page(self) -> None:
        """Serve oled.html with widget HTML pre-rendered so wkhtmltoimage gets correct content without waiting for JS."""
        path = self.static_root / "oled.html"
        if not path.exists():
            self._send_json(
                {"error": "Missing oled.html"},
                status=HTTPStatus.INTERNAL_SERVER_ERROR,
            )
            return
        try:
            body = path.read_text(encoding="utf-8")
        except Exception:
            self._send_json(
                {"error": "Could not read oled.html"},
                status=HTTPStatus.INTERNAL_SERVER_ERROR,
            )
            return
        state = self.controller.snapshot()
        widget_html = _render_oled_widget_html(state)
        power_off_raw = float((state.get("power_off") or {}).get("progress") or 0.0)
        if power_off_raw > 0:
            widget_html += f'<div class="power-off-exit" style="--power-off-progress:{max(0.0, min(1.0, power_off_raw)):.3f};"></div>'
        state_json = json.dumps(state).replace("</script>", "<\\/script>")
        body = body.replace("{{WIDGET_HTML}}", widget_html)
        body = body.replace("{{INITIAL_STATE}}", state_json)
        payload = body.encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def _serve_file(self, filename: str, content_type: str) -> None:
        path = self.static_root / filename
        if not path.exists():
            self._send_json(
                {"error": f"Missing frontend file: {filename}"},
                status=HTTPStatus.INTERNAL_SERVER_ERROR,
            )
            return

        payload = path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def _try_serve_static(self, rel_path: str) -> bool:
        """
        Serve any file that exists in WEB_DIR, with basic extension-based content types.
        Prevents directory traversal and avoids hardcoding every new asset route.
        """
        try:
            rel = Path(rel_path)
        except Exception:
            return False
        if rel.is_absolute() or ".." in rel.parts:
            return False

        file_path = (self.static_root / rel).resolve()
        try:
            static_root = self.static_root.resolve()
        except Exception:
            static_root = self.static_root
        if static_root not in file_path.parents and file_path != static_root:
            return False
        if not file_path.exists() or not file_path.is_file():
            return False

        suffix = file_path.suffix.lower()
        content_type = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".gif": "image/gif",
            ".svg": "image/svg+xml",
            ".ico": "image/x-icon",
            ".ttf": "font/ttf",
            ".otf": "font/otf",
            ".woff": "font/woff",
            ".woff2": "font/woff2",
            ".json": "application/json; charset=utf-8",
            ".txt": "text/plain; charset=utf-8",
        }.get(suffix, "application/octet-stream")

        payload = file_path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)
        return True

    def _read_json_body(self) -> Optional[Dict[str, Any]]:
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return None

        raw = self.rfile.read(content_length)
        try:
            parsed = json.loads(raw.decode("utf-8"))
        except Exception:
            return None

        if isinstance(parsed, dict):
            return parsed
        return None

    def _send_json(self, data: Dict[str, Any], status: HTTPStatus = HTTPStatus.OK) -> None:
        payload = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(payload)


def widget_update_loop(controller: DashboardController, stop_event: threading.Event) -> None:
    while not stop_event.is_set():
        controller.update_widgets()
        time.sleep(0.1)


def _oled_render_image_from_state(state: Dict[str, Any]) -> Optional["Image.Image"]:
    """Render the current widget state into a 128x64 monochrome image (Pillow), styled like nanobackup.py widgets."""
    if not PIL_AVAILABLE or Image is None or ImageDraw is None or ImageFont is None:
        return None

    img = Image.new("1", (128, 64), 0)  # black background
    draw = ImageDraw.Draw(img)

    widget = state.get("active_widget") or {}
    wtype = str(widget.get("type") or "").lower()

    def _font(size: int) -> Any:
        from pathlib import Path
        custom_font_base = str(Path(__file__).parent / "leggie")
        
        # Pick closest leggie size (bitmap font only supports these)
        if size <= 12:
            leggie_size = 12
        elif size <= 18:
            leggie_size = 18
        else:
            leggie_size = 24
            
        leggie_path = f"{custom_font_base}-{leggie_size}.bdf"
        
        try:
            return ImageFont.truetype(leggie_path, leggie_size)
        except Exception:
            pass

        # Try DejaVuSans on Linux, then Arial on macOS, then default
        for path in (
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/System/Library/Fonts/Arial.ttf",
        ):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
        return ImageFont.load_default()

    def _text_size(text: str, font: Any) -> tuple[int, int]:
        # Pillow compat across versions (textsize deprecated in newer releases)
        try:
            left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
            return right - left, bottom - top
        except Exception:
            try:
                return draw.textsize(text, font=font)  # type: ignore[attr-defined]
            except Exception:
                return (len(text) * 6, 10)

    def _draw_hourglass(x: int, y: int) -> None:
        # Copied from nanobackup.py's TimerWidget styling
        draw.line((x + 2, y, x + 8, y), fill=1)
        draw.line((x + 3, y + 1, x + 7, y + 1), fill=1)
        draw.line((x + 4, y + 2, x + 6, y + 2), fill=1)
        draw.line((x + 5, y + 3, x + 5, y + 3), fill=1)
        draw.line((x + 5, y + 4, x + 5, y + 6), fill=1)
        draw.line((x + 5, y + 7, x + 5, y + 7), fill=1)
        draw.line((x + 4, y + 8, x + 6, y + 8), fill=1)
        draw.line((x + 3, y + 9, x + 7, y + 9), fill=1)
        draw.line((x + 2, y + 10, x + 8, y + 10), fill=1)

    def _draw_pause_icon(x: int, y: int) -> None:
        # Copied from nanobackup.py's TimerWidget styling
        draw.line((x, y, x, y + 8), fill=1)
        draw.line((x + 1, y, x + 1, y + 8), fill=1)
        draw.line((x + 4, y, x + 4, y + 8), fill=1)
        draw.line((x + 5, y, x + 5, y + 8), fill=1)

    mode = (state.get("mode") or "widgets").lower()
    if mode == "app":
        app = state.get("active_app") or {}
        app_type = str(app.get("type") or "").lower()
        if app_type == "pong":
            field = app.get("field") or {}
            width = int(field.get("width") or 128)
            height = int(field.get("height") or 64)
            ball = app.get("ball") or {}
            player = app.get("player") or {}
            cpu = app.get("cpu") or {}
            score = app.get("score") or {}
            exit_state = state.get("app_exit") or {}

            score_text = f"{score.get('player', 0)}:{score.get('cpu', 0)}"
            score_font = _font(10)
            score_w, _ = _text_size(score_text, score_font)
            draw.text((max((128 - score_w) // 2, 0), 0), score_text, fill=1, font=score_font)

            for y in range(0, 64, 4):
                draw.line((64, y, 64, min(y + 1, 63)), fill=1)

            px = int(player.get("x") or 0)
            py = int(player.get("y") or 0)
            pw = int(player.get("width") or 2)
            ph = int(player.get("height") or 12)
            cx = int(cpu.get("x") or (width - 4))
            cy = int(cpu.get("y") or 0)
            cw = int(cpu.get("width") or 2)
            ch = int(cpu.get("height") or 12)
            bx = int(ball.get("x") or 0)
            by = int(ball.get("y") or 0)
            bs = int(ball.get("size") or 2)

            draw.rectangle((px, py, px + pw - 1, py + ph - 1), fill=1)
            draw.rectangle((cx, cy, cx + cw - 1, cy + ch - 1), fill=1)
            draw.rectangle((bx, by, bx + bs - 1, by + bs - 1), fill=1)

            progress = float(exit_state.get("progress") or 0.0)
            if progress > 0.0:
                fill_height = int(64 * min(max(progress, 0.0), 1.0))
                if fill_height > 0:
                    draw.rectangle((0, 64 - fill_height, 127, 63), fill=1)

            return img

        if app_type == "spotify":
            track_name = str(app.get("track_name") or "Waiting for track...")
            artist_name = str(app.get("artist_name") or "")
            progress_text = str(app.get("progress_text") or _format_duration_ms(app.get("progress_ms")))
            duration_text = str(app.get("duration_text") or _format_duration_ms(app.get("duration_ms")))
            progress = float(app.get("progress_ms") or 0)
            duration = float(app.get("duration_ms") or 1)
            is_playing = bool(app.get("is_playing", False))
            pct = min(1.0, max(0.0, progress / duration))
            exit_state = state.get("app_exit") or {}
            
            track_font = _font(12)
            artist_font = _font(10)
            time_font = _font(10)
            
            def get_offset(text_w: int, max_w: int, speed: float = 25.0, pause: float = 3.0) -> int:
                if text_w <= max_w:
                    return 0
                sr = text_w - max_w + 10
                t_move = sr / speed
                cycle = 2 * t_move + 2 * pause
                p = time.time() % cycle
                if p < pause: return 0
                if p < pause + t_move: return int((p - pause) * speed)
                if p < 2 * pause + t_move: return int(sr)
                return int(sr - (p - 2 * pause - t_move) * speed)
                
            now = datetime.now()
            hour_12 = now.hour % 12 or 12
            sys_time = f"{hour_12}:{now.minute:02d}"
            sys_time_w, sys_time_h = _text_size(sys_time, track_font)
            time_x = 128 - sys_time_w - 2
            time_y = 5

            tw, _ = _text_size(track_name, track_font)
            track_max_w = time_x - 6
            tx = 2 - get_offset(tw, track_max_w)
            draw.text((tx, 5), track_name, fill=1, font=track_font, anchor="lt")
            
            aw, _ = _text_size(artist_name, artist_font)
            artist_max_w = 124
            ax = 2 - get_offset(aw, artist_max_w, speed=20.0)
            draw.text((ax, 22), artist_name, fill=1, font=artist_font)
            
            # Mask out the time area so track name doesn't overlap it when scrolling
            draw.rectangle((time_x - 4, 0, 127, time_y + sys_time_h + 2), fill=0)
            draw.text((time_x, time_y), sys_time, fill=1, font=track_font, anchor="lt")

            y_offset = 48
            radius = 6
            bar_height = 22
            
            mask = Image.new("1", (128, 64), 0)
            mask_draw = ImageDraw.Draw(mask)
            mask_draw.rounded_rectangle((0, y_offset, 127, y_offset + bar_height - 1), radius=radius, fill=1)

            fill_img = Image.new("1", (128, 64), 0)
            fill_draw = ImageDraw.Draw(fill_img)
            fill_w = int(128 * pct)
            if fill_w > 0:
                fill_draw.rectangle((0, y_offset, fill_w - 1, y_offset + bar_height - 1), fill=1)

            actual_fill = ImageChops.logical_and(fill_img, mask)

            text_img = Image.new("1", (128, 64), 0)
            text_draw = ImageDraw.Draw(text_img)
            text_draw.text((4, y_offset + 3), progress_text, fill=1, font=time_font)

            if not is_playing:
                pw, _ = _text_size(progress_text, time_font)
                px = 4 + pw + 4
                py = y_offset + 4
                text_draw.rectangle((px, py, px+1, py+8), fill=1)
                text_draw.rectangle((px+3, py, px+4, py+8), fill=1)

            dw, _ = _text_size(duration_text, time_font)
            text_draw.text((128 - 4 - dw, y_offset + 3), duration_text, fill=1, font=time_font)

            combined_progress = ImageChops.logical_xor(actual_fill, text_img)

            outline_img = Image.new("1", (128, 64), 0)
            outline_draw = ImageDraw.Draw(outline_img)
            outline_draw.rounded_rectangle((0, y_offset, 127, y_offset + bar_height - 1), radius=radius, outline=1, fill=0)

            img.paste(outline_img, (0, 0), outline_img)
            img.paste(combined_progress, (0, 0), combined_progress)
                
            progress_exit = float(exit_state.get("progress") or 0.0)
            if progress_exit > 0.0:
                fill_height = int(64 * min(max(progress_exit, 0.0), 1.0))
                if fill_height > 0:
                    draw.rectangle((0, 64 - fill_height, 127, 63), fill=1)
            return img

    if wtype == "time":
        time_main = str(widget.get("time_main") or "--:--")
        seconds = f":{widget.get('seconds') or '--'}"
        day = widget.get("day")
        day_str = str(day) if day is not None else "-"
        month = str(widget.get("month") or "---")

        # Match nanobackup.py TimeWidget styling/positions
        main_font = _font(30)
        sec_font = _font(12)
        date_day_font = _font(18)
        date_month_font = _font(12)

        main_time_x = 0
        main_time_y = 8
        draw.text((main_time_x, main_time_y), time_main, fill=1, font=main_font)

        # Push seconds further left (close to the main time)
        sec_w, _ = _text_size(seconds, sec_font)
        seconds_x = main_time_x + _text_size(time_main, main_font)[0] + 4  # 4px gap after main time
        if seconds_x + sec_w > 128:
            seconds_x = 128 - sec_w
        if seconds_x < 0:
            seconds_x = 0
        seconds_y = main_time_y + 12
        draw.text((seconds_x, seconds_y), seconds, fill=1, font=sec_font)

        date_x = main_time_x
        date_y = 45
        draw.text((date_x, date_y), day_str, fill=1, font=date_day_font)
        day_w, _ = _text_size(day_str, date_day_font)
        month_x = date_x + day_w + 2  # 2px spacing like nanobackup
        month_y = date_y + 5
        draw.text((month_x, month_y), month, fill=1, font=date_month_font)
        return img

    if wtype == "click_counter":
        # Match nanobackup ClickCounterWidget styling (big centered number)
        count_str = str(widget.get("count", 0))
        font_size = 48
        font = _font(font_size)

        # nanobackup approximates width as (font_size/2) per char
        text_width = len(count_str) * (font_size // 2)
        text_height = font_size
        x = (128 - text_width) // 2
        y = (64 - text_height) // 2
        x = max(0, min(x, 128 - text_width))
        y = max(0, min(y, 64 - text_height))
        draw.text((x, y), count_str, fill=1, font=font)
        return img

    if wtype == "timer":
        # Match nanobackup TimerWidget styling (hourglass icon; pause icon when stopped; big time)
        time_text = str(widget.get("time_text") or "05:00")
        running = bool(widget.get("running"))

        _draw_hourglass(5, 5)
        if not running:
            _draw_pause_icon(110, 5)

        font_size = 36
        font = _font(font_size)
        text_width = len(time_text) * (font_size // 2)
        text_height = font_size
        x = (128 - text_width) // 2
        y = (64 - text_height) // 2
        x = max(0, min(x, 128 - text_width))
        y = max(0, min(y, 64 - text_height))
        draw.text((x, y), time_text, fill=1, font=font)
        return img

    if wtype == "motion_status":
        motion_yes = "YES" if widget.get("motion_detected") else "NO"
        display_state = str(widget.get("display_state") or "ON").upper()
        idle = str(widget.get("idle") or "00:00")

        # Match nanobackup MotionStatusWidget styling
        title_font = _font(10)
        body_font = _font(9)

        draw.rectangle((0, 0, 127, 63), outline=1, fill=0)  # border
        draw.text((15, 5), "MOTION STATUS", fill=1, font=title_font)
        draw.text((10, 20), f"MOTION: {motion_yes}", fill=1, font=body_font)
        draw.text((10, 32), f"DISPLAY: {display_state}", fill=1, font=body_font)
        draw.text((10, 44), f"IDLE: {idle}", fill=1, font=body_font)
        draw.text((5, 55), "ROTATE TO CHANGE", fill=1, font=body_font)
        return img

    if wtype == "weather":
        if widget.get("needs_location"):
            title_font = _font(10)
            tw, _ = _text_size("SET LOCATION", title_font)
            draw.text((max((128 - tw) // 2, 0), 26), "SET LOCATION", fill=1, font=title_font)
            return img
        if widget.get("error") and not widget.get("temperature_f"):
            title_font = _font(10)
            tw, _ = _text_size("WEATHER ERR", title_font)
            draw.text((max((128 - tw) // 2, 0), 26), "WEATHER ERR", fill=1, font=title_font)
            return img

        location = str(widget.get("location") or widget.get("location_query") or "")
        location = location.split(",")[0].strip()[:12] or "WEATHER"
        temp_val = widget.get("temperature_f")
        temp_text = "--°F"
        try:
            if temp_val is not None:
                temp_text = f"{round(float(temp_val))}°F"
        except (TypeError, ValueError):
            pass
        condition = str(widget.get("condition") or "")

        title_font = _font(9)
        temp_font = _font(28)
        meta_font = _font(8)

        tw, _ = _text_size(location, title_font)
        draw.text((max((128 - tw) // 2, 0), 2), location.upper(), fill=1, font=title_font)

        temp_w, _ = _text_size(temp_text, temp_font)
        draw.text((max((128 - temp_w) // 2, 0), 18), temp_text, fill=1, font=temp_font)

        condition = condition[:18]
        cw, _ = _text_size(condition, meta_font)
        draw.text((max((128 - cw) // 2, 0), 52), condition, fill=1, font=meta_font)
        return img

    if wtype == "version_status":
        local = str(widget.get("local") or "unknown")
        remote = str(widget.get("remote") or "n/a")
        status = str(widget.get("status") or "unknown").upper()
        branch = str(widget.get("branch") or "")

        title_font = _font(10)
        body_font = _font(9)

        draw.rectangle((0, 0, 127, 63), outline=1, fill=0)
        draw.text((18, 5), "VERSION DEBUG", fill=1, font=title_font)
        draw.text((5, 20), f"L: {local}", fill=1, font=body_font)
        draw.text((5, 32), f"R: {remote}", fill=1, font=body_font)
        draw.text((5, 44), f"S: {status}", fill=1, font=body_font)
        if branch:
            draw.text((5, 54), f"B: {branch}", fill=1, font=body_font)
        return img

    if wtype == "photo":
        image_b64 = widget.get("image_base64")
        if image_b64:
            try:
                photo_img = Image.open(io.BytesIO(base64.b64decode(image_b64)))
                photo_img = photo_img.convert("1")
                photo_img.thumbnail((128, 64))
                paste_x = (128 - photo_img.width) // 2
                paste_y = (64 - photo_img.height) // 2
                img.paste(photo_img, (paste_x, paste_y))
                return img
            except Exception:
                pass
        # No image uploaded yet – show placeholder text
        title_font = _font(10)
        tw, _ = _text_size("NO PHOTO", title_font)
        draw.text((max((128 - tw) // 2, 0), 26), "NO PHOTO", fill=1, font=title_font)
        return img

    if wtype == "app_launcher":
        if str(widget.get("preview_type") or "") == "spotify":
            preview = widget.get("preview") or {}
            track_name = str(preview.get("track_name") or "Waiting for track...")
            artist_name = str(preview.get("artist_name") or "")
            authenticated = bool(preview.get("authenticated"))

            track_font = _font(12)
            artist_font = _font(10)
            time_font = _font(8)

            def get_offset(text_w: int, max_w: int, speed: float = 25.0, pause: float = 3.0) -> int:
                if text_w <= max_w:
                    return 0
                sr = text_w - max_w + 10
                t_move = sr / speed
                cycle = 2 * t_move + 2 * pause
                p = time.time() % cycle
                if p < pause: return 0
                if p < pause + t_move: return int((p - pause) * speed)
                if p < 2 * pause + t_move: return int(sr)
                return int(sr - (p - 2 * pause - t_move) * speed)

            now = datetime.now()
            hour_12 = now.hour % 12 or 12
            sys_time = f"{hour_12}:{now.minute:02d}"
            sys_time_w, sys_time_h = _text_size(sys_time, track_font)
            time_x = 128 - sys_time_w - 2
            time_y = 5

            tw, _ = _text_size(track_name, track_font)
            track_max_w = time_x - 6
            tx = 2 - get_offset(tw, track_max_w)
            draw.text((tx, 5), track_name, fill=1, font=track_font, anchor="lt")
            
            aw, _ = _text_size(artist_name, artist_font)
            artist_max_w = 124
            ax = 2 - get_offset(aw, artist_max_w, speed=20.0)
            draw.text((ax, 22), artist_name, fill=1, font=artist_font)
            
            # Mask out the time area so track name doesn't overlap it when scrolling
            draw.rectangle((time_x - 4, 0, 127, time_y + sys_time_h + 2), fill=0)
            draw.text((time_x, time_y), sys_time, fill=1, font=track_font, anchor="lt")
            
            hint_font = _font(8)
            hint = "CONNECT IN WEB UI" if not authenticated else "PRESS DIAL TO OPEN"
            hw, _ = _text_size(hint, hint_font)
            draw.text((2, 45), hint, fill=1, font=hint_font)

            return img

        title_font = _font(10)
        name = str(widget.get("app_name") or widget.get("name") or "APP")
        tw, _ = _text_size(name, title_font)
        draw.text((max((128 - tw) // 2, 0), 18), name.upper(), fill=1, font=title_font)
        hint_font = _font(8)
        hint = "PRESS DIAL"
        hw, _ = _text_size(hint, hint_font)
        draw.text((max((128 - hw) // 2, 0), 34), hint, fill=1, font=hint_font)
        return img

    # Fallback: simple "?" screen
    fallback_font = _font(20)
    w, h = _text_size("?", fallback_font)
    x = max((128 - w) // 2, 0)
    y = max((64 - h) // 2, 0)
    draw.text((x, y), "?", fill=1, font=fallback_font)
    return img


def _oled_display_loop(
    controller: DashboardController,
    oled_driver: Any,
    stop_event: threading.Event,
    port: int,
) -> None:
    """
    Render widgets directly to a 128x64 buffer with Pillow (nanobackup-style)
    and push frames to the SH1106, while keeping the web /oled preview running
    for browser use.
    """
    if image_to_sh1106_pages is None or oled_driver is None:
        return
    if not PIL_AVAILABLE or Image is None:
        print("OLED display: Pillow not available; hardware rendering disabled.")
        return

    interval = 0.1  # ~10 FPS

    while not stop_event.is_set():
        motion = controller.motion_manager.get_status()
        if motion.get("display_off"):
            time.sleep(interval)
            continue
        try:
            state = controller.snapshot()
            img = _oled_render_image_from_state(state)
            if img is None:
                time.sleep(interval)
                continue
            
            po_progress = float(state.get("power_off", {}).get("progress") or 0.0)
            if po_progress > 0.0:
                fill_width = int(128 * min(max(po_progress, 0.0), 1.0))
                if fill_width > 0:
                    ImageDraw.Draw(img).rectangle((0, 0, fill_width - 1, 63), fill=1)
                    
            rs_progress = float(state.get("restart", {}).get("progress") or 0.0)
            if rs_progress > 0.0:
                fill_width = int(128 * min(max(rs_progress, 0.0), 1.0))
                if fill_width > 0:
                    ImageDraw.Draw(img).rectangle((0, 0, fill_width - 1, 63), fill=1)

            pages = image_to_sh1106_pages(img)
            oled_driver.display_frame(pages)
        except Exception as exc:
            if MOTION_DEBUG:
                print(f"OLED display loop: {exc}")
        time.sleep(interval)


def run_dashboard() -> None:
    # Same order as nanobackup.py: RPi.GPIO first (motion + display pins only), then gpiozero for encoder/buttons
    used_rpi_gpio = False
    if GPIO_AVAILABLE:
        try:
            GPIO.setwarnings(False)
            GPIO.cleanup()
        except Exception:
            pass
        sensor_available = setup_gpio_pins()
        used_rpi_gpio = sensor_available
    else:
        sensor_available = False

    controller = DashboardController(sensor_available=False)
    controller.motion_manager.sensor_available = sensor_available
    controls = HardwareControls(controller)
    controls.initialize()
    controller.start()

    oled_driver: Optional[Any] = None
    spi: Optional[Any] = None

    if OLED_ENABLED and GPIO_AVAILABLE and SH1106Driver is not None and image_to_sh1106_pages is not None:
        try:
            import spidev  # type: ignore[import-untyped]

            spi = spidev.SpiDev()
            spi.open(0, 0)
            spi.max_speed_hz = 1000000
            spi.mode = 0b00

            def _gpio_output(pin: int, value: int) -> None:
                GPIO.output(pin, value)

            oled_driver = SH1106Driver(spi, _gpio_output, OLED_A0_PIN, OLED_RESN_PIN)
            oled_driver.init_display(quiet=(os.environ.get("DASH_QUIET_UPDATE") == "1"))

            controller.motion_manager.set_display_driver(
                turn_off=oled_driver.turn_off,
                turn_on=oled_driver.turn_on,
                set_brightness=oled_driver.set_contrast,
            )
            print("SH1106 OLED initialized; display thread will render /oled via wkhtmltoimage.")
        except Exception as exc:
            print(f"OLED init failed (running without display): {exc}")
            oled_driver = None
            if spi is not None:
                try:
                    spi.close()
                except Exception:
                    pass
                spi = None

    DashRequestHandler.controller = controller
    DashRequestHandler.static_root = WEB_DIR

    class ReuseAddressServer(ThreadingHTTPServer):
        allow_reuse_address = True

        def server_bind(self) -> None:
            if hasattr(socket, "SO_REUSEPORT"):
                self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
            super().server_bind()

    _MAX_BIND_RETRIES = SERVER_BIND_MAX_RETRIES
    _BIND_RETRY_DELAY = SERVER_BIND_RETRY_DELAY
    server = None
    for _attempt in range(_MAX_BIND_RETRIES):
        try:
            server = ReuseAddressServer((HTTP_HOST, HTTP_PORT), DashRequestHandler)
            break
        except OSError as exc:
            if _attempt < _MAX_BIND_RETRIES - 1:
                print(f"Port {HTTP_PORT} busy (attempt {_attempt + 1}/{_MAX_BIND_RETRIES}): {exc}; retrying in {_BIND_RETRY_DELAY}s...")
                time.sleep(_BIND_RETRY_DELAY)
            else:
                raise
    stop_event = threading.Event()

    def begin_shutdown() -> None:
        if stop_event.is_set():
            return
        stop_event.set()
        controller.save_widget_state()
        threading.Thread(target=server.shutdown, daemon=True).start()

    def _signal_handler(_signum: int, _frame: Any) -> None:
        print("Shutdown signal received.")
        begin_shutdown()

    signal.signal(signal.SIGINT, _signal_handler)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, _signal_handler)

    # Run HTTP server in a thread so it is accepting before the OLED thread hits /oled
    server_thread = threading.Thread(
        target=lambda: server.serve_forever(poll_interval=0.2),
        daemon=False,
    )
    server_thread.start()
    time.sleep(0.8)  # let server enter accept loop before OLED tries to load page

    updater = threading.Thread(
        target=widget_update_loop,
        args=(controller, stop_event),
        daemon=True,
    )
    updater.start()

    oled_thread: Optional[threading.Thread] = None
    if oled_driver is not None:
        oled_thread = threading.Thread(
            target=_oled_display_loop,
            args=(controller, oled_driver, stop_event, HTTP_PORT),
            daemon=True,
        )
        oled_thread.start()

    print("Web dashboard is running.")
    print(f"Open http://localhost:{HTTP_PORT} on this machine (preview).")
    if HTTP_HOST == "0.0.0.0":
        print(f"Or open http://<raspberry-pi-ip>:{HTTP_PORT} from another device.")
    if oled_driver is not None:
        print("OLED is the display output; /oled view is rendered to the hardware.")

    try:
        server_thread.join()
    finally:
        stop_event.set()
        updater.join(timeout=1.0)
        if oled_thread is not None:
            oled_thread.join(timeout=2.0)
        if oled_driver is not None:
            try:
                oled_driver.turn_off()
            except Exception:
                pass
        if spi is not None:
            try:
                spi.close()
            except Exception:
                pass
        controls.cleanup()
        controller.stop()
        server.server_close()
        if used_rpi_gpio and GPIO_AVAILABLE:
            try:
                GPIO.cleanup()
            except Exception:
                pass


if __name__ == "__main__":
    if not WEB_DIR.exists():
        raise RuntimeError(f"Missing frontend directory: {WEB_DIR}")
    run_dashboard()
