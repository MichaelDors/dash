import sys
from dash_app import _oled_render_image_from_state, TimeWidget, ClickCounterWidget, TimerWidget, WeatherWidget, VersionStatusWidget, Widget
from datetime import datetime
import json
import os

artifact_dir = "/Users/admin/.gemini/antigravity-ide/brain/fc2293f1-5c28-4753-b397-6d8aba8e0f6b"

states = {
    "time": {
        "active_widget": {"type": "time", "time_main": "12:34", "seconds": "56", "day": "17", "month": "JUN"}
    },
    "counter": {
        "active_widget": {"type": "click_counter", "count": 42}
    },
    "timer": {
        "active_widget": {"type": "timer", "running": True, "flash": False, "time_text": "05:00"}
    },
    "motion": {
        "active_widget": {"type": "motion_status", "motion_detected": True, "display_state": "ON", "idle": "00:00"}
    },
    "weather": {
        "active_widget": {"type": "weather", "location": "New York", "temperature_f": 72, "condition": "Partly cloudy", "needs_location": False}
    },
    "version": {
        "active_widget": {"type": "version_status", "local": "1.0.0", "remote": "1.0.1", "checked_at": "2026-06-17T12:00:00Z"}
    },
    "photo": {
        "active_widget": {"type": "photo", "has_image": False}
    },
    "app_launcher": {
        "active_widget": {"type": "app_launcher", "name": "App Launcher"}
    },
    "pong": {
        "mode": "app",
        "active_app": {"type": "pong", "score": {"player": 10, "cpu": 5}, "player": {"x": 0, "y": 20, "width": 2, "height": 12}, "cpu": {"x": 126, "y": 30, "width": 2, "height": 12}, "ball": {"x": 64, "y": 32, "size": 2}, "field": {"width": 128, "height": 64}}
    },
    "spotify": {
        "mode": "app",
        "active_app": {"type": "spotify", "track_name": "A Very Long Track Name That Wraps", "artist_name": "Some Artist Name", "is_playing": True, "progress_ms": 1000, "duration_ms": 20000}
    },
    "settings_main": {
        "mode": "app",
        "active_app": {"type": "settings", "current_view": "main", "main_menu_idx": 0, "main_menu_options": [{"name": "Display", "is_subpage": True}, {"name": "About", "is_subpage": True}]}
    }
}

for name, state in states.items():
    img = _oled_render_image_from_state(state)
    if img:
        path = os.path.join(artifact_dir, f"{name}.png")
        img.save(path)
        print(f"Saved {path}")
