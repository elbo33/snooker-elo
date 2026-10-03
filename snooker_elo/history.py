from __future__ import annotations

import sqlite3
from collections import defaultdict
from dataclasses import asdict
from datetime import date, datetime, time
from pathlib import Path
from typing import Iterable, Literal

from .ingestion import ingest_snookerdb
from .models import IngestionStats, NormalizedMatch, PlayerRating, PlayerSummary, RankingRow
from .ratings import EloEngine, RatingEvent

RatingKind = Literal["match", "frame"]


def build_history(
    source_db: str | Path = "data/snookerdb.db",
    output_db: str | Path = "output/snooker_elo_history.sqlite",
) -> IngestionStats:
    matches, stats = ingest_snookerdb(source_db)
    events = rate_matches(matches)
    persist_history(output_db, events, stats)
    return stats


def rate_matches(matches: Iterable[NormalizedMatch]) -> list[RatingEvent]:
    engine = EloEngine()
    for match in matches:
        engine.process_match(
            match_id=match.match_id,
            played_at=match.played_at,
            player_a=match.player_a_id,
            player_b=match.player_b_id,
            frames_a=match.frames_a,
            frames_b=match.frames_b,
            player_a_name=match.player_a_name,
            player_b_name=match.player_b_name,
        )
    return engine.events


def persist_history(output_db: str | Path, events: Iterable[RatingEvent], stats: IngestionStats) -> None:
    path = Path(output_db)
    path.parent.mkdir(parents=True, exist_ok=True)

    with sqlite3.connect(path) as conn:
        conn.execute("PRAGMA foreign_keys = ON")
        _create_schema(conn)
        conn.execute("DELETE FROM build_metadata")
        conn.execute("DELETE FROM rejected_match_samples")
        conn.execute("DELETE FROM rating_events")
        conn.execute("DELETE FROM players")

        player_names: dict[str, str] = {}
        event_rows = []
        for event in events:
            player_id = event.player_id or event.player
            opponent_id = event.opponent_id or event.opponent
            player_name = event.player_name or event.player
            opponent_name = event.opponent_name or event.opponent
            player_names.setdefault(player_id, player_name)
            player_names.setdefault(opponent_id, opponent_name)
            event_rows.append(
                (
                    event.match_id,
                    event.played_at.isoformat(),
                    player_id,
                    player_name,
                    opponent_id,
                    opponent_name,
                    event.frames_won,
                    event.frames_lost,
                    event.match_elo_before,
                    event.match_elo_after,
                    event.frame_elo_before,
                    event.frame_elo_after,
                )
            )

        conn.executemany(
            "INSERT INTO players (player_id, player_name) VALUES (?, ?)",
            sorted(player_names.items()),
        )
        conn.executemany(
            """
            INSERT INTO rating_events (
                match_id,
                played_at,
                player_id,
                player_name,
                opponent_id,
                opponent_name,
                frames_won,
                frames_lost,
                match_elo_before,
                match_elo_after,
                frame_elo_before,
                frame_elo_after
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            event_rows,
        )
        for key, value in _metadata_rows(stats):
            conn.execute("INSERT INTO build_metadata (key, value) VALUES (?, ?)", (key, value))
        conn.executemany(
            """
            INSERT INTO rejected_match_samples (
                reason,
                match_id,
                tournament_id,
                raw_date,
                player_1,
                player_1_url,
                player_1_score,
                player_2,
                player_2_url,
                player_2_score,
                walkover
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    sample.reason,
                    sample.match_id,
                    sample.tournament_id,
                    sample.raw_date,
                    sample.player_1,
                    sample.player_1_url,
                    sample.player_1_score,
                    sample.player_2,
                    sample.player_2_url,
                    sample.player_2_score,
                    sample.walkover,
                )
                for sample in stats.rejected_samples
            ],
        )
        conn.commit()


