from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime


@dataclass(frozen=True)
class RejectedMatchSample:
    reason: str
    match_id: str | None
    tournament_id: str | None
    raw_date: str | None
    player_1: str | None
    player_1_url: str | None
    player_1_score: str | None
    player_2: str | None
    player_2_url: str | None
    player_2_score: str | None
    walkover: str | None


@dataclass(frozen=True)
class NormalizedMatch:
    match_id: str
    played_at: datetime
    player_a_id: str
    player_a_name: str
    player_b_id: str
    player_b_name: str
    frames_a: int
    frames_b: int
    tournament_id: str | None = None
    tournament_name: str | None = None
    tournament_season: str | None = None
    tournament_category: str | None = None
    stage: str | None = None


@dataclass(frozen=True)
class IngestionStats:
    total_db_matches: int = 0
    usable_matches: int = 0
    rejected_matches: int = 0
    walkovers: int = 0
    malformed_scores: int = 0
    missing_dates: int = 0
    missing_players: int = 0
    duplicate_player_ids: int = 0
    unique_players: int = 0
    earliest_match: datetime | None = None
    latest_match: datetime | None = None
    rejection_reasons: dict[str, int] = field(default_factory=dict)
    rejected_samples: list[RejectedMatchSample] = field(default_factory=list)


@dataclass(frozen=True)
class RankingRow:
    rank: int
    player_id: str
    player_name: str
    rating: float
    match_elo: float
    frame_elo: float
    matches_played: int
    last_played_at: datetime


@dataclass(frozen=True)
class PlayerRating:
    player_id: str
    player_name: str
    match_elo: float
    frame_elo: float
    matches_played: int
    last_played_at: datetime


@dataclass(frozen=True)
class PlayerSummary:
    player_id: str
    player_name: str
    matches_played: int
    first_played_at: datetime
    last_played_at: datetime
