#!/usr/bin/env python3
"""
Dash launcher: on boot, check for updates from GitHub and sync files, then run the app.

Copy only this file to the Pi. It will:
  1. Compare remote VERSION (GitHub) with local. If remote is newer, or if
     key files (e.g. dash_app.py) are missing, sync files from GitHub.
  2. Syncing downloads each file from raw.githubusercontent.com and writes
     it locally — missing files are created, existing ones updated.
  3. Run the dashboard app (dash_app.py).

Optional: GITHUB_REPO (default: MichaelDors/dash), GITHUB_BRANCH (default: main).
No git needed on the Pi.
"""

from __future__ import annotations

import base64
import io
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

REPO_DIR = Path(__file__).resolve().parent
APP_SCRIPT = REPO_DIR / "dash_app.py"

# Files to sync from GitHub (relative paths). Missing files are created.
REPO_FILES = [
    "dash_app.py",
    "oled_driver.py",
    "VERSION",
    "web/index.html",
    "web/oled.html",
    "web/oled.css",
    "web/app.js",
    "web/styles.css",
]

# Embedded boot logo (PNG) as base64 data URL. White pixels = on, black pixels = off.
BOOTLOGO_DATA_URL = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAIAAAABACAIAAABdtOgoAAAGCGlUWHRYTUw6Y29tLmFkb2JlLnhtcAAAAAAAPD94cGFja2V0IGJlZ2luPSLvu78iIGlkPSJXNU0wTXBDZWhpSHpyZVN6TlRjemtjOWQiPz4KPHg6eG1wbWV0YSB4bWxuczp4PSJhZG9iZTpuczptZXRhLyIgeDp4bXB0az0iWE1QIENvcmUgNS41LjAiPgogPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4KICA8cmRmOkRlc2NyaXB0aW9uIHJkZjphYm91dD0iIgogICAgeG1sbnM6eG1wPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvIgogICAgeG1sbnM6cGhvdG9zaG9wPSJodHRwOi8vbnMuYWRvYmUuY29tL3Bob3Rvc2hvcC8xLjAvIgogICAgeG1sbnM6ZGM9Imh0dHA6Ly9wdXJsLm9yZy9kYy9lbGVtZW50cy8xLjEvIgogICAgeG1sbnM6ZXhpZj0iaHR0cDovL25zLmFkb2JlLmNvbS9leGlmLzEuMC8iCiAgICB4bWxuczp0aWZmPSJodHRwOi8vbnMuYWRvYmUuY29tL3RpZmYvMS4wLyIKICAgIHhtbG5zOnhtcE1NPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvbW0vIgogICAgeG1sbnM6c3RFdnQ9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZUV2ZW50IyIKICAgeG1wOkNyZWF0ZURhdGU9IjIwMjYtMDMtMDhUMjE6NDQ6NDctMDQ6MDAiCiAgIHhtcDpNb2RpZnlEYXRlPSIyMDI2LTAzLTA4VDIyOjMxOjM4LTA0OjAwIgogICB4bXA6TWV0YWRhdGFEYXRlPSIyMDI2LTAzLTA4VDIyOjMxOjM4LTA0OjAwIgogICBwaG90b3Nob3A6RGF0ZUNyZWF0ZWQ9IjIwMjYtMDMtMDhUMjE6NDQ6NDctMDQ6MDAiCiAgIHBob3Rvc2hvcDpDb2xvck1vZGU9IjMiCiAgIHBob3Rvc2hvcDpJQ0NQcm9maWxlPSJzUkdCIElFQzYxOTY2LTIu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"
)


def parse_version(s: str) -> tuple[int, ...]:
    s = (s or "").strip()
    s = re.sub(r"^v", "", s, flags=re.IGNORECASE)
    parts = re.split(r"[.\-]", s)
    out: list[int] = []
    for p in parts:
        try:
            out.append(int(re.sub(r"[^0-9].*", "", p)))
        except ValueError:
            out.append(0)
    return tuple(out) if out else (0,)


def fetch_remote_version(repo: str, branch: str) -> str | None:
    url = f"https://raw.githubusercontent.com/{repo}/{branch}/VERSION"
    req = Request(url, headers={"User-Agent": "Dash-Launcher/1.0"})
    try:
        with urlopen(req, timeout=10) as resp:
            return resp.read().decode("utf-8").strip()
    except (URLError, HTTPError, OSError):
        return None


def read_local_version() -> str:
    try:
        return (REPO_DIR / "VERSION").read_text(encoding="utf-8").strip()
    except OSError:
        return "0.0.0"


def is_newer(remote: str, local: str) -> bool:
    return parse_version(remote) > parse_version(local)


def sync_file(repo: str, branch: str, rel_path: str) -> tuple[bool, str | None]:
    """
    Download one file from GitHub raw and write to REPO_DIR/rel_path.
    Return (True, None) on success, (False, "404" or "error") on failure.
    """
    url = f"https://raw.githubusercontent.com/{repo}/{branch}/{rel_path}"
    req = Request(url, headers={"User-Agent": "Dash-Launcher/1.0"})
    try:
        with urlopen(req, timeout=15) as resp:
            data = resp.read()
    except HTTPError as e:
        return False, "404" if e.code == 404 else str(e.code)
    except (URLError, OSError):
        return False, "network"
    dest = REPO_DIR / rel_path
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    return True, None