class HistoricalRatings:
    def __init__(self, db_path: str | Path) -> None:
        self.db_path = Path(db_path)

    def rankings_at(self, when: datetime | date | str, rating: RatingKind = "match", limit: int = 100) -> list[RankingRow]:
        rating_column = _rating_column(rating)
        cutoff = _coerce_datetime(when).isoformat()
        sql = f"""
            WITH latest AS (
                SELECT
                    event_id,
                    player_id,
                    player_name,
                    match_elo_after,
                    frame_elo_after,
                    played_at,
                    ROW_NUMBER() OVER (
                        PARTITION BY player_id
                        ORDER BY played_at DESC, event_id DESC
                    ) AS rn,
                    COUNT(*) OVER (PARTITION BY player_id) AS matches_played
                FROM rating_events
                WHERE played_at <= ?
            )
            SELECT
                player_id,
                player_name,
                match_elo_after,
                frame_elo_after,
                played_at,
                matches_played,
                RANK() OVER (ORDER BY {rating_column} DESC) AS rank
            FROM latest
            WHERE rn = 1
            ORDER BY rank ASC, {rating_column} DESC, player_name ASC, player_id ASC
            LIMIT ?
        """
        with self._connect() as conn:
            rows = conn.execute(sql, (cutoff, limit)).fetchall()
        return [_ranking_row(row, rating) for row in rows]

    def top_n_at(self, when: datetime | date | str, n: int = 10, rating: RatingKind = "match") -> list[RankingRow]:
        return self.rankings_at(when, rating=rating, limit=n)

    def all_time_peaks(self, rating: RatingKind = "match", limit: int = 10) -> list[dict[str, object]]:
        rating_column = _rating_column(rating)
        with self._connect() as conn:
            rows = conn.execute(
                f"""
                WITH ranked AS (
                    SELECT
                        player_id,
                        player_name,
                        played_at,
                        match_elo_after,
                        frame_elo_after,
                        {rating_column} AS peak_rating,
                        ROW_NUMBER() OVER (
                            PARTITION BY player_id
                            ORDER BY {rating_column} DESC, played_at ASC, event_id ASC
                        ) AS rn
                    FROM rating_events
                )
                SELECT
                    player_id,
                    player_name,
                    played_at,
                    match_elo_after,
                    frame_elo_after,
                    peak_rating
                FROM ranked
                WHERE rn = 1
                ORDER BY peak_rating DESC, played_at ASC, player_name ASC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        return [
            {
                "player_id": row["player_id"],
                "player_name": row["player_name"],
                "date": datetime.fromisoformat(row["played_at"]),
                "rating": float(row["peak_rating"]),
                "match_elo": float(row["match_elo_after"]),
                "frame_elo": float(row["frame_elo_after"]),
            }
            for row in rows
        ]

    def period_leaders(
        self,
        rating: RatingKind = "match",
        start_year: int | None = None,
        end_year: int | None = None,
        limit: int = 3,
    ) -> list[dict[str, object]]:
        rating_column = _rating_column(rating)
        metadata = self.build_metadata()
        earliest = _metadata_datetime(metadata.get("earliest_match"))
        latest = _metadata_datetime(metadata.get("latest_match"))
        if earliest is None or latest is None:
            return []

        start = start_year or earliest.year
        end = end_year or latest.year
        cutoffs: list[tuple[int, str]] = []
        for year in range(start, end + 1):
            sample_date = datetime.combine(date(year, 12, 31), time.max)
            if sample_date > latest:
                sample_date = latest
            if sample_date < earliest:
                continue
            cutoffs.append((year, sample_date.isoformat()))

        if not cutoffs:
            return []

        placeholders = ",".join("(?, ?)" for _ in cutoffs)
        params: list[object] = []
        for year, cutoff in cutoffs:
            params.extend([year, cutoff])
        params.append(limit)

        sql = f"""
            WITH years(year, cutoff) AS (
                VALUES {placeholders}
            ),
            current AS (
                SELECT
                    years.year,
                    years.cutoff,
                    rating_events.player_id,
                    rating_events.player_name,
                    rating_events.match_elo_after,
                    rating_events.frame_elo_after,
                    rating_events.played_at
                FROM years
                CROSS JOIN players
                JOIN rating_events ON rating_events.event_id = (
                    SELECT latest.event_id
                    FROM rating_events AS latest
                    WHERE latest.player_id = players.player_id
                      AND latest.played_at <= years.cutoff
                    ORDER BY latest.played_at DESC, latest.event_id DESC
                    LIMIT 1
                )
            ),
            ranked AS (
                SELECT
                    *,
                    RANK() OVER (PARTITION BY year ORDER BY {rating_column} DESC) AS rank
                FROM current
            )
            SELECT *
            FROM ranked
            WHERE rank <= ?
            ORDER BY year ASC, rank ASC, player_name ASC, player_id ASC
        """

        grouped: dict[int, dict[str, object]] = {}
        with self._connect() as conn:
            rows = conn.execute(sql, params).fetchall()

        for row in rows:
            period = grouped.setdefault(
                int(row["year"]),
                {"year": int(row["year"]), "date": datetime.fromisoformat(row["cutoff"]), "leaders": []},
            )
            leaders = period["leaders"]
            assert isinstance(leaders, list)
            leaders.append(
                {
                    "rank": int(row["rank"]),
                    "player_id": row["player_id"],
                    "player_name": row["player_name"],
                    "rating": float(row[rating_column]),
                    "match_elo": float(row["match_elo_after"]),
                    "frame_elo": float(row["frame_elo_after"]),
                    "last_played_at": datetime.fromisoformat(row["played_at"]),
                }
            )
        return list(grouped.values())

    def dominance_summary(
        self,
        rating: RatingKind = "match",
        start_year: int | None = None,
        end_year: int | None = None,
        limit: int = 12,
    ) -> list[dict[str, object]]:
        periods = self.period_leaders(rating=rating, start_year=start_year, end_year=end_year, limit=1)
        by_player: dict[str, dict[str, object]] = {}
        current_player: str | None = None
        current_streak = 0

        for period in periods:
            leader = period["leaders"][0]
            assert isinstance(leader, dict)
            row = by_player.setdefault(
                str(leader["player_id"]),
                {
                    "player_id": leader["player_id"],
                    "player_name": leader["player_name"],
                    "years_at_number_one": 0,
                    "first_year": period["year"],
                    "latest_year": period["year"],
                    "longest_streak": 0,
                },
            )
            row["years_at_number_one"] = int(row["years_at_number_one"]) + 1
            row["latest_year"] = period["year"]
            if current_player == leader["player_id"]:
                current_streak += 1
            else:
                current_player = str(leader["player_id"])
                current_streak = 1
            row["longest_streak"] = max(int(row["longest_streak"]), current_streak)

        return sorted(
            by_player.values(),
            key=lambda row: (-int(row["years_at_number_one"]), -int(row["longest_streak"]), str(row["player_name"])),
        )[:limit]

    def build_metadata(self) -> dict[str, str]:
        with self._connect() as conn:
            rows = conn.execute("SELECT key, value FROM build_metadata ORDER BY key").fetchall()
        return {row["key"]: row["value"] for row in rows}

    def rejected_match_samples(self, reason: str | None = None, limit: int = 50) -> list[sqlite3.Row]:
        params: list[object] = []
        where = ""
        if reason is not None:
            where = "WHERE reason = ?"
            params.append(reason)
        params.append(limit)
        with self._connect() as conn:
            return conn.execute(
                f"""
                SELECT *
                FROM rejected_match_samples
                {where}
                ORDER BY sample_id ASC
                LIMIT ?
                """,
                params,
            ).fetchall()

    def players(self, search: str | None = None, limit: int = 100) -> list[PlayerSummary]:
        params: list[object] = []
        where = ""
        if search:
            where = "WHERE lower(players.player_name) LIKE ? OR lower(players.player_id) LIKE ?"
            pattern = f"%{search.lower()}%"
            params.extend([pattern, pattern])
        params.append(limit)
        with self._connect() as conn:
            rows = conn.execute(
                f"""
                SELECT
                    players.player_id,
                    players.player_name,
                    COUNT(rating_events.event_id) AS matches_played,
                    MIN(rating_events.played_at) AS first_played_at,
                    MAX(rating_events.played_at) AS last_played_at
                FROM players
                JOIN rating_events ON rating_events.player_id = players.player_id
                {where}
                GROUP BY players.player_id, players.player_name
                ORDER BY players.player_name ASC, players.player_id ASC
                LIMIT ?
                """,
                params,
            ).fetchall()
        return [_player_summary(row) for row in rows]

    def find_players(self, query: str, limit: int = 20) -> list[PlayerSummary]:
        return self.players(search=query, limit=limit)

    def player_rating_at(self, player_id: str, when: datetime | date | str) -> PlayerRating | None:
        cutoff = _coerce_datetime(when).isoformat()
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT
                    player_id,
                    player_name,
                    match_elo_after,
                    frame_elo_after,
                    played_at,
                    (
                        SELECT COUNT(*)
                        FROM rating_events AS counted
                        WHERE counted.player_id = rating_events.player_id
                          AND counted.played_at <= ?
                    ) AS matches_played
                FROM rating_events
                WHERE player_id = ? AND played_at <= ?
                ORDER BY played_at DESC, event_id DESC
                LIMIT 1
                """,
                (cutoff, player_id, cutoff),
            ).fetchone()
        if row is None:
            return None
        return _player_rating(row)

    def player_rank_at(self, player_id: str, when: datetime | date | str, rating: RatingKind = "match") -> RankingRow | None:
        rating_column = _rating_column(rating)
        cutoff = _coerce_datetime(when).isoformat()
        sql = f"""
            WITH latest AS (
                SELECT
                    event_id,
                    player_id,
                    player_name,
                    match_elo_after,
                    frame_elo_after,
                    played_at,
                    ROW_NUMBER() OVER (
                        PARTITION BY player_id
                        ORDER BY played_at DESC, event_id DESC
                    ) AS rn,
                    COUNT(*) OVER (PARTITION BY player_id) AS matches_played
                FROM rating_events
                WHERE played_at <= ?
            ),
            current AS (
                SELECT *
                FROM latest
                WHERE rn = 1
            ),
            target AS (
                SELECT *
                FROM current
                WHERE player_id = ?
            )
            SELECT
                target.player_id,
                target.player_name,
                target.match_elo_after,
                target.frame_elo_after,
                target.played_at,
                target.matches_played,
                1 + (
                    SELECT COUNT(*)
                    FROM current
                    WHERE {rating_column} > target.{rating_column}
                ) AS rank
            FROM target
            LIMIT 1
        """
        with self._connect() as conn:
            row = conn.execute(sql, (cutoff, player_id)).fetchone()
        if row is None:
            return None
        return _ranking_row(row, rating)

    def player_history(self, player_id: str) -> list[sqlite3.Row]:
        with self._connect() as conn:
            return conn.execute(
                """
                SELECT *
                FROM rating_events
                WHERE player_id = ?
                ORDER BY played_at ASC, event_id ASC
                """,
                (player_id,),
            ).fetchall()

    def compare_players(
        self,
        player_ids: Iterable[str],
        start: datetime | date | str | None = None,
        end: datetime | date | str | None = None,
    ) -> dict[str, list[sqlite3.Row]]:
        players = list(player_ids)
        if not players:
            return {}

        clauses = [f"player_id IN ({','.join('?' for _ in players)})"]
        params: list[object] = list(players)
        if start is not None:
            clauses.append("played_at >= ?")
            params.append(_coerce_datetime(start).isoformat())
        if end is not None:
            clauses.append("played_at <= ?")
            params.append(_coerce_datetime(end).isoformat())

        with self._connect() as conn:
            rows = conn.execute(
                f"""
                SELECT *
                FROM rating_events
                WHERE {' AND '.join(clauses)}
                ORDER BY played_at ASC, event_id ASC
                """,
                params,
            ).fetchall()

        grouped: dict[str, list[sqlite3.Row]] = defaultdict(list)
        for row in rows:
            grouped[row["player_id"]].append(row)
        return dict(grouped)

    def peak_rating(self, player_id: str, rating: RatingKind = "match") -> PlayerRating | None:
        rating_column = _rating_column(rating)
        with self._connect() as conn:
            row = conn.execute(
                f"""
                SELECT
                    player_id,
                    player_name,
                    match_elo_after,
                    frame_elo_after,
                    played_at,
                    (
                        SELECT COUNT(*)
                        FROM rating_events AS counted
                        WHERE counted.player_id = rating_events.player_id
                          AND (
                            counted.played_at < rating_events.played_at
                            OR (
                                counted.played_at = rating_events.played_at
                                AND counted.event_id <= rating_events.event_id
                            )
                          )
                    ) AS matches_played
                FROM rating_events
                WHERE player_id = ?
                ORDER BY {rating_column} DESC, played_at ASC, event_id ASC
                LIMIT 1
                """,
                (player_id,),
            ).fetchone()
        if row is None:
            return None
        return _player_rating(row)

    def peak_rank(self, player_id: str, rating: RatingKind = "match") -> RankingRow | None:
        with self._connect() as conn:
            dates = [
                row["played_at"]
                for row in conn.execute(
                    """
                    SELECT played_at
                    FROM rating_events
                    WHERE player_id = ?
                    ORDER BY played_at ASC, event_id ASC
                    """,
                    (player_id,),
                ).fetchall()
            ]

        best: RankingRow | None = None
        for played_at in dates:
            player_row = self.player_rank_at(player_id, played_at, rating=rating)
            if player_row is not None and (best is None or player_row.rank < best.rank):
                best = player_row
        return best

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn


