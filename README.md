# Snooker Elo

Historical Elo ratings for professional snooker.

This project maintains two independent rating systems:

- **Match Elo** — each match is one win/loss, like chess Elo. A 10-9 and a 10-0 win have the same result value.
- **Frame Elo** — frames provide the result signal, so a dominant score contributes more evidence than a narrow win.

## Goal

Build a reproducible rating engine over historical snooker results that can evaluate players at any point in time.

It should support:

- rankings on any historical date
- a player's Elo and rank on any date
- peak and all-time Elo
- career rating graphs
- comparisons between players and eras
- Match Elo vs Frame Elo comparisons
- predictive backtesting and parameter calibration

## Data

The engine is designed around the public SnookerDB dataset. The database itself is not committed to this repository.

Place it locally at:

```
data/snookerdb.db
```

Generated historical outputs are written under `output/`, which is also not committed.

## Architecture

```
SnookerDB
    |
chronological matches
    |
+-----------+-----------+
| Match Elo | Frame Elo |
+-----------+-----------+
    |
rating events
    |
historical query engine
    |
frontend / analysis
```

The canonical historical record is the rating event stream. Rankings are derived at query time for the requested date.

Player identity uses SnookerDB player URLs when available. Display names are retained for presentation, but URLs are the stable internal IDs used by the rating and query layers.

## Build Historical Data

Build the processed historical event database with:

```bash
python -m snooker_elo.build_history \
  --source data/snookerdb.db \
  --output output/snooker_elo_history.sqlite
```

The build step:

- reads only match and tournament columns needed by the rating pipeline
- excludes walkovers
- validates scores, players and dates
- falls back to tournament dates when a match date is missing
- sorts matches chronologically with deterministic tie-breaking
- feeds normalized matches into Match Elo and Frame Elo
- persists per-player rating events to SQLite
- prints validation statistics including usable matches, rejections, walkovers, malformed scores, missing dates, missing players, player IDs with multiple display names, unique players and date range

SQLite is used for processed history because it is portable, requires no service, and supports indexed historical queries efficiently for the event stream.

## Query Historical Ratings

```python
from snooker_elo import HistoricalRatings

history = HistoricalRatings("output/snooker_elo_history.sqlite")

top_10 = history.top_n_at("2005-01-01", n=10, rating="match")
ronnie = history.player_rating_at("/players/ronnie-osullivan", "2012-04-15")
peak = history.peak_rating("/players/ronnie-osullivan", rating="frame")
comparison = history.compare_players(
    [
        "/players/ronnie-osullivan",
        "/players/stephen-hendry",
        "/players/john-higgins",
    ],
    start="2000-01-01",
    end="2020-12-31",
)
```

A player's rating at a date is their most recent rating event on or before that date. Players who have not played by that date do not appear in rankings.

Match Elo and Frame Elo are independent rating systems. Their raw numeric values should not be interpreted as directly comparable across systems; within-system rank and predictive performance are the meaningful comparisons.

## Validation

Run tests with:

```bash
uv run --extra dev pytest
```

or, in an environment that already has pytest installed:

```bash
python -m pytest
```

## Roadmap

1. Rating engine and event model
2. SnookerDB ingestion and normalization
3. Historical snapshot/query system
4. Backtesting and K-factor calibration
5. Interactive historical leaderboard
6. Player comparison and career graphs
7. Peak/all-time records and era analysis

## Status

Early development. Rating definitions and parameters will be validated against historical results before being treated as definitive.
