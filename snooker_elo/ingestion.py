from __future__ import annotations

import sqlite3
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

from .models import IngestionStats, NormalizedMatch, RejectedMatchSample

FALSE_VALUES = {"", "0", "false", "f", "no", "n", "none", "null"}


def ingest_snookerdb(db_path: str | Path, sample_limit: int = 50) -> tuple[list[NormalizedMatch], IngestionStats]:
    """Read SnookerDB matches into deterministic chronological match records."""
    path = Path(db_path)
    if not path.exists():
        raise FileNotFoundError(f"SnookerDB database not found: {path}")

    with sqlite3.connect(path) as conn:
        conn.row_factory = sqlite3.Row
        total = conn.execute("SELECT COUNT(*) FROM matches").fetchone()[0]
        rows = conn.execute(
            """
            SELECT
                m.tourn_id,
                m.match_id,
                m.date,
                m.stage,
                m.player_1_score,
                m.player_2_score,
                m.player_1,
                m.player_1_url,
                m.player_2,
                m.player_2_url,
                m.walkover,
                t.name AS tournament_name,
                t.season AS tournament_season,
                t.category AS tournament_category,
                t.start_date AS tournament_start_date,
                t.end_date AS tournament_end_date
            FROM matches AS m
            LEFT JOIN tournament AS t ON t.tourn_id = m.tourn_id
            """
        ).fetchall()

    matches: list[NormalizedMatch] = []
    reasons: Counter[str] = Counter()
    rejected_samples: list[RejectedMatchSample] = []
    unique_players: set[str] = set()
    player_names_by_id: dict[str, set[str]] = {}

    for row in rows:
        if _is_walkover(row["walkover"]):
            _reject("walkover", row, reasons, rejected_samples, sample_limit)
            continue

        frames_a = _parse_int(row["player_1_score"])
        frames_b = _parse_int(row["player_2_score"])
        if frames_a is None or frames_b is None or frames_a < 0 or frames_b < 0 or frames_a + frames_b == 0:
            _reject("malformed_scores", row, reasons, rejected_samples, sample_limit)
            continue

        played_at = _parse_date(row["date"]) or _parse_date(row["tournament_start_date"]) or _parse_date(
            row["tournament_end_date"]
        )
        if played_at is None:
            _reject("missing_dates", row, reasons, rejected_samples, sample_limit)
            continue

        player_a_id = _player_id(row["player_1_url"], row["player_1"])
        player_b_id = _player_id(row["player_2_url"], row["player_2"])
        player_a_name = _clean_text(row["player_1"])
        player_b_name = _clean_text(row["player_2"])
        if not player_a_id or not player_b_id or not player_a_name or not player_b_name or player_a_id == player_b_id:
            _reject("missing_players", row, reasons, rejected_samples, sample_limit)
            continue

        unique_players.update((player_a_id, player_b_id))
        player_names_by_id.setdefault(player_a_id, set()).add(player_a_name)
        player_names_by_id.setdefault(player_b_id, set()).add(player_b_name)
        matches.append(
            NormalizedMatch(
                match_id=str(row["match_id"]),
                played_at=played_at,
                player_a_id=player_a_id,
                player_a_name=player_a_name,
                player_b_id=player_b_id,
                player_b_name=player_b_name,
                frames_a=frames_a,
                frames_b=frames_b,
                tournament_id=_clean_text(row["tourn_id"]),
                tournament_name=_clean_text(row["tournament_name"]),
                tournament_season=_clean_text(row["tournament_season"]),
                tournament_category=_clean_text(row["tournament_category"]),
                stage=_clean_text(row["stage"]),
            )
        )

    matches.sort(
        key=lambda match: (
            match.played_at,
            match.tournament_id or "",
            _sortable_id(match.match_id),
            match.match_id,
            match.player_a_id,
            match.player_b_id,
        )
    )

    stats = IngestionStats(
        total_db_matches=total,
        usable_matches=len(matches),
        rejected_matches=sum(reasons.values()),
        walkovers=reasons["walkover"],
        malformed_scores=reasons["malformed_scores"],
        missing_dates=reasons["missing_dates"],
        missing_players=reasons["missing_players"],
        duplicate_player_ids=sum(1 for names in player_names_by_id.values() if len(names) > 1),
        unique_players=len(unique_players),
        earliest_match=matches[0].played_at if matches else None,
        latest_match=matches[-1].played_at if matches else None,
        rejection_reasons=dict(reasons),
        rejected_samples=rejected_samples,
    )
    return matches, stats


def _reject(
    reason: str,
    row: sqlite3.Row,
    reasons: Counter[str],
    rejected_samples: list[RejectedMatchSample],
    sample_limit: int,
) -> None:
    reasons[reason] += 1
    if len(rejected_samples) >= sample_limit:
        return
    rejected_samples.append(
        RejectedMatchSample(
            reason=reason,
            match_id=_clean_text(row["match_id"]),
            tournament_id=_clean_text(row["tourn_id"]),
            raw_date=_clean_text(row["date"]),
            player_1=_clean_text(row["player_1"]),
            player_1_url=_clean_text(row["player_1_url"]),
            player_1_score=_clean_text(row["player_1_score"]),
            player_2=_clean_text(row["player_2"]),
            player_2_url=_clean_text(row["player_2_url"]),
            player_2_score=_clean_text(row["player_2_score"]),
            walkover=_clean_text(row["walkover"]),
        )
    )


def _clean_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _is_walkover(value: Any) -> bool:
    if value is None:
        return False
    return str(value).strip().lower() not in FALSE_VALUES


def _parse_int(value: Any) -> int | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        return int(text)
    except ValueError:
        return None


def _parse_date(value: Any) -> datetime | None:
    text = _clean_text(value)
    if text is None:
        return None

    candidates = _date_candidates(text)
    formats = (
        "%Y-%m-%d",
        "%Y/%m/%d",
        "%d/%m/%Y",
        "%d-%m-%Y",
        "%d %b %Y",
        "%d %B %Y",
        "%b %d %Y",
        "%B %d %Y",
        "%Y",
    )
    for candidate in candidates:
        iso_candidate = candidate.replace("Z", "+00:00")
        try:
            parsed = datetime.fromisoformat(iso_candidate)
            return parsed.replace(tzinfo=None)
        except ValueError:
            pass
        for fmt in formats:
            try:
                return datetime.strptime(candidate, fmt)
            except ValueError:
                continue
    return None


def _date_candidates(text: str) -> Iterable[str]:
    normalized = " ".join(text.replace(",", " ").split())
    yield normalized
    if "T" in normalized:
        yield normalized.split("T", 1)[0]
    if " - " in normalized:
        yield normalized.split(" - ", 1)[0]
    lower = normalized.lower()
    if " to " in lower:
        yield normalized[: lower.index(" to ")]


def _player_id(player_url: Any, player_name: Any) -> str | None:
    url = _clean_text(player_url)
    if url:
        return url
    name = _clean_text(player_name)
    if name:
        return f"name:{name.casefold()}"
    return None


def _sortable_id(value: str) -> tuple[int, int | str]:
    try:
        return (0, int(value))
    except ValueError:
        return (1, value)
