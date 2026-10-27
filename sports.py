"""Cached MLB and NBA scores without API keys.

Only the background worker calls the public score providers. Display reads and
configuration changes remain local, so a slow connection cannot block controls.
"""

from __future__ import annotations

import copy
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import threading
import time
from typing import Any, Optional
from urllib.parse import urlencode
from urllib.request import Request, urlopen
import uuid
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


REQUEST_TIMEOUT_SECONDS = 8
MAX_RESPONSE_BYTES = 3 * 1024 * 1024
LIVE_REFRESH_SECONDS = 30
IDLE_REFRESH_SECONDS = 300
DEFAULT_CONFIG = {
    "league": "mlb", "favorite_team_ids": [], "favorites_only": False,
    "auto_rotate": True, "rotation_seconds": 15, "timezone": "America/New_York",
    "auto_preview": True,
}

# MLB supplies names, abbreviations and logos; colors remain curated here because
# the public team response does not include brand colors. The roster also keeps
# the companion's team picker useful before the first successful connection.
_MLB_TEAMS = (
    (109, "Arizona Diamondbacks", "AZ", "#A71930"),
    (144, "Atlanta Braves", "ATL", "#CE1141"),
    (133, "Athletics", "ATH", "#003831"),
    (110, "Baltimore Orioles", "BAL", "#DF4601"),
    (111, "Boston Red Sox", "BOS", "#BD3039"),
    (112, "Chicago Cubs", "CHC", "#0E3386"),
    (145, "Chicago White Sox", "CWS", "#27251F"),
    (113, "Cincinnati Reds", "CIN", "#C6011F"),
    (114, "Cleveland Guardians", "CLE", "#E31937"),
    (115, "Colorado Rockies", "COL", "#333366"),
    (116, "Detroit Tigers", "DET", "#0C2340"),
    (117, "Houston Astros", "HOU", "#EB6E1F"),
    (118, "Kansas City Royals", "KC", "#004687"),
    (108, "Los Angeles Angels", "LAA", "#BA0021"),
    (119, "Los Angeles Dodgers", "LAD", "#005A9C"),
    (146, "Miami Marlins", "MIA", "#00A3E0"),
    (158, "Milwaukee Brewers", "MIL", "#12284B"),
    (142, "Minnesota Twins", "MIN", "#D31145"),
    (121, "New York Mets", "NYM", "#002D72"),
    (147, "New York Yankees", "NYY", "#0C2340"),
    (143, "Philadelphia Phillies", "PHI", "#E81828"),
    (134, "Pittsburgh Pirates", "PIT", "#FDB827"),
    (135, "San Diego Padres", "SD", "#2F241D"),
    (137, "San Francisco Giants", "SF", "#FD5A1E"),
    (136, "Seattle Mariners", "SEA", "#005C5C"),
    (138, "St. Louis Cardinals", "STL", "#C41E3A"),
    (139, "Tampa Bay Rays", "TB", "#092C5C"),
    (140, "Texas Rangers", "TEX", "#003278"),
    (141, "Toronto Blue Jays", "TOR", "#134A8E"),
    (120, "Washington Nationals", "WSH", "#AB0003"),
)
MLB_TEAMS = {
    team_id: {"id": team_id, "name": name, "abbreviation": abbreviation,
              "color": color, "logo_url": f"https://www.mlbstatic.com/team-logos/{team_id}.svg"}
    for team_id, name, abbreviation, color in _MLB_TEAMS
}


def _number(value: Any) -> Optional[int]:
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None


