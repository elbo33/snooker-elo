from __future__ import annotations

import argparse
import os

from .history import build_history
from .snookerdb_source import check_snookerdb_update, download_snookerdb


def main() -> None:
    parser = argparse.ArgumentParser(description="Check or sync the upstream SnookerDB SQLite database.")
    parser.add_argument("--local", default="data/snookerdb.db", help="Local path for the SQLite database.")
    parser.add_argument("--repo", default="obrienjoey/snookerdb", help="GitHub repository containing SnookerDB.")
    parser.add_argument("--ref", default="main", help="Git ref to check.")
    parser.add_argument("--source-path", default="Database/snookerdb.db", help="Path to the DB inside the source repo.")
    parser.add_argument("--download", action="store_true", help="Download the DB if local copy is missing or stale.")
    parser.add_argument("--rebuild", action="store_true", help="Rebuild historical Elo output after syncing.")
    parser.add_argument(
        "--output",
        default="output/snooker_elo_history.sqlite",
        help="Historical output path used with --rebuild.",
    )
    args = parser.parse_args()

    token = os.environ.get("GITHUB_TOKEN")
    status = check_snookerdb_update(args.local, args.repo, args.source_path, args.ref, token=token)
    _print_status(status)

    if args.download and not status.is_current:
        print("Downloading updated SnookerDB database...")
        status = download_snookerdb(args.local, args.repo, args.source_path, args.ref, token=token)
        _print_status(status)

    if args.rebuild:
        if not status.local_exists:
            raise SystemExit("Cannot rebuild: local SnookerDB database is missing. Use --download first.")
        stats = build_history(args.local, args.output)
        print(f"rebuilt historical output: {args.output}")
        print(f"usable matches: {stats.usable_matches}")
        print(f"rejected matches: {stats.rejected_matches}")


def _print_status(status) -> None:
    print(f"local path: {status.local_path}")
    print(f"local exists: {status.local_exists}")
    print(f"local SHA: {status.local_sha or '-'}")
    print(f"remote SHA: {status.remote_sha}")
    print(f"remote size: {status.remote_size}")
    print(f"up to date: {status.is_current}")


if __name__ == "__main__":
    main()
