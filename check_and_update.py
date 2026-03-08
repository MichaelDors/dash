#!/usr/bin/env python3
"""
Check-and-update helper for the Dash app.

Compares the VERSION file on GitHub with the local VERSION. If the remote
version is higher, runs `git pull` in the repo so you can deploy by just
committing (and bumping VERSION) on GitHub without SSHing into the RPi.

Usage (on the RPi, e.g. via cron):
  python3 check_and_update.py

Environment:
  GITHUB_REPO   - "owner/repo" (e.g. "myuser/dash"). Required.
  GITHUB_BRANCH - Branch to check (default: main)
  DASH_REPO_DIR - Directory containing the cloned repo (default: script dir)
  POST_UPDATE_CMD - Optional: shell command to run after a successful pull
                    (e.g. "sudo systemctl restart dash" to restart the app)
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

# -----------------------------------------------------------------------------
# Config (env)
# -----------------------------------------------------------------------------
GITHUB_REPO = os.getenv("GITHUB_REPO", "").strip()
GITHUB_BRANCH = os.environ.get("GITHUB_BRANCH", "main").strip()
REPO_DIR = Path(os.environ.get("DASH_REPO_DIR", Path(__file__).resolve().parent))
VERSION_FILE = REPO_DIR / "VERSION"
REMOTE_VERSION_URL = (
    f"https://raw.githubusercontent.com/{GITHUB_REPO}/{GITHUB_BRANCH}/VERSION"
    if GITHUB_REPO
    else ""
)


def parse_version(s: str) -> tuple[int, ...]:
    """Parse a version string into a tuple of integers for comparison."""
    s = (s or "").strip()
    # Allow "1.0.0" or "v1.0.0"
    s = re.sub(r"^v", "", s, flags=re.IGNORECASE)
    parts = re.split(r"[.\-]", s)
    out: list[int] = []
    for p in parts:
        try:
            out.append(int(re.sub(r"[^0-9].*", "", p)))
        except ValueError:
            out.append(0)
    return tuple(out) if out else (0,)


def fetch_remote_version() -> str | None:
    """Fetch the VERSION file content from GitHub."""
    if not REMOTE_VERSION_URL:
        return None
    req = Request(REMOTE_VERSION_URL, headers={"User-Agent": "Dash-Updater/1.0"})
    try:
        with urlopen(req, timeout=10) as resp:
            return resp.read().decode("utf-8").strip()
    except (URLError, HTTPError, OSError):
        return None


def read_local_version() -> str:
    """Read the local VERSION file."""
    try:
        return VERSION_FILE.read_text(encoding="utf-8").strip()
    except OSError:
        return "0.0.0"


def is_newer(remote: str, local: str) -> bool:
    """Return True if remote version is strictly greater than local."""
    r = parse_version(remote)
    l = parse_version(local)
    return r > l


def git_pull(cwd: Path) -> bool:
    """Run git pull in cwd. Return True on success."""
    try:
        subprocess.run(
            ["git", "pull", "origin", GITHUB_BRANCH],
            cwd=cwd,
            check=True,
            capture_output=True,
            text=True,
            timeout=60,
        )
        return True
    except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
        return False


def main() -> int:
    if not GITHUB_REPO:
        print("GITHUB_REPO is not set (e.g. export GITHUB_REPO=owner/repo).", file=sys.stderr)
        return 1

    local = read_local_version()
    remote = fetch_remote_version()

    if remote is None:
        print("Could not fetch remote VERSION (check repo, branch, and network).", file=sys.stderr)
        return 2

    if not is_newer(remote, local):
        print(f"Up to date: local={local} remote={remote}")
        return 0

    print(f"Update available: local={local} remote={remote}. Pulling...")
    if not git_pull(REPO_DIR):
        print("git pull failed.", file=sys.stderr)
        return 3

    # Re-read and report
    new_local = read_local_version()
    print(f"Updated to {new_local}.")

    post = os.environ.get("POST_UPDATE_CMD", "").strip()
    if post:
        try:
            subprocess.run(post, shell=True, cwd=REPO_DIR, timeout=30)
        except subprocess.TimeoutExpired:
            print("POST_UPDATE_CMD timed out.", file=sys.stderr)

    return 0


if __name__ == "__main__":
    sys.exit(main())