class MLBProvider:
    """Normalize MLB's schedule/linescore format behind a league provider."""

    league = "mlb"

    @staticmethod
    def _request(route: str, params: dict) -> dict:
        request = Request("https://statsapi.mlb.com/api/v1/" + route + "?" + urlencode(params),
                          headers={"Accept": "application/json", "User-Agent": "Dash-Sports/1.0"})
        with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            raw = response.read(MAX_RESPONSE_BYTES + 1)
        if len(raw) > MAX_RESPONSE_BYTES:
            raise ValueError("MLB response exceeds the size limit")
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise ValueError("Invalid MLB response")
        return data

    @staticmethod
    def team_metadata(team: dict, known: Optional[dict] = None) -> dict:
        team_id = _number(team.get("id"))
        if team_id is None:
            raise ValueError("MLB team is missing an ID")
        result = copy.deepcopy((known or MLB_TEAMS).get(team_id, {
            "id": team_id, "name": "MLB team", "abbreviation": "MLB", "color": "#63738A",
            "logo_url": f"https://www.mlbstatic.com/team-logos/{team_id}.svg",
        }))
        for key in ("name", "abbreviation"):
            value = team.get(key)
            if isinstance(value, str) and value.strip():
                result[key] = value.strip()[:100]
        return result

    def fetch_teams(self) -> dict:
        data = self._request("teams", {"sportId": 1})
        if not isinstance(data.get("teams"), list) or not data["teams"]:
            raise ValueError("MLB team response is missing its roster")
        result = copy.deepcopy(MLB_TEAMS)
        for team in data["teams"]:
            if isinstance(team, dict) and team.get("active", True):
                metadata = self.team_metadata(team)
                result[metadata["id"]] = metadata
        return result

    @staticmethod
    def game_status(status: dict) -> str:
        detail = str(status.get("detailedState", "")).lower()
        # MLB may classify a postponed or cancelled game as abstract "Final".
        if "postpon" in detail:
            return "postponed"
        if "suspend" in detail:
            return "suspended"
        if "cancel" in detail:
            return "cancelled"
        if "delay" in detail:
            return "delayed"
        abstract = status.get("abstractGameState")
        if abstract == "Final" or detail in {"final", "game over", "completed early"}:
            return "final"
        if abstract == "Live" or detail in {"in progress", "manager challenge", "umpire review"}:
            return "live"
        if abstract == "Preview" or detail in {"scheduled", "pre-game", "warmup"}:
            return "scheduled"
        return "other"

    def normalize_game(self, raw: dict, teams: Optional[dict] = None) -> dict:
        game_id = _number(raw.get("gamePk"))
        if game_id is None:
            raise ValueError("MLB game is missing an ID")
        status_data = raw.get("status") or {}
        status = self.game_status(status_data)
        linescore = raw.get("linescore") or {}
        inning = _number(linescore.get("currentInning"))
        score_teams = linescore.get("teams") or {}
        sides = {}
        for side in ("away", "home"):
            source = raw["teams"][side]
            team = self.team_metadata(source["team"], teams)
            score = _number(source.get("score"))
            if score is None:
                score = _number((score_teams.get(side) or {}).get("runs"))
            # Empty pregame linescores must not look like an underway 0–0 game.
            team["score"] = score if status in {"live", "final"} or inning else None
            record = source.get("leagueRecord") or {}
            wins, losses = _number(record.get("wins")), _number(record.get("losses"))
            team["record"] = f"{wins}–{losses}" if wins is not None and losses is not None else ""
            sides[side] = team
        offense = linescore.get("offense") or {}
        return {
            "id": game_id, "league": "mlb", "start_time": None if status_data.get("startTimeTBD") else raw.get("gameDate"),
            "official_date": raw.get("officialDate", ""), "status": status,
            "status_text": "Time TBD" if status == "scheduled" and status_data.get("startTimeTBD")
                           else str(status_data.get("detailedState") or "Scheduled"),
            "inning": inning, "inning_half": linescore.get("inningState") or linescore.get("inningHalf") or "",
            "outs": _number(linescore.get("outs")), "balls": _number(linescore.get("balls")),
            "strikes": _number(linescore.get("strikes")),
            "bases": {base: bool(offense.get(base)) for base in ("first", "second", "third")},
            "away": sides["away"], "home": sides["home"], "venue": (raw.get("venue") or {}).get("name", ""),
            "doubleheader": raw.get("doubleHeader", "N") in {"Y", "S"},
            "game_number": _number(raw.get("gameNumber")) or 1,
        }

    def fetch_schedule(self, date: str, teams: Optional[dict] = None) -> list:
        previous_date = (datetime.fromisoformat(date) - timedelta(days=1)).date().isoformat()
        data = self._request("schedule", {"sportId": 1, "startDate": previous_date, "endDate": date,
                                          "hydrate": "team,linescore"})
        if not isinstance(data.get("dates"), list):
            raise ValueError("MLB schedule response is missing its dates")
        games = {}
        for day in data["dates"]:
            if not isinstance(day, dict) or not isinstance(day.get("games"), list):
                raise ValueError("Invalid MLB schedule day")
            for raw in day["games"]:
                game = self.normalize_game(raw, teams)
                # A West Coast game can still be underway after midnight in the
                # selected timezone. Keep it until completion. Use the schedule
                # container's date for resumed games, whose officialDate may be
                # their original date from earlier in the season.
                schedule_date = day.get("date") or game["official_date"]
                if schedule_date != date and not (
                        schedule_date == previous_date and game["status"] in {"live", "delayed"}):
                    continue
                # A game resumed on another date may appear more than once.
                games[game["id"]] = game
        return sorted(games.values(), key=lambda game: (game["start_time"] or "9999", game["game_number"], game["id"]))


