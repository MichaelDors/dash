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
    run_update_check()
    if not APP_SCRIPT.exists():
        print(f"App script not found: {APP_SCRIPT}", file=sys.stderr)
        print("Add dash_app.py to your repo (https://github.com/MichaelDors/dash) and push, then try again.", file=sys.stderr)
        sys.exit(1)
    stop_existing_dashboard()
    os.chdir(REPO_DIR)
    os.execv(sys.executable, [sys.executable, str(APP_SCRIPT)] + sys.argv[1:])


if __name__ == "__main__":
    main()
