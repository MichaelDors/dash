"""Photo-frame HTTP contracts and isolation from physical dashboard state."""

import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from dash_app import DashRequestHandler, DashboardController, WEB_DIR, _ensure_photo_frame_assets
from photo_frame import PhotoFrameManager


class FrameRoutesTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.controller = MagicMock()
        self.controller.photo_frame = PhotoFrameManager(Path(self.temp.name))

    def request(self, method, path, body=None, headers=None):
        handler = DashRequestHandler.__new__(DashRequestHandler)
        handler.controller = self.controller
        handler.static_root = WEB_DIR
        handler.command = method
        handler.path = path
        handler.requestline = f"{method} {path} HTTP/1.1"
        handler.request_version = "HTTP/1.1"
        raw = json.dumps(body).encode() if body is not None else b""
        handler.headers = {"Host": "localhost:8080", "Content-Length": str(len(raw)),
                           "Content-Type": "application/json", **(headers or {})}
        handler.rfile = io.BytesIO(raw)
        handler.wfile = io.BytesIO()
        handler.client_address = ("127.0.0.1", 12345)
        with patch.object(handler, "log_message"):
            getattr(handler, f"do_{method}")()
        return handler.wfile.getvalue()

    def test_config_is_write_only_and_cannot_touch_hardware(self):
        secret = "test-secret-" + "x" * 48
        response = self.request("POST", "/api/frame/config", {
            "cloud_url": "https://example.convex.site", "token": secret,
        })
        self.assertIn(b"200 OK", response)
        self.assertNotIn(secret.encode(), response)
        self.assertIn(b'"token_configured": true', response)
        self.assertNotIn(secret.encode(), self.request("GET", "/api/frame/config"))
        self.assertNotIn(secret.encode(), self.request("GET", "/api/frame/photos"))
        self.controller.motion_manager.assert_not_called()
        self.controller.handle_wide_action.assert_not_called()
        self.controller.snapshot.assert_not_called()

    def test_rejects_cross_origin_and_oversized_configuration(self):
        response = self.request("POST", "/api/frame/config", {}, {"Origin": "https://elsewhere.example"})
        self.assertIn(b"403 Forbidden", response)
        response = self.request("POST", "/api/frame/config", {}, {"Content-Length": "999999999"})
        self.assertIn(b"400 Bad Request", response)
        response = self.request("POST", "/api/frame/config", [])
        self.assertIn(b"400 Bad Request", response)

    def test_missing_and_traversal_image_ids(self):
        for photo_id in ["a" * 64, "../config.json", "%2e%2e/config.json", "", "config.json"]:
            response = self.request("GET", "/api/frame/photos/" + photo_id)
            self.assertIn(b"404 Not Found", response)

    def test_image_bytes_and_conditional_cache(self):
        image = Path(self.temp.name) / "image.jpg"
        image.write_bytes(b"test-jpeg-bytes")
        photo_id = "a" * 64
        with patch.object(self.controller.photo_frame, "get_photo", return_value=image):
            response = self.request("GET", "/api/frame/photos/" + photo_id)
            self.assertIn(b"Content-Type: image/jpeg", response)
            self.assertTrue(response.endswith(b"test-jpeg-bytes"))
            response = self.request("GET", "/api/frame/photos/" + photo_id,
                                    headers={"If-None-Match": '"' + photo_id + '"'})
            self.assertIn(b"304 Not Modified", response)
            self.assertNotIn(b"test-jpeg-bytes", response)

    def test_frame_assets_and_existing_entrypoints(self):
        for path in ["/wide", "/wide.html", "/touch", "/frame-setup", "/frame.js", "/frame.css"]:
            self.assertIn(b"200 OK", self.request("GET", path), path)

    def test_controller_frame_config_does_not_change_oled_or_phone(self):
        with patch("dash_app.BASE_DIR", Path(self.temp.name)):
            controller = DashboardController(False, spotify_client=MagicMock())
        self.controller = controller
        before = controller.snapshot()
        phone_before = controller.phone_state.get_state()
        self.request("POST", "/api/frame/config", {"photo_preferences": {
            "a" * 64: {"position_x": 25, "position_y": 75, "clock": "top-right"},
        }})
        after = controller.snapshot()
        for key in ["mode", "active_widget", "active_app", "display_mode", "widgets"]:
            self.assertEqual(before.get(key), after.get(key), key)
        self.assertEqual(phone_before, controller.phone_state.get_state())
        self.assertEqual(controller.timer_widget.remaining_seconds, 300)

    def test_first_upgrade_fetches_only_missing_new_assets(self):
        with patch("dash_app.__file__", str(Path(self.temp.name) / "dash_app.py")), \
                patch("dash_app.dash_launcher.sync_file", return_value=(True, None)) as sync, \
                patch.dict("os.environ", {"GITHUB_REPO": "test/dash", "GITHUB_BRANCH": "main"}):
            (Path(self.temp.name) / "photo_frame.py").write_text("# already installed")
            _ensure_photo_frame_assets()
        self.assertEqual([call.args[2] for call in sync.call_args_list],
                         ["web/frame.js", "web/frame.css", "web/frame-setup.html"])


if __name__ == "__main__":
    unittest.main()