_NBA_TEAMS = (
    (1, 'Atlanta Hawks', 'ATL', '#c8102e'),
    (2, 'Boston Celtics', 'BOS', '#008348'),
    (17, 'Brooklyn Nets', 'BKN', '#000000'),
    (30, 'Charlotte Hornets', 'CHA', '#008ca8'),
    (4, 'Chicago Bulls', 'CHI', '#ce1141'),
    (5, 'Cleveland Cavaliers', 'CLE', '#860038'),
    (6, 'Dallas Mavericks', 'DAL', '#0064b1'),
    (7, 'Denver Nuggets', 'DEN', '#0e2240'),
    (8, 'Detroit Pistons', 'DET', '#1d428a'),
    (9, 'Golden State Warriors', 'GS', '#fdb927'),
    (10, 'Houston Rockets', 'HOU', '#ce0e2d'),
    (11, 'Indiana Pacers', 'IND', '#0c2340'),
    (12, 'LA Clippers', 'LAC', '#12173f'),
    (13, 'Los Angeles Lakers', 'LAL', '#552583'),
    (29, 'Memphis Grizzlies', 'MEM', '#5d76a9'),
    (14, 'Miami Heat', 'MIA', '#98002e'),
    (15, 'Milwaukee Bucks', 'MIL', '#00471b'),
    (16, 'Minnesota Timberwolves', 'MIN', '#266092'),
    (3, 'New Orleans Pelicans', 'NO', '#0a2240'),
    (18, 'New York Knicks', 'NY', '#1d428a'),
    (25, 'Oklahoma City Thunder', 'OKC', '#007ac1'),
    (19, 'Orlando Magic', 'ORL', '#0150b5'),
    (20, 'Philadelphia 76ers', 'PHI', '#1d428a'),
    (21, 'Phoenix Suns', 'PHX', '#29127a'),
    (22, 'Portland Trail Blazers', 'POR', '#e03a3e'),
    (23, 'Sacramento Kings', 'SAC', '#5a2d81'),
    (24, 'San Antonio Spurs', 'SA', '#000000'),
    (28, 'Toronto Raptors', 'TOR', '#d91244'),
    (26, 'Utah Jazz', 'UTAH', '#4e008e'),
    (27, 'Washington Wizards', 'WSH', '#e31837'),
)
NBA_TEAMS = {
    team_id: {"id": team_id, "name": name, "abbreviation": abbreviation,
              "color": color, "league": "nba",
              "logo_url": f"https://a.espncdn.com/i/teamlogos/nba/500/{team_id}.png"}
    for team_id, name, abbreviation, color in _NBA_TEAMS
}
LEAGUE_TEAMS = {"mlb": MLB_TEAMS, "nba": NBA_TEAMS}


