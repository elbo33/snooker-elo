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