def _create_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS players (
            player_id TEXT PRIMARY KEY,
            player_name TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS rating_events (
            event_id INTEGER PRIMARY KEY AUTOINCREMENT,
            match_id TEXT NOT NULL,
            played_at TEXT NOT NULL,
            player_id TEXT NOT NULL,
            player_name TEXT NOT NULL,
            opponent_id TEXT NOT NULL,
            opponent_name TEXT NOT NULL,
            frames_won INTEGER NOT NULL,
            frames_lost INTEGER NOT NULL,
            match_elo_before REAL NOT NULL,
            match_elo_after REAL NOT NULL,
            frame_elo_before REAL NOT NULL,
            frame_elo_after REAL NOT NULL
        );

        CREATE TABLE IF NOT EXISTS build_metadata (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS rejected_match_samples (
            sample_id INTEGER PRIMARY KEY AUTOINCREMENT,
            reason TEXT NOT NULL,
            match_id TEXT,
            tournament_id TEXT,
            raw_date TEXT,
            player_1 TEXT,
            player_1_url TEXT,
            player_1_score TEXT,
            player_2 TEXT,
            player_2_url TEXT,
            player_2_score TEXT,
            walkover TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_rating_events_player_date
            ON rating_events (player_id, played_at, event_id);
        CREATE INDEX IF NOT EXISTS idx_rating_events_date
            ON rating_events (played_at, event_id);
        """
    )


def _metadata_rows(stats: IngestionStats) -> list[tuple[str, str]]:
    rows = []
    for key, value in asdict(stats).items():
        if key == "rejected_samples":
            continue
        if isinstance(value, datetime):
            text = value.isoformat()
        else:
            text = str(value)
        rows.append((key, text))
    return rows


def _metadata_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def _rating_column(rating: RatingKind) -> str:
    if rating == "match":
        return "match_elo_after"
    if rating == "frame":
        return "frame_elo_after"
    raise ValueError("rating must be 'match' or 'frame'")


def _coerce_datetime(value: datetime | date | str) -> datetime:
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime.combine(value, time.max)
    parsed = datetime.fromisoformat(value)
    if "T" not in value and len(value) <= 10:
        return datetime.combine(parsed.date(), time.max)
    return parsed


def _ranking_row(row: sqlite3.Row, rating: RatingKind) -> RankingRow:
    match_elo = float(row["match_elo_after"])
    frame_elo = float(row["frame_elo_after"])
    return RankingRow(
        rank=int(row["rank"]),
        player_id=row["player_id"],
        player_name=row["player_name"],
        rating=match_elo if rating == "match" else frame_elo,
        match_elo=match_elo,
        frame_elo=frame_elo,
        matches_played=int(row["matches_played"]),
        last_played_at=datetime.fromisoformat(row["played_at"]),
    )


def _player_rating(row: sqlite3.Row) -> PlayerRating:
    return PlayerRating(
        player_id=row["player_id"],
        player_name=row["player_name"],
        match_elo=float(row["match_elo_after"]),
        frame_elo=float(row["frame_elo_after"]),
        matches_played=int(row["matches_played"]),
        last_played_at=datetime.fromisoformat(row["played_at"]),
    )


def _player_summary(row: sqlite3.Row) -> PlayerSummary:
    return PlayerSummary(
        player_id=row["player_id"],
        player_name=row["player_name"],
        matches_played=int(row["matches_played"]),
        first_played_at=datetime.fromisoformat(row["first_played_at"]),
        last_played_at=datetime.fromisoformat(row["last_played_at"]),
    )
