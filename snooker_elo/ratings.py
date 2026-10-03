from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class EloConfig:
    initial_rating: float = 1500.0
    scale: float = 400.0
    match_k: float = 24.0
    frame_k: float = 4.0


@dataclass(frozen=True)
class RatingEvent:
    match_id: str
    played_at: datetime
    player: str
    opponent: str
    frames_won: int
    frames_lost: int
    match_elo_before: float
    match_elo_after: float
    frame_elo_before: float
    frame_elo_after: float
    player_id: str | None = None
    player_name: str | None = None
    opponent_id: str | None = None
    opponent_name: str | None = None


def expected_score(rating: float, opponent_rating: float, scale: float = 400.0) -> float:
    return 1.0 / (1.0 + 10.0 ** ((opponent_rating - rating) / scale))


class EloEngine:
    """Chronological dual-Elo engine.

    Match Elo treats the match as one observation. Frame Elo treats the final
    frame score as a collection of frame observations evaluated using the
    pre-match ratings, making the update independent of unknown frame order.
    """

    def __init__(self, config: EloConfig | None = None) -> None:
        self.config = config or EloConfig()
        self.match_ratings: dict[str, float] = {}
        self.frame_ratings: dict[str, float] = {}
        self.events: list[RatingEvent] = []

    def _match_rating(self, player: str) -> float:
        return self.match_ratings.get(player, self.config.initial_rating)

    def _frame_rating(self, player: str) -> float:
        return self.frame_ratings.get(player, self.config.initial_rating)

    def process_match(
        self,
        *,
        match_id: str,
        played_at: datetime,
        player_a: str,
        player_b: str,
        frames_a: int,
        frames_b: int,
        player_a_name: str | None = None,
        player_b_name: str | None = None,
    ) -> tuple[RatingEvent, RatingEvent]:
        if player_a == player_b:
            raise ValueError("A player cannot play themselves")
        if frames_a < 0 or frames_b < 0 or frames_a + frames_b == 0:
            raise ValueError("Frame scores must be non-negative and contain at least one frame")

        ma, mb = self._match_rating(player_a), self._match_rating(player_b)
        fa, fb = self._frame_rating(player_a), self._frame_rating(player_b)

        expected_match_a = expected_score(ma, mb, self.config.scale)
        actual_match_a = 1.0 if frames_a > frames_b else 0.0 if frames_a < frames_b else 0.5
        match_delta = self.config.match_k * (actual_match_a - expected_match_a)

        frame_count = frames_a + frames_b
        expected_frame_a = expected_score(fa, fb, self.config.scale)
        frame_delta = self.config.frame_k * (frames_a - frame_count * expected_frame_a)

        new_ma, new_mb = ma + match_delta, mb - match_delta
        new_fa, new_fb = fa + frame_delta, fb - frame_delta
        self.match_ratings[player_a], self.match_ratings[player_b] = new_ma, new_mb
        self.frame_ratings[player_a], self.frame_ratings[player_b] = new_fa, new_fb

        event_a = RatingEvent(
            match_id=match_id,
            played_at=played_at,
            player=player_a,
            opponent=player_b,
            frames_won=frames_a,
            frames_lost=frames_b,
            match_elo_before=ma,
            match_elo_after=new_ma,
            frame_elo_before=fa,
            frame_elo_after=new_fa,
            player_id=player_a,
            player_name=player_a_name or player_a,
            opponent_id=player_b,
            opponent_name=player_b_name or player_b,
        )
        event_b = RatingEvent(
            match_id=match_id,
            played_at=played_at,
            player=player_b,
            opponent=player_a,
            frames_won=frames_b,
            frames_lost=frames_a,
            match_elo_before=mb,
            match_elo_after=new_mb,
            frame_elo_before=fb,
            frame_elo_after=new_fb,
            player_id=player_b,
            player_name=player_b_name or player_b,
            opponent_id=player_a,
            opponent_name=player_a_name or player_a,
        )
        self.events.extend((event_a, event_b))
        return event_a, event_b
