from __future__ import annotations

import argparse

from .history import build_history


def main() -> None:
    parser = argparse.ArgumentParser(description="Build historical Snooker Elo event data.")
    parser.add_argument("--source", default="data/snookerdb.db", help="Path to the SnookerDB SQLite database.")
    parser.add_argument(
        "--output",
        default="output/snooker_elo_history.sqlite",
        help="Path for the generated historical SQLite database.",
    )
    args = parser.parse_args()

    stats = build_history(args.source, args.output)
    print(f"total DB matches: {stats.total_db_matches}")
    print(f"usable matches: {stats.usable_matches}")
    print(f"rejected matches: {stats.rejected_matches}")
    print(f"walkovers: {stats.walkovers}")
    print(f"malformed scores: {stats.malformed_scores}")
    print(f"missing dates: {stats.missing_dates}")
    print(f"missing players: {stats.missing_players}")
    print(f"player IDs with multiple names: {stats.duplicate_player_ids}")
    print(f"unique players: {stats.unique_players}")
    print(f"earliest match: {stats.earliest_match}")
    print(f"latest match: {stats.latest_match}")


if __name__ == "__main__":
    main()
