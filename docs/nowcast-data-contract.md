# Crop nowcast data contract

What the crop nowcast pipeline (`pipelines/crop-nowcast/`) publishes and AgriTerminal reads. `crop_nowcast.publish.contract.validate_folder` checks a publish folder against this document, and a publish that fails it must not be uploaded. The plan behind it is `docs/Crop Nowcast Plan.md`; source notes are in `docs/research/nowcast-sources.md`.

## Layout

Outputs go to the public repository `billymcdowell/agri-terminal-data` (from Phase 8). Until then the app reads the synthetic set in `pipelines/crop-nowcast/sample_output/`.

```
<root>/
  2026-08-11/        one folder per publish date (UTC), never changed after upload
    yield.csv
    acreage.csv
    damage_events.json
    brief.json
    model_card.json
  2026-08-18/
  latest/            a copy of the newest dated folder
```

- A folder holds the current season as known at that publish: every week published so far, not only the newest.
- `latest/` is replaced in full on each publish. The app reads only `latest/`.
- Each file stays under 1 MiB, well inside the app's plugin limit.

## Conventions

- Text is UTF-8 with `\n` line endings. CSV files have a header row, comma separators and RFC 4180 quoting.
- **Times** (`published_at`) are UTC in the form `2026-08-18T18:00:00Z`: whole seconds, `Z` suffix.
- **Dates** (`week_ending`, `event_date`) are `YYYY-MM-DD`. `week_ending` is the Sunday that ends the data week, the same as NASS Crop Progress.
- **Numbers** are plain decimals with `.` and no thousands separators. Yields and gaps have one decimal place (`181.4`, `-1.6`); acres are whole numbers. An empty CSV cell means "no value".
- **`crop`** is `corn` or `soybeans`.
- **`geo`** is `US` or a two-letter state code in capitals (`IA`). Series ids in the app use it in lower case (`nowcast.corn.ia.yield_p50`).
- **`model_version`** names the model that produced a row, such as `0.3.0`. **A version that starts with `sample` marks invented data**, which the app must label as sample output and never present as a model result.
- **USDA release ids** name the USDA figure a row is compared with, as `<report>-<YYYY-MM>`. `<report>` is one of `nass-crop-production`, `nass-prospective-plantings`, `nass-acreage` or `wasde`, and the month is the report's release month: `wasde-2026-07`, `nass-crop-production-2026-08`, `nass-acreage-2026-06`.

## Publishing rules

1. **No look-ahead.** A row uses only data released before its `published_at`, and `published_at` is the time the row was first made public. It is never backdated.
2. **One row per key.** `(crop, geo, week_ending)` is unique within `yield.csv` and within `acreage.csv`. Damage events are unique by `id`.
3. **Restating is visible.** If a later publish changes a past week or an event, its row carries the new value and the new `published_at`. The app keeps both versions, so an as-of query still sees the original.
4. **USDA figures are the latest released before `published_at`.** When USDA has not published a figure for that crop and geography yet, `usda_latest` and its release id are empty. USDA publishes no state yields before the August Crop Production report, so state rows have no USDA yield in June and July.
5. **Ranges are ordered:** `p10 ≤ p50 ≤ p90`.

## `yield.csv`

Weekly yield nowcasts, about mid-June to harvest.

| Column | Type | Meaning |
| --- | --- | --- |
| `published_at` | time | When this row was first published |
| `crop` | `corn` or `soybeans` | |
| `geo` | `US` or state code | |
| `week_ending` | date | The data week the estimate describes |
| `p10`, `p50`, `p90` | bu/acre | The model's 10th, 50th and 90th percentile estimate of final yield |
| `usda_latest` | bu/acre or empty | USDA's latest yield for this crop and geography (rule 4) |
| `usda_vintage` | release id or empty | Which release `usda_latest` comes from; empty exactly when `usda_latest` is |
| `gap_p50` | bu/acre or empty | `p50 − usda_latest`, rounded to one decimal; positive means the model is above USDA |
| `baseline_trend` | bu/acre | The trend-only baseline for the same crop, geography and season |
| `model_version` | text | |

The app stores these columns as `nowcast.<crop>.<geo>.yield_p10`, `yield_p50`, `yield_p90`, `yield_usda_latest`, `yield_gap_p50` and `yield_trend` (unit `bu/acre`). The period is `week_ending` and the release time is `published_at`. Text columns (`usda_vintage`, `model_version`) are not stored as series.

## `acreage.csv`

Weekly planted-area nowcasts, June to August.

| Column | Type | Meaning |
| --- | --- | --- |
| `published_at`, `crop`, `geo`, `week_ending` | | As in `yield.csv` |
| `acres_p10`, `acres_p50`, `acres_p90` | acres | The model's estimate of planted area |
| `usda_latest` | acres or empty | USDA's latest planted area for this crop and geography |
| `usda_report` | release id or empty | Which release `usda_latest` comes from; empty exactly when `usda_latest` is |
| `model_version` | text | |

The app stores `nowcast.<crop>.<geo>.acres_p10`, `acres_p50`, `acres_p90` and `acres_usda_latest` (unit `acres`).

## `damage_events.json`

A JSON array of crop damage events, oldest `event_date` first. Each event:

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | Stable across publishes, for example `2026-08-04-ia-wind` |
| `published_at` | time | When this version of the event was published |
| `event_date` | date | The day of the storm or flood (Central time) |
| `cause` | `hail`, `wind` or `flood` | Tornado damage counts as `wind` |
| `states` | array of state codes | |
| `crop` | `corn` or `soybeans` | |
| `affected_acres_p50` | number | Estimated affected planted area |
| `affected_acres_range` | `[p10, p90]` | Range around `affected_acres_p50`, ordered |
| `confidence` | `low`, `medium` or `high` | |
| `storm_report_refs` | array of strings | Ids of the storm reports that triggered the check |
| `method` | string | How the area was estimated, in a sentence |

The app stores each event whole under the dataset `nowcast.damage_events`, keyed by `id`.

## `brief.json`

One JSON object: the plain-English summary for this publish.

| Field | Type | Meaning |
| --- | --- | --- |
| `published_at` | time | The publish this brief belongs to, equal to the newest `published_at` in the folder |
| `model_version` | text | The model whose output the brief describes |
| `ai_model` | string or `null` | The language model that wrote it; `null` when a template wrote it |
| `summary` | string | One short paragraph |
| `bullets` | array of strings | Supporting points |
| `validated` | boolean | True when every number in the text matched a number in the pipeline's output |
| `fallback_used` | boolean | True when the template wrote the brief because the language model's text failed validation |

The app stores it whole under the dataset `nowcast.brief`, keyed by its `published_at`.

## `model_card.json`

One JSON object describing the model behind this publish.

| Field | Type | Meaning |
| --- | --- | --- |
| `published_at` | time | As in `brief.json` |
| `model_version` | text | |
| `crops` | array of crops | |
| `training_years` | array of years | Seasons used to train the model; empty for sample output |
| `features` | array of strings | Feature names |
| `metrics` | object | Backtest results. Its fields are defined when the first model is trained (Phase 2) |
| `limitations` | array of strings | Known limitations, in plain English |

The app does not read the model card yet.

## Sample output

`pipelines/crop-nowcast/sample_output/` is written by `uv run python -m crop_nowcast.publish.sample sample_output` and covers the 2026 season to 18 August. **Every value in it is invented.** Its `model_version` is `sample-0.1.0`, its brief says it is sample data, and the app's sources that read it are named "(sample)" and start switched off. Release ids and USDA release times follow the real 2026 schedule so the vintage logic can be tested, but the USDA values are invented too.
