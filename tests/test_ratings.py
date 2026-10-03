from datetime import datetime

import pytest

from snooker_elo.ratings import EloEngine, expected_score


def test_equal_players_have_half_expectation():
    assert expected_score(1500, 1500) == pytest.approx(0.5)


def test_match_elo_ignores_margin_but_frame_elo_does_not():
    narrow = EloEngine()
    dominant = EloEngine()
    t = datetime(2026, 1, 1)

    n, _ = narrow.process_match(match_id="n", played_at=t, player_a="A", player_b="B", frames_a=10, frames_b=9)
    d, _ = dominant.process_match(match_id="d", played_at=t, player_a="A", player_b="B", frames_a=10, frames_b=0)

    assert n.match_elo_after == pytest.approx(d.match_elo_after)
    assert d.frame_elo_after > n.frame_elo_after


def test_updates_are_zero_sum_between_players():
    engine = EloEngine()
    a, b = engine.process_match(
        match_id="1", played_at=datetime(2026, 1, 1), player_a="A", player_b="B", frames_a=5, frames_b=3
    )
    assert (a.match_elo_after - a.match_elo_before) == pytest.approx(-(b.match_elo_after - b.match_elo_before))
    assert (a.frame_elo_after - a.frame_elo_before) == pytest.approx(-(b.frame_elo_after - b.frame_elo_before))
