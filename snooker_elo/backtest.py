from __future__ import annotations

import argparse

from .backtesting import backtest_snookerdb, summarize_predictions


def main() -> None:
    parser = argparse.ArgumentParser(description="Backtest Match Elo and Frame Elo predictions.")
    parser.add_argument("--source", default="data/snookerdb.db", help="Path to the SnookerDB SQLite database.")
    args = parser.parse_args()

    predictions = backtest_snookerdb(args.source)
    for rating in ("match", "frame"):
        metrics = summarize_predictions(predictions, rating=rating)
        print(f"{rating} observations: {metrics.observations}")
        print(f"{rating} log loss: {metrics.log_loss:.6f}")
        print(f"{rating} Brier score: {metrics.brier_score:.6f}")
        print(f"{rating} accuracy: {metrics.accuracy:.6f}")


if __name__ == "__main__":
    main()
