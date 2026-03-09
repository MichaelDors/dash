from __future__ import annotations

import json
import os

import signal
import socket
import threading
import time
from datetime import datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

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
    from PIL import Image, ImageDraw, ImageFont

    PIL_AVAILABLE = True
except Exception:
    PIL_AVAILABLE = False
    Image = None  # type: ignore[assignment]
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
ALLOW_SYSTEM_POWER_OFF = os.getenv("DASH_ALLOW_POWEROFF", "0") == "1"
OLED_ENABLED = os.getenv("DASH_OLED", "1") == "1"
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
        super().__init__("click_counter", "Click Counter")
        self.click_count = 0

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
        self.default_duration = 5 * 60
        self.time_remaining = self.default_duration
        self.timer_running = False
        self._end_timestamp: Optional[float] = None
        self.flash_until = 0.0
        self.flash_state = False

    def on_button_press(self) -> None:
        if self.timer_running:
            self._pause_timer()
            print("Timer paused.")
        else:
            self._start_timer()
            print("Timer started.")

    def add_minute(self) -> None:
        if self.timer_running:
            return
        self.time_remaining = min(99 * 60, self.time_remaining + 60)
        print(
            "Added 1 minute. "
            f"New time: {self.time_remaining // 60}:{self.time_remaining % 60:02d}"
        )

    def subtract_minute(self) -> None:
        if self.timer_running:
            return
        self.time_remaining = max(60, self.time_remaining - 60)
        print(
            "Subtracted 1 minute. "
            f"New time: {self.time_remaining // 60}:{self.time_remaining % 60:02d}"
        )

    def update(self, now: float) -> None:
        if self.timer_running and self._end_timestamp is not None:
            remaining = max(0, int(self._end_timestamp - now + 0.999))
            self.time_remaining = remaining

            if remaining <= 0:
                self.timer_running = False
                self._end_timestamp = None
                self.time_remaining = self.default_duration
                self.flash_until = now + 3.0
                print("Timer finished.")

        if now < self.flash_until:
            self.flash_state = (int(now * 2) % 2) == 0
        else:
            self.flash_state = False

    def _start_timer(self) -> None:
        self.timer_running = True
        self._end_timestamp = time.time() + self.time_remaining

    def _pause_timer(self) -> None:
        if self._end_timestamp is not None:
            self.time_remaining = max(1, int(self._end_timestamp - time.time() + 0.999))
        self.timer_running = False
        self._end_timestamp = None

    def to_payload(self) -> Dict[str, Any]:
        return {
            "id": self.widget_id,
            "name": self.name,
            "type": "timer",
            "running": self.timer_running,
            "flash": self.flash_state,
            "minutes": self.time_remaining // 60,
            "seconds": self.time_remaining % 60,
            "time_text": f"{self.time_remaining // 60:02d}:{self.time_remaining % 60:02d}",
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


class DashboardController:
    """Coordinates widgets, motion state, and hardware/button actions."""

    def __init__(self, sensor_available: bool):
        self.motion_manager = MotionSensorManager(sensor_available)
        self.widgets: List[Widget] = [
            TimeWidget(),
            ClickCounterWidget(),
            TimerWidget(),
            MotionStatusWidget(self.motion_manager),
        ]
        self.current_widget_index = 0

        self.button1_last_press = 0.0
        self.button2_last_press = 0.0
        self.button_cooldown = 0.1

        self._lock = threading.Lock()

    def start(self) -> None:
        self.motion_manager.start_monitoring()

    def stop(self) -> None:
        self.motion_manager.stop_monitoring()

    def update_widgets(self) -> None:
        now = time.time()
        with self._lock:
            for widget in self.widgets:
                widget.update(now)

    def next_widget(self) -> None:
        with self._lock:
            self.current_widget_index = (self.current_widget_index + 1) % len(self.widgets)
            current = self.widgets[self.current_widget_index]
            print(f"Switched to widget: {current.name}")
        self.motion_manager.report_user_activity()

    def previous_widget(self) -> None:
        with self._lock:
            self.current_widget_index = (self.current_widget_index - 1) % len(self.widgets)
            current = self.widgets[self.current_widget_index]
            print(f"Switched to widget: {current.name}")
        self.motion_manager.report_user_activity()

    def main_button_press(self) -> None:
        with self._lock:
            current = self.widgets[self.current_widget_index]
            if current.should_process_button_press():
                current.on_button_press()
        self.motion_manager.report_user_activity()

    def main_button_hold(self) -> None:
        with self._lock:
            current = self.widgets[self.current_widget_index]
            current.on_button_hold_start()
        self.motion_manager.report_user_activity()

    def button1_press(self) -> None:
        now = time.time()
        if now - self.button1_last_press < self.button_cooldown:
            return
        self.button1_last_press = now

        with self._lock:
            current = self.widgets[self.current_widget_index]
            if hasattr(current, "add_minute"):
                getattr(current, "add_minute")()
        self.motion_manager.report_user_activity()

    def button2_press(self) -> None:
        now = time.time()
        if now - self.button2_last_press < self.button_cooldown:
            return
        self.button2_last_press = now

        with self._lock:
            current = self.widgets[self.current_widget_index]
            if hasattr(current, "subtract_minute"):
                getattr(current, "subtract_minute")()
        self.motion_manager.report_user_activity()

    def button1_hold(self) -> None:
        if ALLOW_SYSTEM_POWER_OFF:
            print("Button1 held for power-off. Shutting down system.")
            os.system("sudo shutdown -h now")
            return

        print("Button1 held, but power-off is disabled (set DASH_ALLOW_POWEROFF=1 to enable).")

    def simulate_motion(self) -> None:
        self.motion_manager.report_user_activity(motion=True)

    def register_activity(self) -> None:
        self.motion_manager.report_user_activity()

    def snapshot(self) -> Dict[str, Any]:
        with self._lock:
            active_widget = self.widgets[self.current_widget_index]
            widget_tabs = [
                {
                    "id": widget.widget_id,
                    "name": widget.name,
                    "active": idx == self.current_widget_index,
                }
                for idx, widget in enumerate(self.widgets)
            ]
            active_payload = active_widget.to_payload()

        motion = self.motion_manager.get_status()
        display_mode = "on"
        if motion["display_off"]:
            display_mode = "off"
        elif motion["display_dimmed"]:
            display_mode = "dim"

        return {
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "display_mode": display_mode,
            "widgets": widget_tabs,
            "active_widget": active_payload,
            "motion": motion,
        }


class HardwareControls:
    """Optional hardware bindings (rotary + buttons)."""

    def __init__(self, controller: DashboardController):
        self.controller = controller
        self.encoder: Optional[Any] = None
        self.main_button: Optional[Any] = None
        self.button1: Optional[Any] = None
        self.button2: Optional[Any] = None

    def initialize(self) -> None:
        if not GPIOZERO_AVAILABLE:
            print("gpiozero not available; keyboard/web controls only.")
            return

        try:
            self.encoder = RotaryEncoder(CLK_PIN, DT_PIN, max_steps=0)
            self.encoder.when_rotated_clockwise = self.controller.next_widget
            self.encoder.when_rotated_counter_clockwise = self.controller.previous_widget
            print("Rotary encoder initialized.")
        except Exception as exc:
            print(f"Failed to initialize rotary encoder: {exc}")

        try:
            self.main_button = Button(SW_PIN, hold_time=1.0, hold_repeat=False)
            self.main_button.when_pressed = self.controller.main_button_press
            self.main_button.when_held = self.controller.main_button_hold
            print("Main button initialized.")
        except Exception as exc:
            print(f"Failed to initialize main button: {exc}")

        try:
            self.button1 = Button(BUTTON1_PIN, hold_time=5.0, hold_repeat=False)
            self.button1.when_pressed = self.controller.button1_press
            self.button1.when_held = self.controller.button1_hold
            print("Button1 initialized.")
        except Exception as exc:
            print(f"Failed to initialize button1: {exc}")

        try:
            self.button2 = Button(BUTTON2_PIN, hold_time=1.0, hold_repeat=False)
            self.button2.when_pressed = self.controller.button2_press
            print("Button2 initialized.")
        except Exception as exc:
            print(f"Failed to initialize button2: {exc}")

    def cleanup(self) -> None:
        for device in [self.encoder, self.main_button, self.button1, self.button2]:
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


def _render_oled_widget_html(widget: Dict[str, Any], motion: Dict[str, Any]) -> str:
    """Server-side render of active widget HTML (mirrors oled.html renderWidget) so wkhtmltoimage gets content without JS."""
    w = widget
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

        self._send_json({"error": "Not found"}, status=HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
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
            "press": self.controller.main_button_press,
            "hold": self.controller.main_button_hold,
            "add_minute": self.controller.button1_press,
            "subtract_minute": self.controller.button2_press,
            "activity": self.controller.register_activity,
            "simulate_motion": self.controller.simulate_motion,
        }

        handler = actions.get(action)
        if handler is None:
            return False

        handler()
        return True

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
        widget_html = _render_oled_widget_html(
            state.get("active_widget") or {},
            state.get("motion") or {},
        )
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

        # nanobackup uses a width approximation to place seconds
        main_time_width = len(time_main) * 40
        seconds_x = main_time_x + main_time_width - 80
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
            oled_driver.init_display()
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
