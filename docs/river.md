# River constraint index

Low water on the Mississippi forces barges to load lighter, which pushes up grain barge freight and widens the gap between Gulf and inland grain prices. AgriTerminal tracks this with a 0 to 100 river constraint score for each configured gauge, the river panels (`RIVER`, `RIVER TIMELINE`), river alerts, and river events offered as possible drivers in the move explainer. This page explains the method and the data, and reports how it did against six years of real history.

Everything here uses public data. Settings live in `config/waterways.json`; a copy in the app data directory overrides it.

## Data

| Series | Source | Notes |
| --- | --- | --- |
| `river.stlouis.stage` | USGS Water Data API, site 07010000 (built-in manifest `usgs-river-stage`) | The daily 08:00 reading, posted by about 15:05 UTC; six years kept |
| `river.memphis.stage` | NWS National Water Prediction Service `MEMT1` (`nwps-river-stage`), history from the Iowa Environmental Mesonet HML archive (lineage `iem-hml`) | USGS publishes no stage at Memphis. One reading a day, nearest 14:00 UTC |
| `river.<gauge>.forecast_min` | NWS forecasts (`nwps-river-forecast`), history from the IEM archive | The lowest forecast stage for each target day, one revision per forecast issue, released at the issue time |
| `river.barge_rate.stlouis`, `.cairo_memphis` | USDA AgTransport `deqi-uken` (`usda-agtransport`) | Weekly downbound grain barge rate in percent of the 1976 tariff; $/ton = rate × benchmark ÷ 100 |
| `river.locks.ms27.grain_tons`, `.olmsted.grain_tons` | USDA AgTransport `n4pw-9ygw`, from the Corps' lock data | Weekly downbound grain tons, summed over commodities |

Weekly AgTransport data are dated to the Grain Transportation Report issue that published them: the Thursday after the week, or the next issue when one was missed (19 March 2020, 2 October to 13 November 2025, 5 February 2026). Endpoints, units, release timing and licences are in [`research/river-sources.md`](research/river-sources.md).

Every value is used only from the time it became public. A value revised later is dated to when the app fetched the revision, unless the source gives it a later release of its own, such as a new forecast issue.

## Method

```
deficit(L) = clamp((normal − L) / (normal − critical), 0, 1)

DEPTH   = deficit(stage today)
FCST    = deficit(lowest forecast stage over the next 7 days)    // a forecast issued in the last 3 days
TRAFFIC = clamp((average of the 4 weeks before − latest week) / that average / 0.5, 0, 1)

score = 100 × (0.6·DEPTH + 0.4·FCST + 0·TRAFFIC)
bands: 0–39 NORMAL, 40–69 ELEVATED, 70–100 HIGH
```

A missing or stale component (stage older than 3 days, no forecast issued in 3 days, weekly data older than 14 days) drops out, the remaining weights are scaled up to add to 1, and the score is marked PARTIAL. The panel also shows the stage against the same days of the previous five years.

Adapted from `../waterway-index/docs/METHODOLOGY.md`, with two differences:

- **Lock tonnage is shown but not scored.** See calibration below.
- **Freight sensitivity uses changes on changes.** The "Freight pressure, next 14 days" card fits the barge rate's change over two weeks against the change in depth below the restriction level over the same weeks. The methodology's change-on-level version fitted nothing on this data. The card applies the slope to the forecast's second week, leaving out the intercept. On the stored history the slope is +43.8 percent of tariff per foot at St. Louis (R² 0.055) and +40.0 at Cairo–Memphis (R² 0.038). Over four to six weeks it reaches +89 to +128, with R² 0.13 to 0.23.

### Alerts and move explainer events

- **Alerts:** each gauge has four built-in alerts.
  - The stage at or below the restriction level.
  - The stage at or below the critical level.
  - The 7-day forecast reaching the restriction level while the stage is above it.
  - The score moving up a band.
- **Explainer events:** the move explainer offers threshold crossings, band changes and week-on-week barge-rate jumps of 15% or more in the five days before a move, as low-confidence possible drivers. They are capped below every headline and scheduled report.
- **Hysteresis:** both use the same margins.
  - A level alert or crossing re-arms only once the stage is 1 ft back above the level (`alerts.rearm_ft`).
  - A band change needs the score 5 points past the cut-off (`bands.margin`).
  - The band shown on screen ignores the margin.

## Thresholds

| Gauge | Normal | Restriction | Critical | Basis |
| --- | --- | --- | --- | --- |
| St. Louis | 5.0 ft | 1.0 ft | −3.5 ft | Normal: median August–December stage 2012–2026. Restriction: NWS low-water impact for EADM7. Critical: the Coast Guard and industry draft trigger reported for −3.5 ft. |
| Memphis | 3.0 ft | −5.0 ft | −10.0 ft | Normal: median August–December stage 2012–2025. Restriction: the low-water threshold with a 9-ft draft requirement, per University of Arkansas extension. Critical: the 2022 and 2023 record lows. |

Calibration kept these values. Moving the restriction level by ±1 to 2 ft only changed which freight jumps at high water happened to follow an alert, with leads of 0 to 1 days. That is coincidence, not evidence for a different level.

## Calibration against 2020–2026

Data: 22 October 2020 to 1 November 2026, both gauges. "Freight episodes" are weeks the published barge rate rose 25% or more. Jumps within 28 days are one episode, dated to the first jump's publication. A "warning" is a run of alerts (alerts within 14 days of the first count once). A warning counts for an episode that starts up to 42 days after it.

### What was found

