#!/usr/bin/env python3
"""
Unit test suite for WifiManager, QR Code generation, and SettingsApp Wi-Fi views.
"""

import unittest
from unittest.mock import MagicMock, patch
import json

from dash_app import (
    WifiManager,
    generate_qr_base64,
    SettingsStore,
    SettingsApp,
    DashboardController,
    KEYBOARD_CHARS
)


class TestWifiManager(unittest.TestCase):

    def setUp(self):
        self.wifi_manager = WifiManager()

    def test_mock_scan_networks(self):
        networks = self.wifi_manager.scan_networks()
        self.assertIsInstance(networks, list)
        self.assertGreater(len(networks), 0)
        self.assertIn("ssid", networks[0])
        self.assertIn("signal", networks[0])
        self.assertIn("security", networks[0])

    def test_connect_network(self):
        success, msg = self.wifi_manager.connect_network("Mock_Hotel_WiFi", "pass1234")
        self.assertTrue(success)
        self.assertEqual(self.wifi_manager.connected_ssid, "Mock_Hotel_WiFi")
        self.assertIn("Connected to Mock_Hotel_WiFi", msg)
        self.assertIn("Mock_Hotel_WiFi", self.wifi_manager.get_saved_networks())

    def test_enable_and_disable_ap_mode(self):
        success, msg = self.wifi_manager.enable_ap_mode()
        self.assertTrue(success)
        self.assertTrue(self.wifi_manager.ap_mode_active)
        self.assertEqual(self.wifi_manager.ap_ssid, "Dash-Setup")

        self.wifi_manager.disable_ap_mode()
        self.assertFalse(self.wifi_manager.ap_mode_active)

    def test_generate_qr_base64(self):
        b64 = generate_qr_base64("http://192.168.4.1/wifi")
        self.assertIsInstance(b64, str)
        self.assertGreater(len(b64), 20)

    def test_settings_app_wifi_navigation(self):
        controller = MagicMock()
        controller.wifi_manager = self.wifi_manager
        controller.motion_manager._display_set_brightness = None
        settings_store = MagicMock()
        settings_store.max_brightness = 100
        settings_store.dim_brightness = 10
        settings_store.motion_sensor = True

        app = SettingsApp(controller, settings_store)
        self.assertIn("Wi-Fi", app.main_menu_options)

        # Select Wi-Fi (index 0)
        app.main_menu_idx = 0
        app.on_dial_press()
        self.assertEqual(app.current_view, "wifi_main")

        # Select "Scan Networks" (index 0 in wifi_menu_options)
        app.wifi_menu_idx = 0
        app.on_dial_press()
        self.assertEqual(app.current_view, "wifi_list")

        # Back to wifi_main (index 0 in wifi_list)
        app.wifi_list_idx = 0
        app.on_dial_press()
        self.assertEqual(app.current_view, "wifi_main")

        # Select "Phone QR Setup" (index 1 in wifi_menu_options)
        app.wifi_menu_idx = 1
        app.on_dial_press()
        self.assertEqual(app.current_view, "wifi_qr")
        self.assertTrue(self.wifi_manager.ap_mode_active)

        # Back to wifi_main from QR view
        app.on_dial_press()
        self.assertEqual(app.current_view, "wifi_main")

        # Select "Manual Keyboard" (index 3 in wifi_menu_options)
        app.wifi_menu_idx = 3
        app.on_dial_press()
        self.assertEqual(app.current_view, "wifi_keyboard")

        # Type "A", "B", then BACK
        app.wifi_keyboard_idx = KEYBOARD_CHARS.index("A")
        app.on_dial_press()
        self.assertEqual(app.wifi_password_buffer, "A")

        app.wifi_keyboard_idx = KEYBOARD_CHARS.index("B")
        app.on_dial_press()
        self.assertEqual(app.wifi_password_buffer, "AB")

        app.wifi_keyboard_idx = KEYBOARD_CHARS.index("BACK")
        app.on_dial_press()
        self.assertEqual(app.wifi_password_buffer, "A")

        # Payload structure test
        payload = app.to_payload()
        self.assertEqual(payload["type"], "settings")
        self.assertIn("wifi_password_buffer", payload)


if __name__ == "__main__":
    unittest.main()