class NBAProvider:
    """ESPN's public, keyless NBA feed (unofficial; may change upstream)."""

    league = "nba"

    @staticmethod
    def _request(route, params):
        request = Request("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/"
                          + route + "?" + urlencode(params),
                          headers={"Accept": "application/json", "User-Agent": "Dash-Sports/1.0"})
        with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            raw = response.read(MAX_RESPONSE_BYTES + 1)
        if len(raw) > MAX_RESPONSE_BYTES:
            raise ValueError("NBA response exceeds the size limit")
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise ValueError("Invalid NBA response")
        return data

    def fetch_teams(self):
        # Keep the picker available offline and avoid a separate metadata request.
        return copy.deepcopy(NBA_TEAMS)

    def normalize_game(self, raw, teams=None):
        game_id = int(raw["id"])
        if game_id <= 0:
            raise ValueError("Invalid NBA game ID")
        competition = raw["competitions"][0]
        data = competition.get("status") or raw.get("status") or {}
        kind = data.get("type") or {}
        name = str(kind.get("name", "")).lower()
        status = next((value for token, value in (("postpon", "postponed"),
            ("cancel", "cancelled"), ("suspend", "suspended"), ("delay", "delayed"))
            if token in name), None)
        status = status or ("final" if kind.get("completed") else
                           {"pre": "scheduled", "in": "live", "post": "final"}.get(kind.get("state"), "other"))
        period = _number(data.get("period"))
        clock = str(data.get("displayClock") or "")[:20]
        phase = f"Q{period}" if period and period <= 4 else f"OT{period - 4}" if period else ""
        if name in {"status_halftime", "status_end_period"}:
            phase = str(kind.get("shortDetail") or kind.get("description") or phase)
        elif phase and clock:
            phase += f" · {clock}"
        sides = {}
        for source in competition["competitors"]:
            side = source.get("homeAway")
            if side not in {"away", "home"}:
                continue
            team_id = int(source["team"]["id"])
            team = copy.deepcopy((teams or NBA_TEAMS).get(team_id))
            if not team:
                raise ValueError("Unknown NBA team")
            value = str(source.get("score", ""))
            team["score"] = int(value) if value.isdigit() and (status in {"live", "final"} or period) else None
            records = source.get("records") or []
            team["record"] = next((str(record.get("summary") or "") for record in records
                                   if record.get("type") == "total" or record.get("name") == "overall"), "")
            sides[side] = team
        if set(sides) != {"away", "home"}:
            raise ValueError("NBA game is missing a team")
        start = competition.get("date") or raw.get("date")
        return {"id": game_id, "league": "nba", "start_time": start if competition.get("timeValid", True) else None,
                "official_date": str(start or "")[:10], "status": status,
                "status_text": phase if status == "live" else str(kind.get("shortDetail") or kind.get("description") or "Scheduled"),
                "period": period, "clock": clock, "inning": None, "inning_half": "",
                "outs": None, "balls": None, "strikes": None, "bases": {},
                "away": sides["away"], "home": sides["home"],
                "venue": (competition.get("venue") or {}).get("fullName", ""),
                "doubleheader": False, "game_number": 1}

    def fetch_schedule(self, date, teams=None):
        previous = (datetime.fromisoformat(date) - timedelta(days=1)).date().isoformat()
        games = {}
        for day in (previous, date):
            data = self._request("scoreboard", {"dates": day.replace("-", ""), "limit": 100})
            if not isinstance(data.get("events"), list):
                raise ValueError("NBA response is missing its games")
            for raw in data["events"]:
                game = self.normalize_game(raw, teams)
                if day == date or game["status"] in {"live", "delayed"}:
                    games[game["id"]] = game
        return sorted(games.values(), key=lambda game: (game["start_time"] or "9999", game["id"]))


