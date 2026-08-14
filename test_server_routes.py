#!/usr/bin/env python3
"""
Unit test suite for DashRequestHandler routes and endpoints.
"""

import unittest
from unittest.mock import MagicMock, patch
import io
import json
from http import HTTPStatus

from dash_app import (
    DashRequestHandler,
    DashboardController,
    SettingsStore,
    WifiManager,
    WEB_DIR
)


class TestDashRequestHandler(unittest.TestCase):

    def setUp(self):
        self.controller = MagicMock()
        self.controller.snapshot.return_value = {
            "mode": "widgets",
            "widgets": [],
            "display_mode": "on",
            "motion": {"motion_detected": False}
        }
        self.controller.get_wide_snapshot.return_value = {
            "version": "2.0.2",
            "widgets": [],
            "apps": []
        }
        self.controller.get_wide_slots.return_value = ["time", "weather", "spotify"]
        self.controller.spotify_client = MagicMock()
        self.controller.spotify_client.is_configured.return_value = True
        self.controller.spotify_client.is_authenticated.return_value = True
        self.controller.wifi_manager = WifiManager()
        self.controller.next_widget = MagicMock()

        DashRequestHandler.controller = self.controller
        DashRequestHandler.static_root = WEB_DIR

    def _create_handler(self, method: str, path: str, body: bytes = b""):
        handler = DashRequestHandler.__new__(DashRequestHandler)
        handler.controller = self.controller
        handler.static_root = WEB_DIR
        handler.command = method
        handler.path = path
        handler.requestline = f"{method} {path} HTTP/1.1"
        handler.request_version = "HTTP/1.1"
        handler.headers = {
            "Host": "localhost:8080",
            "Content-Length": str(len(body)),
            "Content-Type": "application/json"
        }
        handler.rfile = io.BytesIO(body)
        handler.wfile = io.BytesIO()
        handler.client_address = ("127.0.0.1", 12345)
        return handler

    def _simulate_get(self, path: str):
        handler = self._create_handler("GET", path)
        handler.do_GET()
        return handler.wfile.getvalue()

    def _simulate_post(self, path: str, body: bytes = b"{}"):
        handler = self._create_handler("POST", path, body)
        handler.do_POST()
        return handler.wfile.getvalue()

    def test_get_api_state(self):
        resp = self._simulate_get("/api/state")
        self.assertIn(b"200 OK", resp)
        self.assertIn(b'"mode": "widgets"', resp)

    def test_get_index_html(self):
        resp = self._simulate_get("/")
        self.assertIn(b"200 OK", resp)
        self.assertIn(b"Live Control Surface", resp)

        resp2 = self._simulate_get("/index.html")
        self.assertIn(b"200 OK", resp2)
        self.assertIn(b"Live Control Surface", resp2)

    def test_get_wide_html(self):
        resp = self._simulate_get("/wide")
        self.assertIn(b"200 OK", resp)
        resp2 = self._simulate_get("/wide.html")
        self.assertIn(b"200 OK", resp2)

    def test_get_api_wide_state(self):
        resp = self._simulate_get("/api/wide/state")
        self.assertIn(b"200 OK", resp)
        self.assertIn(b'"version": "2.0.2"', resp)

    def test_get_oled(self):
        resp = self._simulate_get("/oled")
        self.assertIn(b"200 OK", resp)

    def test_get_static_files(self):
        for path in ["/app.js", "/styles.css", "/oled.css", "/wide.js", "/wide.css"]:
            resp = self._simulate_get(path)
            self.assertIn(b"200 OK", resp, f"Failed for {path}")

    def test_post_action(self):
        resp = self._simulate_post("/api/action", b'{"action": "next"}')
        self.assertIn(b"200 OK", resp)
        self.controller.next_widget.assert_called_once()


if __name__ == "__main__":
    unittest.main()
