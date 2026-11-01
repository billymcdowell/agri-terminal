# Move explainer backtest

The explainer ranks possible drivers for flagged price moves. The backtest reports how often the top-ranked driver matches a hand-labeled one, so the accuracy target can be set from a measured baseline rather than guessed.

## Label file

Create `backtest-labels.json` in the application data directory (the folder that holds `agri-terminal.sqlite3`):

```json
{
  "labels": [
    { "symbol": "ZC", "date": "2026-08-12", "driver_contains": "wasde" }
  ]
}
```

- `symbol`: `ZC`, `ZS` or `ZW`.
- `date`: the trading day of the move, as stored in the price series.
- `driver_contains`: text expected in the title of the top-ranked driver, compared case-insensitively.

Label only moves whose driver you can confirm independently, such as a past WASDE surprise, a drought escalation or an export restriction. No labeled set ships with the app: the examples above are placeholders, and fabricated labels would make the report meaningless.

## Running it

The `run_backtest` command (frontend: `runBacktest()` in `src/lib/ipc.ts`) detects moves for every labeled symbol at a low 1 standard deviation threshold and returns:

| Field | Meaning |
| --- | --- |
| `total` | Labels in the file |
| `detected` | Labeled dates that the detector flagged |
| `topMatch` | Detected moves whose top driver matches the label |
| `topMatchRate` | `topMatch / detected`, absent when nothing was detected |
| `missedDates` | Labeled dates that were not flagged |

Scheduled-event attribution works on any history in the price table. News attribution only sees headlines already cached, and GDELT search covers roughly three months, so older labels will mostly test scheduled events.

## River alerts

`run_river_backtest` (frontend: `runRiverBacktest()`) replays the river alerts day by day over each gauge's stored history, using only what was public each day, and checks them against freight episodes: weeks the published barge rate rose 25% or more, with jumps within 28 days counted as one episode. Episodes come from the data, so there is no label file. For each gauge it returns the episodes, with the stage when each started and how many days before it the first warning in the previous 42 days came. It also returns the number of alerts per year and how many warnings (runs of alerts within 14 days) were followed by an episode. Results for 2020–2026 and how they set the river settings are in [`river.md`](river.md).

Flagged price moves stay hand-labelled as above: river events appear among the explainer's drivers, so a label such as `"driver_contains": "stage fell below"` can test them.