class SportsManager:
    """Own local settings, a last-good scoreboard, and one polling worker."""

    def __init__(self, base_dir: Path, *, provider=None, clock=None, monotonic=None):
        self.config_path = Path(base_dir) / "sports_config.json"
        self._providers = {"mlb": provider or MLBProvider(), "nba": NBAProvider()}
        self._provider = self._providers["mlb"]
        self._generation = 0
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        self._monotonic = monotonic or time.monotonic
        self._lock = threading.RLock()
        self._sync_lock = threading.Lock()
        self._stop = threading.Event()
        self._wake = threading.Event()
        self._thread = None
        self._config = copy.deepcopy(DEFAULT_CONFIG)
        self._teams = copy.deepcopy(MLB_TEAMS)
        self._teams_date = None
        self._games = []
        self._date = None
        self._selected_game_id = None
        self._rotation_started = self._monotonic()
        self._last_updated = None
        self._last_success = None
        self._last_attempt = None
        self._last_attempt_date = None
        self._next_refresh = 0
        self._refresh_requested = True
        self._refresh_seconds = IDLE_REFRESH_SECONDS
        self._failures = 0
        self._loading = False
        self._error = None
        self._load_config()
        self._provider = self._providers[self._config["league"]]
        self._teams = copy.deepcopy(LEAGUE_TEAMS[self._config["league"]])

    @staticmethod
    def _validate_config(config: dict) -> dict:
        if not isinstance(config, dict) or any(key not in DEFAULT_CONFIG for key in config):
            raise ValueError("Unknown sports setting")
        result = copy.deepcopy(DEFAULT_CONFIG)
        result.update(config)
        if not isinstance(result["league"], str) or result["league"] not in LEAGUE_TEAMS:
            raise ValueError("Choose MLB or NBA")
        roster = LEAGUE_TEAMS[result["league"]]
        favorites = result["favorite_team_ids"]
        if (not isinstance(favorites, list) or len(favorites) > len(roster)
                or any(type(team_id) is not int or team_id not in roster for team_id in favorites)):
            raise ValueError("Choose valid favorite teams for the selected league")
        result["favorite_team_ids"] = list(dict.fromkeys(favorites))
        for key in ("favorites_only", "auto_rotate", "auto_preview"):
            if not isinstance(result[key], bool):
                raise ValueError(f"{key} must be true or false")
        interval = result["rotation_seconds"]
        if type(interval) is not int or not 5 <= interval <= 300:
            raise ValueError("Game rotation must be between 5 and 300 seconds")
        zone = result["timezone"]
        if not isinstance(zone, str) or len(zone) > 100:
            raise ValueError("Choose a valid time zone")
        try:
            ZoneInfo(zone)
        except (ValueError, ZoneInfoNotFoundError):
            raise ValueError("Choose a valid IANA time zone, such as America/New_York") from None
        return result

    def _load_config(self):
        try:
            with self.config_path.open("rb") as handle:
                raw = handle.read(16385)
            if len(raw) > 16384:
                raise ValueError("Settings are too large")
            self._config = self._validate_config(json.loads(raw))
        except FileNotFoundError:
            pass
        except (OSError, ValueError, TypeError):
            self._error = "Saved sports settings could not be loaded. Default settings are in use."

    def _today(self):
        return self._clock().astimezone(ZoneInfo(self._config["timezone"])).date().isoformat()

    def get_config(self):
        with self._lock:
            return copy.deepcopy(self._config)

    def update_config(self, updates):
        if not isinstance(updates, dict):
            raise ValueError("Sports settings must be an object")
        with self._lock:
            if updates.get("league", self._config["league"]) != self._config["league"]:
                updates = {"favorite_team_ids": [], **updates}
            config = self._validate_config({**self._config, **updates})
            temporary = self.config_path.with_name(self.config_path.name + "." + uuid.uuid4().hex + ".tmp")
            try:
                self.config_path.parent.mkdir(parents=True, exist_ok=True)
                with temporary.open("x", encoding="utf-8") as handle:
                    json.dump(config, handle, separators=(",", ":"), allow_nan=False)
                    handle.flush()
                    os.fsync(handle.fileno())
                os.replace(temporary, self.config_path)
            finally:
                temporary.unlink(missing_ok=True)
            previous_zone = self._config["timezone"]
            league_changed = self._config["league"] != config["league"]
            self._config = config
            if league_changed:
                self._provider = self._providers[config["league"]]
                self._teams = copy.deepcopy(LEAGUE_TEAMS[config["league"]])
                self._teams_date = self._date = self._selected_game_id = None
                self._games = []
                self._last_updated = self._last_success = self._last_attempt = self._last_attempt_date = None
                self._error = None
                self._failures = 0
                self._next_refresh = 0
            self._rotation_started = self._monotonic()
            self._ensure_selection(self._visible_games())
            if previous_zone != config["timezone"] or league_changed:
                self._generation += 1
                self._refresh_requested = True
                self._wake.set()
            return copy.deepcopy(config)

    def _visible_games(self):
        favorites = set(self._config["favorite_team_ids"])
        games = self._games
        if self._config["favorites_only"]:
            games = [game for game in games if game["away"]["id"] in favorites or game["home"]["id"] in favorites]
        # Favorite games are easy to find, with live games first within each group.
        return sorted(games, key=lambda game: (
            not (game["away"]["id"] in favorites or game["home"]["id"] in favorites),
            {"live": 0, "delayed": 1, "scheduled": 2, "suspended": 3, "final": 4}.get(game["status"], 5),
            game["start_time"] or "9999", game["game_number"], game["id"]))

    def _ensure_selection(self, games):
        if not any(game["id"] == self._selected_game_id for game in games):
            self._selected_game_id = games[0]["id"] if games else None
            self._rotation_started = self._monotonic()

    def select_game(self, delta):
        if type(delta) is not int:
            raise ValueError("Game direction must be an integer")
        with self._lock:
            games = self._visible_games()
            self._ensure_selection(games)
            if games:
                index = next(i for i, game in enumerate(games) if game["id"] == self._selected_game_id)
                self._selected_game_id = games[(index + delta) % len(games)]["id"]
            self._rotation_started = self._monotonic()
            return self._selected_game_id

    def select_game_id(self, game_id):
        if type(game_id) is not int:
            raise ValueError("Game ID must be an integer")
        with self._lock:
            if not any(game["id"] == game_id for game in self._visible_games()):
                return False
            self._selected_game_id = game_id
            self._rotation_started = self._monotonic()
            return True

    def get_payload(self):
        with self._lock:
            today = self._today()
            if today != self._last_attempt_date:
                self._wake.set()
            games = self._visible_games()
            self._ensure_selection(games)
            now = self._monotonic()
            if (self._config["auto_rotate"] and len(games) > 1
                    and now - self._rotation_started >= self._config["rotation_seconds"]):
                self.select_game(1)
            selected = next((game for game in games if game["id"] == self._selected_game_id), None)
            stale = self._last_updated is not None and (
                self._error is not None or self._date != today
                or now - self._last_success > self._refresh_seconds * 2)
            return copy.deepcopy({
                "type": "sports", "id": "sports", "name": "Sports", "league": self._config["league"],
                "date": self._date or today, "games": games, "selected_game_id": self._selected_game_id,
                "available_teams": LEAGUE_TEAMS,
                "selected_game": selected, "teams": sorted(self._teams.values(), key=lambda team: team["name"]),
                "config": self._config, "loading": self._loading or (self._last_attempt is None and not self._error),
                "stale": stale, "error": self._error, "last_updated": self._last_updated,
                "refresh_seconds": self._refresh_seconds,
                "live_followed_games": [game for game in self._visible_games()
                    if game["status"] == "live" and (game["away"]["id"] in self._config["favorite_team_ids"]
                    or game["home"]["id"] in self._config["favorite_team_ids"])],
            })

    def request_refresh(self):
        with self._lock:
            self._refresh_requested = True
        self._wake.set()

    def _poll_interval(self, games):
        for game in games:
            if game["status"] in {"live", "delayed"}:
                return LIVE_REFRESH_SECONDS
            if game["status"] == "scheduled" and game["start_time"]:
                try:
                    start = datetime.fromisoformat(game["start_time"].replace("Z", "+00:00"))
                    if start.tzinfo is not None and (start - self._clock()).total_seconds() <= 600:
                        return LIVE_REFRESH_SECONDS
                except (TypeError, ValueError):
                    pass
        return IDLE_REFRESH_SECONDS

    def start(self):
        with self._lock:
            if self._thread and self._thread.is_alive():
                return
            self._stop.clear()
            self._thread = threading.Thread(target=self._run, name="dash-sports", daemon=True)
            self._thread.start()

    def stop(self):
        self._stop.set()
        self._wake.set()
        thread = self._thread
        if thread and thread is not threading.current_thread():
            thread.join(timeout=1)

    def _run(self):
        while not self._stop.is_set():
            with self._lock:
                now = self._monotonic()
                date_changed = self._today() != self._last_attempt_date
                manual = self._refresh_requested and (self._last_attempt is None or now - self._last_attempt >= 5)
                due = date_changed or manual or now >= self._next_refresh
            if due:
                self._refresh()
            with self._lock:
                wait = max(0.1, min(30, self._next_refresh - self._monotonic()))
                if self._refresh_requested and self._last_attempt is not None:
                    wait = min(wait, max(0.1, 5 - (self._monotonic() - self._last_attempt)))
            self._wake.wait(wait)
            self._wake.clear()

    def _refresh(self):
        # One worker owns network requests. This lock also makes direct test or
        # maintenance refreshes safe without holding the display/config lock.
        if not self._sync_lock.acquire(blocking=False):
            return False
        try:
            with self._lock:
                date = self._today()
                generation = self._generation
                provider = self._provider
                self._loading = True
                self._last_attempt = self._monotonic()
                self._last_attempt_date = date
                self._refresh_requested = False
                teams = copy.deepcopy(self._teams)
                fetch_teams = self._teams_date != date
            if fetch_teams:
                try:
                    teams = provider.fetch_teams()
                    with self._lock:
                        if generation == self._generation:
                            self._teams = teams
                            self._teams_date = date
                except Exception:
                    # A metadata failure must not prevent score updates.
                    pass
            try:
                games = provider.fetch_schedule(date, teams)
            except Exception:
                with self._lock:
                    if generation != self._generation:
                        return False
                    self._failures += 1
                    delay = min(IDLE_REFRESH_SECONDS, LIVE_REFRESH_SECONDS * 2 ** min(self._failures - 1, 4))
                    self._next_refresh = self._monotonic() + delay
                    self._error = "Scores could not be refreshed. Retrying automatically."
                return False
            with self._lock:
                # A timezone edit during an in-flight request must not publish a
                # scoreboard for a date the user is no longer following.
                if date != self._today() or generation != self._generation:
                    self._next_refresh = 0
                    return False
                self._games = games
                self._date = date
                self._last_updated = self._clock().astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
                self._last_success = self._monotonic()
                self._failures = 0
                self._error = None
                self._refresh_seconds = self._poll_interval(games)
                self._next_refresh = self._last_success + self._refresh_seconds
                self._ensure_selection(self._visible_games())
            return True
        finally:
            with self._lock:
                self._loading = False
            self._sync_lock.release()
