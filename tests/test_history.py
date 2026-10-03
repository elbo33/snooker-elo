from __future__ import annotations

import sqlite3
from datetime import datetime

from snooker_elo.history import HistoricalRatings, persist_history, rate_matches
from snooker_elo.ingestion import ingest_snookerdb


def test_historical_queries_and_ingestion_validation(tmp_path):
    source = tmp_path / "snookerdb.db"
    output = tmp_path / "history.sqlite"
    _create_fixture_db(source)

    matches, stats = ingest_snookerdb(source)
    persist_history(output, rate_matches(matches), stats)

    assert stats.total_db_matches == 6
    assert stats.usable_matches == 3
    assert stats.rejected_matches == 3
    assert stats.walkovers == 1
    assert stats.malformed_scores == 1
    assert stats.missing_dates == 1
    assert stats.unique_players == 3
    assert [match.match_id for match in matches] == ["2", "1", "3"]

    history = HistoricalRatings(output)

    assert history.rankings_at("2026-01-01") == []

    after_first = history.rankings_at("2026-01-03", limit=10)
    assert [row.player_id for row in after_first] == ["/player/c", "/player/b"]
    assert after_first[0].rank == 1
    assert after_first[0].matches_played == 1
    assert history.player_rank_at("/player/c", "2026-01-03").rank == 1

    between_matches = history.player_rating_at("/player/a", datetime(2026, 1, 4))
    assert between_matches is None

    after_second = history.player_rating_at("/player/a", "2026-01-06")
    assert after_second is not None
    assert after_second.player_name == "Player A"
    assert after_second.matches_played == 1

    final_top = history.top_n_at("2026-01-11", n=1)
    assert len(final_top) == 1
    assert final_top[0].player_id == "/player/a"

    comparison = history.compare_players(["/player/a", "/player/b"])
    assert set(comparison) == {"/player/a", "/player/b"}
    assert len(comparison["/player/b"]) == 3

    players = history.find_players("player a")
    assert len(players) == 1
    assert players[0].player_id == "/player/a"
    assert players[0].matches_played == 2

    metadata = history.build_metadata()
    assert metadata["usable_matches"] == "3"
    assert metadata["rejected_matches"] == "3"

    rejected = history.rejected_match_samples()
    assert len(rejected) == 3
    assert {row["reason"] for row in rejected} == {"walkover", "malformed_scores", "missing_dates"}

    peak = history.peak_rating("/player/a")
    assert peak is not None
    assert peak.match_elo > 1500

    peak_rank = history.peak_rank("/player/a")
    assert peak_rank is not None
    assert peak_rank.rank == 1

    periods = history.period_leaders(rating="match", start_year=2026, end_year=2026, limit=2)
    assert len(periods) == 1
    assert periods[0]["leaders"][0]["player_id"] == "/player/a"

    dominance = history.dominance_summary(rating="match", start_year=2026, end_year=2026)
    assert dominance[0]["player_id"] == "/player/a"
    assert dominance[0]["years_at_number_one"] == 1


def test_input_order_does_not_affect_distinct_date_results(tmp_path):
    source = tmp_path / "snookerdb.db"
    _create_schema(source)
    with sqlite3.connect(source) as conn:
        conn.execute("INSERT INTO tournament VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", _tournament("t"))
        conn.executemany(
            """
            INSERT INTO matches VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                _match("t", "late", "2026-02-01", "5", "0", "Player A", "/player/a", "Player B", "/player/b"),
                _match("t", "early", "2026-01-01", "0", "5", "Player A", "/player/a", "Player C", "/player/c"),
            ],
        )

    matches, _ = ingest_snookerdb(source)

    assert [match.match_id for match in matches] == ["early", "late"]


def _create_fixture_db(path):
    _create_schema(path)
    with sqlite3.connect(path) as conn:
        conn.executemany(
            "INSERT INTO tournament VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                _tournament("t1", start_date="2026-01-05"),
                _tournament("t2", start_date="2026-01-02"),
            ],
        )
        conn.executemany(
            "INSERT INTO matches VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                _match("t1", "1", "", "5", "4", "Player A", "/player/a", "Player B", "/player/b"),
                _match("t2", "2", "2026-01-02", "3", "5", "Player B", "/player/b", "Player C", "/player/c"),
                _match("t1", "3", "2026-01-10", "10", "0", "Player A", "/player/a", "Player B", "/player/b"),
                _match("t1", "4", "2026-01-11", "4", "2", "Player A", "/player/a", "Player C", "/player/c", "True"),
                _match("t1", "5", "2026-01-12", "bad", "2", "Player A", "/player/a", "Player C", "/player/c"),
                _match("missing", "6", "not-a-date", "1", "2", "Player A", "/player/a", "Player C", "/player/c"),
            ],
        )


def _create_schema(path):
    with sqlite3.connect(path) as conn:
        conn.executescript(
            """
            CREATE TABLE tournament (
                tourn_id TEXT,
                url TEXT,
                dates TEXT,
                name TEXT,
                season TEXT,
                category TEXT,
                venue TEXT,
                city TEXT,
                country TEXT,
                sponsor TEXT,
                prize_fund TEXT,
                start_date TEXT,
                end_date TEXT
            );

            CREATE TABLE matches (
                tourn_id TEXT,
                match_id TEXT,
                date TEXT,
                stage TEXT,
                best_of TEXT,
                player_1_score TEXT,
                player_2_score TEXT,
                player_1 TEXT,
                player_1_url TEXT,
                player_2 TEXT,
                player_2_url TEXT,
                scores TEXT,
                walkover TEXT,
                winner TEXT,
                winner_url TEXT
            );
            """
        )


def _tournament(tourn_id, start_date="2026-01-01"):
    return (
        tourn_id,
        f"/tournament/{tourn_id}",
        None,
        f"Tournament {tourn_id}",
        "2025/2026",
        "Ranking",
        None,
        None,
        None,
        None,
        None,
        start_date,
        start_date,
    )


def _match(tourn_id, match_id, played_at, score_1, score_2, player_1, url_1, player_2, url_2, walkover="False"):
    winner, winner_url = _winner(score_1, score_2, player_1, url_1, player_2, url_2)
    return (
        tourn_id,
        match_id,
        played_at,
        "Final",
        None,
        score_1,
        score_2,
        player_1,
        url_1,
        player_2,
        url_2,
        None,
        walkover,
        winner,
        winner_url,
    )


def _winner(score_1, score_2, player_1, url_1, player_2, url_2):
    if not score_1.isdigit() or not score_2.isdigit():
        return None, None
    if int(score_1) > int(score_2):
        return player_1, url_1
    if int(score_2) > int(score_1):
        return player_2, url_2
    return None, None