def sync_from_github(repo: str, branch: str) -> bool:
    """Sync all REPO_FILES from GitHub. Return True if all succeeded."""
    ok = True
    for rel in REPO_FILES:
        success, err = sync_file(repo, branch, rel)
        if not success:
            if err == "404":
                print(f"Sync failed: {rel} (not in repo — add and push to GitHub)", file=sys.stderr)
            else:
                print(f"Sync failed: {rel} ({err})", file=sys.stderr)
            ok = False
    return ok


def need_sync(repo: str, branch: str) -> tuple[bool, str | None]:
    """
    Return (True, reason) if we should sync: remote newer or key files missing.
    Return (False, None) if up to date and nothing missing.
    """
    if not APP_SCRIPT.exists():
        return True, "dash_app.py missing"
    remote = fetch_remote_version(repo, branch)
    if remote is None:
        return False, None
    local = read_local_version()
    if is_newer(remote, local):
        return True, f"remote {remote} > local {local}"
    return False, None


def show_boot_logo() -> None:
    """
    Show embedded boot logo on the OLED during loading. No web server — minimal SPI/GPIO only.
    White pixels = on, black = off. Silently skips if display unavailable.
    """
    try:
        import RPi.GPIO as GPIO  # noqa: PLC0415
    except Exception as exc:
        print(f"Boot logo: RPi.GPIO not available ({exc}).", file=sys.stderr)
        return
    try:
        from oled_driver import SH1106Driver, image_to_sh1106_pages
    except Exception as exc:
        print(f"Boot logo: oled_driver import failed ({exc}).", file=sys.stderr)
        return
    try:
        import spidev  # type: ignore[import-untyped]
    except Exception as exc:
        print(f"Boot logo: spidev import failed ({exc}).", file=sys.stderr)
        return
    try:
        from PIL import Image  # noqa: PLC0415
    except Exception as exc:
        print(f"Boot logo: Pillow not available ({exc}).", file=sys.stderr)
        return

    # Same pins as dash_app
    OLED_A0_PIN = 22
    OLED_RESN_PIN = 18

    spi = None
    try:
        GPIO.setwarnings(False)
        GPIO.setmode(GPIO.BOARD)
        GPIO.setup(OLED_A0_PIN, GPIO.OUT, initial=GPIO.HIGH)
        GPIO.setup(OLED_RESN_PIN, GPIO.OUT, initial=GPIO.HIGH)

        spi = spidev.SpiDev()
        spi.open(0, 0)
        spi.max_speed_hz = 1000000
        spi.mode = 0b00

        def _gpio_output(pin: int, value: int) -> None:
            GPIO.output(pin, value)

        driver = SH1106Driver(spi, _gpio_output, OLED_A0_PIN, OLED_RESN_PIN)
        driver.init_display()

        try:
            _prefix, _sep, b64_data = BOOTLOGO_DATA_URL.partition(",")
            raw = base64.b64decode(b64_data.strip())
            img = Image.open(io.BytesIO(raw))
        except Exception as exc:
            print(f"Boot logo: failed to load image ({exc}).", file=sys.stderr)
            return

        pages = image_to_sh1106_pages(img)
        if not pages:
            print("Boot logo: image_to_sh1106_pages returned no data.", file=sys.stderr)
            return

        # White pixels = on, black pixels = off (native monochrome mapping).
        driver.display_frame(pages)
    except Exception as exc:
        print(f"Boot logo: unexpected error ({exc}).", file=sys.stderr)
    finally:
        if spi is not None:
            try:
                spi.close()
            except Exception:
                pass


def stop_existing_dashboard() -> None:
    """Stop any already-running dash_app.py so the new process can bind the port."""
    try:
        subprocess.run(
            ["pkill", "-f", "dash_app.py"],
            capture_output=True,
            timeout=5,
        )
        time.sleep(2)  # let OS release port and GPIO
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        pass


def run_update_check() -> None:
    repo = os.getenv("GITHUB_REPO", "MichaelDors/dash").strip()
    branch = os.environ.get("GITHUB_BRANCH", "main").strip()
    if not repo:
        return  # no repo configured, skip sync
    do_sync, reason = need_sync(repo, branch)
    if not do_sync:
        print("Up to date.")
        return
    print(f"Syncing from GitHub: {reason}")
    if sync_from_github(repo, branch):
        print("Sync done.")
    else:
        print("Some files failed to sync.", file=sys.stderr)


def main() -> None:
    stop_existing_dashboard()
    show_boot_logo()
    boot_start = time.monotonic()
    run_update_check()
    # Ensure the boot logo is visible for at least 3 seconds total.
    elapsed = time.monotonic() - boot_start
    remaining = 3.0 - elapsed
    if remaining > 0:
        time.sleep(remaining)
    if not APP_SCRIPT.exists():
        print(f"App script not found: {APP_SCRIPT}", file=sys.stderr)
        print("Add dash_app.py to your repo (https://github.com/MichaelDors/dash) and push, then try again.", file=sys.stderr)
        sys.exit(1)
    os.chdir(REPO_DIR)
    os.execv(sys.executable, [sys.executable, str(APP_SCRIPT)] + sys.argv[1:])


if __name__ == "__main__":
    main()
