from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Literal

from .ingestion import ingest_snookerdb
from .models import NormalizedMatch
from .ratings import EloConfig, EloEngine, expected_score

RatingKind = Literal["match", "frame"]


@dataclass(frozen=True)
class BacktestPrediction:
    match_id: str
    played_at: str
    player_a_id: str
    player_a_name: str
    player_b_id: str
    player_b_name: str
    frames_a: int
    frames_b: int
    actual_a: float
    match_probability_a: float
    frame_probability_a: float


@dataclass(frozen=True)
class BacktestMetrics:
    rating: RatingKind
    observations: int
    log_loss: float
    brier_score: float
    accuracy: float


def backtest_snookerdb(db_path: str | Path, config: EloConfig | None = None) -> list[BacktestPrediction]:
    matches, _ = ingest_snookerdb(db_path)
    return backtest_matches(matches, config=config)


def backtest_matches(
    matches: Iterable[NormalizedMatch],
    config: EloConfig | None = None,
) -> list[BacktestPrediction]:
    engine = EloEngine(config=config)
    predictions: list[BacktestPrediction] = []

    for match in matches:
        match_probability = expected_score(
            engine.match_rating(match.player_a_id),
            engine.match_rating(match.player_b_id),
            engine.config.scale,
        )
        frame_probability = expected_score(
            engine.frame_rating(match.player_a_id),
            engine.frame_rating(match.player_b_id),
            engine.config.scale,
        )
        actual = _actual_score(match.frames_a, match.frames_b)
        predictions.append(
            BacktestPrediction(
                match_id=match.match_id,
                played_at=match.played_at.isoformat(),
                player_a_id=match.player_a_id,
                player_a_name=match.player_a_name,
                player_b_id=match.player_b_id,
                player_b_name=match.player_b_name,
                frames_a=match.frames_a,
                frames_b=match.frames_b,
                actual_a=actual,
                match_probability_a=match_probability,
                frame_probability_a=frame_probability,
            )
        )
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

    return predictions


def summarize_predictions(
    predictions: Iterable[BacktestPrediction],
    rating: RatingKind = "match",
) -> BacktestMetrics:
    rows = list(predictions)
    if not rows:
        return BacktestMetrics(rating=rating, observations=0, log_loss=0.0, brier_score=0.0, accuracy=0.0)

    probabilities = [_probability(row, rating) for row in rows]
    actuals = [row.actual_a for row in rows]
    return BacktestMetrics(
        rating=rating,
        observations=len(rows),
        log_loss=sum(_log_loss(probability, actual) for probability, actual in zip(probabilities, actuals)) / len(rows),
        brier_score=sum((probability - actual) ** 2 for probability, actual in zip(probabilities, actuals)) / len(rows),
        accuracy=sum(_is_correct(probability, actual) for probability, actual in zip(probabilities, actuals)) / len(rows),
    )


def _probability(prediction: BacktestPrediction, rating: RatingKind) -> float:
    if rating == "match":
        return prediction.match_probability_a
    if rating == "frame":
        return prediction.frame_probability_a
    raise ValueError("rating must be 'match' or 'frame'")


def _actual_score(frames_a: int, frames_b: int) -> float:
    if frames_a > frames_b:
        return 1.0
    if frames_b > frames_a:
        return 0.0
    return 0.5


def _log_loss(probability: float, actual: float) -> float:
    clipped = min(max(probability, 1e-15), 1.0 - 1e-15)
    return -(actual * math.log(clipped) + (1.0 - actual) * math.log(1.0 - clipped))


def _is_correct(probability: float, actual: float) -> float:
    if actual == 0.5:
        return 0.5
    predicted = 1.0 if probability >= 0.5 else 0.0
    return 1.0 if predicted == actual else 0.0
