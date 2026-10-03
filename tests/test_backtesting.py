from __future__ import annotations

from datetime import datetime

import pytest

from snooker_elo.backtesting import backtest_matches, summarize_predictions
from snooker_elo.models import NormalizedMatch


def test_backtest_records_predictions_before_updates():
    matches = [
        NormalizedMatch(
            match_id="1",
            played_at=datetime(2026, 1, 1),
            player_a_id="A",
            player_a_name="Player A",
            player_b_id="B",
            player_b_name="Player B",
            frames_a=10,
            frames_b=0,
        ),
        NormalizedMatch(
            match_id="2",
            played_at=datetime(2026, 1, 2),
            player_a_id="A",
            player_a_name="Player A",
            player_b_id="B",
            player_b_name="Player B",
            frames_a=0,
            frames_b=5,
        ),
    ]

    predictions = backtest_matches(matches)

    assert len(predictions) == 2
    assert predictions[0].match_probability_a == pytest.approx(0.5)
    assert predictions[0].frame_probability_a == pytest.approx(0.5)
    assert predictions[1].match_probability_a > 0.5
    assert predictions[1].frame_probability_a > predictions[1].match_probability_a

    match_metrics = summarize_predictions(predictions, rating="match")
    frame_metrics = summarize_predictions(predictions, rating="frame")

    assert match_metrics.observations == 2
    assert frame_metrics.observations == 2
    assert match_metrics.log_loss > 0
    assert frame_metrics.brier_score > 0
