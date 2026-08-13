import sys
from dash_app import _oled_render_image_from_state
state = {
    "mode": "app",
    "active_app": {
        "type": "spotify",
        "track_name": "Test Track",
        "artist_name": "Test Artist",
        "progress_ms": 30000,
        "duration_ms": 180000,
        "is_playing": True,
        "progress_text": "0:30",
        "duration_text": "3:00"
    },
    "app_exit": {
        "progress": 0.0
    }
}
img = _oled_render_image_from_state(state)
if img:
    print("Success, returned image:", img.mode, img.size)
    img.save("test_out.png")
else:
    print("Failed, returned None")
