from __future__ import annotations

import argparse
import json
import mimetypes
import sqlite3
from dataclasses import asdict, is_dataclass
from datetime import datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from .history import HistoricalRatings

STATIC_DIR = Path(__file__).with_name("static")
CURATED_DYNASTIES = ["Steve Davis", "Stephen Hendry", "Ronnie O'Sullivan", "Judd Trump"]
_DYNASTY_CACHE: dict[tuple[str, int, str], dict[str, object]] = {}


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the local Snooker Elo dashboard.")
    parser.add_argument("--db", default="output/snooker_elo_history.sqlite", help="Historical SQLite database path.")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind.")
    parser.add_argument("--port", default=8000, type=int, help="Port to bind.")
    args = parser.parse_args()

    handler = _handler_factory(Path(args.db))
    server = ThreadingHTTPServer((args.host, args.port), handler)
    print(f"Serving Snooker Elo dashboard at http://{args.host}:{args.port}")
    print(f"Using historical database: {args.db}")
    server.serve_forever()


def _handler_factory(db_path: Path):
    class SnookerEloHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            parsed = urlparse(self.path)
            if parsed.path == "/":
                self._serve_static("index.html", "text/html; charset=utf-8")
                return
            if parsed.path == "/app.js":
                self._serve_static("app.js", "application/javascript; charset=utf-8")
                return
            if parsed.path == "/peak-timelines.js":
                self._serve_static("peak-timelines.js", "application/javascript; charset=utf-8")
                return
            if parsed.path == "/styles.css":
                self._serve_static("styles.css", "text/css; charset=utf-8")
                return
            if parsed.path.startswith("/assets/"):
                self._serve_static(parsed.path.removeprefix("/"), None)
                return
            if parsed.path.startswith("/api/"):
                self._serve_api(parsed.path, parse_qs(parsed.query))
                return
            self.send_error(HTTPStatus.NOT_FOUND)

        def log_message(self, format: str, *args) -> None:
            return

        def _serve_static(self, filename: str, content_type: str | None) -> None:
            path = STATIC_DIR / filename
            if not path.exists() or not path.is_file():
                self.send_error(HTTPStatus.NOT_FOUND)
                return
            body = path.read_bytes()
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", content_type or mimetypes.guess_type(path.name)[0] or "application/octet-stream")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _serve_api(self, path: str, params: dict[str, list[str]]) -> None:
            if not db_path.exists():
                self._json({"error": f"Historical database not found: {db_path}"}, HTTPStatus.NOT_FOUND)
                return
            history = HistoricalRatings(db_path)
            try:
                if path == "/api/metadata":
                    self._json(history.build_metadata())
                elif path == "/api/rankings":
                    self._json(
                        history.rankings_at(
                            _param(params, "date", datetime.now().date().isoformat()),
                            rating=_param(params, "rating", "match"),
                            limit=int(_param(params, "limit", "50")),
                        )
                    )
                elif path == "/api/peaks":
                    self._json(
                        history.all_time_peaks(
                            rating=_param(params, "rating", "match"),
                            limit=int(_param(params, "limit", "10")),
                        )
                    )
                elif path == "/api/players":
                    self._json(history.players(search=_param(params, "search", ""), limit=int(_param(params, "limit", "20"))))
                elif path == "/api/player":
                    player_id = _param(params, "id", "")
                    when = _param(params, "date", datetime.now().date().isoformat())
                    rating = _param(params, "rating", "match")
                    self._json(
                        {
                            "rating": history.player_rating_at(player_id, when),
                            "rank": history.player_rank_at(player_id, when, rating=rating),
                            "peak_rating": history.peak_rating(player_id, rating=rating),
                            "peak_rank": history.peak_rank(player_id, rating=rating),
                            "history": history.player_history(player_id),
                        }
                    )
                elif path == "/api/compare":
                    ids = [value for value in _param(params, "ids", "").split(",") if value]
                    self._json(
                        history.compare_players(
                            ids,
                            start=_optional_param(params, "start"),
                            end=_optional_param(params, "end"),
                        )
                    )
                elif path == "/api/eras":
                    rating = _param(params, "rating", "match")
                    start_year = _optional_int(params, "start_year")
                    end_year = _optional_int(params, "end_year")
                    self._json(
                        {
                            "periods": history.period_leaders(
                                rating=rating,
                                start_year=start_year,
                                end_year=end_year,
                                limit=int(_param(params, "leaders", "3")),
                            ),
                            "dominance": history.dominance_summary(
                                rating=rating,
                                start_year=start_year,
                                end_year=end_year,
                                limit=int(_param(params, "limit", "12")),
                            ),
                        }
                    )
                elif path == "/api/dynasties":
                    rating = _param(params, "rating", "match")
                    self._json(_cached_dynasties(history, db_path, rating))
                elif path == "/api/dynasty":
                    self._json(
                        history.dynasty_dominance(
                            player_id=_optional_param(params, "player_id"),
                            player_name=_param(params, "player_name", "Stephen Hendry"),
                            rating=_param(params, "rating", "match"),
                            compare_player_names=CURATED_DYNASTIES,
                        )
                    )
                else:
                    self.send_error(HTTPStatus.NOT_FOUND)
            except Exception as exc:
                self._json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)

        def _json(self, payload: object, status: HTTPStatus = HTTPStatus.OK) -> None:
            body = json.dumps(_jsonable(payload), separators=(",", ":")).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    return SnookerEloHandler


def _param(params: dict[str, list[str]], name: str, default: str) -> str:
    values = params.get(name)
    return values[0] if values and values[0] else default


def _optional_param(params: dict[str, list[str]], name: str) -> str | None:
    values = params.get(name)
    return values[0] if values and values[0] else None


def _optional_int(params: dict[str, list[str]], name: str) -> int | None:
    value = _optional_param(params, name)
    return int(value) if value is not None else None


def _cached_dynasties(history: HistoricalRatings, db_path: Path, rating: str) -> dict[str, object]:
    resolved = db_path.resolve()
    cache_key = (str(resolved), resolved.stat().st_mtime_ns, rating)
    cached = _DYNASTY_CACHE.get(cache_key)
    if cached is not None:
        return cached

    payload = history.dynasty_collection(CURATED_DYNASTIES, rating=rating, compact=True)
    payload["players"] = CURATED_DYNASTIES
    payload["cache"] = {
        "strategy": "server-side, invalidated when the generated history database timestamp changes",
        "source": str(db_path),
    }
    _DYNASTY_CACHE.clear()
    _DYNASTY_CACHE[cache_key] = payload
    return payload


def _jsonable(value: object) -> object:
    if is_dataclass(value):
        return _jsonable(asdict(value))
    if isinstance(value, sqlite3.Row):
        return {key: _jsonable(value[key]) for key in value.keys()}
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    if isinstance(value, datetime):
        return value.isoformat()
    return value

if __name__ == "__main__":
    main()