- **Both big low-water years were warned ahead.**
  - September 2022: St. Louis freight rose from 412% of tariff on 1 September to a peak of 2,653% on 13 October. Memphis reached 2,812%.
  - August–September 2023: St. Louis +49% on 31 August.
  - St. Louis warned 39 days ahead in 2022 and 35 days ahead in 2023. Memphis warned 7 and 34 days ahead.
- **Most freight jumps are not about the river.** Of 9 St. Louis episodes and 12 Memphis episodes, several came with the stage well above normal: harvest demand in August–October, and March 2022 at 9.3 ft. The river alerts are not meant to catch those.
- **The score describes the present, not the next few weeks of freight.** Weekly correlations of the score with the change in barge rate:

  | Gauge | Over the past 4 weeks | Past 2 weeks | Next 2 weeks | Next 4 weeks |
  | --- | --- | --- | --- | --- |
  | St. Louis | +0.23 | +0.19 | −0.01 | −0.09 |
  | Memphis | +0.17 | +0.10 | −0.07 | −0.20 |

  Freight jumps as the river falls and then eases while it stays low, so a high score does not mean freight will keep rising.
- **Lock tonnage follows the harvest calendar.** Its traffic component averaged 85 (St. Louis) and 67 (Memphis) in September and 1 to 19 in October and November, every year. That's the pre-harvest lull and then the harvest surge. It correlated only +0.23 and +0.10 with river depth, and it fell to 0 in October 2022 at record low water.

### Changes made

| Setting | Before | After | Why |
| --- | --- | --- | --- |
| Weights depth / forecast / traffic | 0.5 / 0.3 / 0.2 | 0.6 / 0.4 / 0 | Traffic added about 17 points every normal-water September, and pulled the score down at the October 2022 low. The data stay on the panel for context. Cost: Memphis's 2022 warning came 7 days ahead instead of 14, because the September lull had been lifting the old score. |
| `bands.margin` | none | 5 points | The score hovered around 40 and flipped bands. A margin of 8 to 10 trimmed little more and cut the 2023 St. Louis lead from 35 to 21 days. |
| `alerts.rearm_ft` | none | 1.0 ft | Stages hovering at a threshold re-fired alerts every few days. |
| Thresholds | provisional | unchanged, marked calibrated | See Thresholds above. |

### Results (`run_river_backtest`)

| | St. Louis before | St. Louis after | Memphis before | Memphis after |
| --- | --- | --- | --- | --- |
| Freight episodes | 9 | 9 | 12 | 12 |
| Episodes warned within 42 days | 6 | 6 | 3 | 3 |
| Alerts per year | 30.4 | 18.4 | 13.6 | 10.6 |
| Warnings (runs of alerts) | 56 | 47 | 31 | 26 |
| Warnings followed by an episode within 42 days | 12 | 10 | 5 | 5 |
| Move-explainer river events per year | 53 | 38 | 27 | 24 |

The calibrated St. Louis count includes two warned episodes at high water (September 2021 and March 2022) that are coincidence.

The calibrated Memphis count misses the +80% jump of 22 August 2024, which came at −2.3 ft, above the −5 ft restriction level. Memphis's warned episodes are September 2022, August 2023 and October 2024.

Alerts cluster in the low-water autumns: 19 to 25 a year at St. Louis in 2022 to 2024, against 13 in 2025. Around 18 a year at St. Louis is still a lot, and most come from the band rule, so pause the ones you do not need.

### Accuracy statement

In six years with two major low-water episodes, the river score and alerts warned before both freight spikes at both gauges, 7 to 39 days ahead. They don't predict freight in general:
- Only about one warning in five was followed by a jump of 25% or more within six weeks.
- Most freight jumps have other causes.
- The score's correlation with the next weeks' freight change is near zero.

Use it as a description of how constrained the river is now, and as context for freight and basis, not as a price signal. Two episodes are too few to fit thresholds or weights with confidence, so the settings change as little as the evidence supports.

## Limitations

- **Too little history to fit settings.** Six years and two major episodes. The thresholds come from published sources, not from fitting.
- **No basis spread.** Public interior bids for the river states need the USDA AMS Market News connector, which is not built and needs a key. AgTransport's interior bids are a commercial feed and are not used, so barge freight is the price side.
- **Two gauges only.** The Ohio, Illinois and upper Mississippi have their own constraints. Cairo–Memphis freight also depends on the Ohio River, which no gauge here covers.
- **Different sampling at the two gauges.** St. Louis uses USGS's 08:00 Central reading (13:00 UTC in summer). Memphis uses the 14:00 UTC reading.
- **Thin forecast history.** Forecast history comes from an Iowa State University archive of NWS products. NWS itself keeps only the latest forecast.
- **The freight sensitivity explains little.** It is an average from past weeks, with R² around 0.05 over two weeks.
- **Late or revised weekly data.** AgTransport replaces its datasets in full each week. A past week revised later is caught only as a new revision when the app next fetches it.

## Reproducing the numbers

The calibration figures come from ignored tests over a database filled by the live backfill test:

```bash
AGRI_RIVER_DB=/path/to/river.sqlite3 cargo test --manifest-path src-tauri/Cargo.toml -- --ignored live_backfill_fills_every_river_series_for_the_raw_panel
AGRI_RIVER_DB=/path/to/river.sqlite3 cargo test --release --manifest-path src-tauri/Cargo.toml -- --ignored real_history_backtest --nocapture
```

`export_real_history_for_calibration` (with `AGRI_RIVER_EXPORT` set to a folder) writes each gauge's daily timeline with each component on its own. In the app, `run_river_backtest` (`runRiverBacktest()` in `src/lib/ipc.ts`) returns the same report from your own stored history.
