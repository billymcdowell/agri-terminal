# AgriTerminal: River Constraint Plan

*Add-on plan for a river constraint index. Draft v0.1, October 31, 2026. Companion to the PRD and the main implementation plan.*

## 0. How to run this plan in Claude Code

Open the `agri-terminal` folder in Claude Code and paste:

> Read `docs/River Constraint Plan.md` in full, then `README.md`, `docs/AgriTerminal Implementation Plan.md`, `docs/plugins.md` and `docs/backtest.md`. Also read `../waterway-index/docs/METHODOLOGY.md` for the index formulas. Create a branch `feature/river-constraint`. Do Phase 0 only, then stop and report what you confirmed, what you could not confirm, and anything in the plan that should change.

After each phase, review and then say "Do Phase N". Each phase ends with the full check suite passing and one commit on the branch. Claude Code should not push or open a PR unless asked.

## 1. Purpose

Low water on the Mississippi forces barges to load lighter, which pushes up grain barge freight and widens the gap between Gulf and interior basis. Public data shows this early (river gauges, river forecasts, lock traffic) and USDA publishes the freight reaction (weekly barge rates). This plan adds a **River Constraint Index** to AgriTerminal: a 0–100 score per river, the data behind it, a panel, a combined timeline with price and basis, alerts, and river events as possible drivers in the move explainer.

It extends the PRD opportunity ("combines fundamentals, positioning, weather and basis in one place and shows how they relate") with logistics, which matters most to merchants, elevators and farmers watching basis.

## 2. Rules for this work

All the main plan's guiding rules apply (vertical slices, common data model, lineage on every observation, offline-first, swappable connectors, recorded fixtures, spike risky sources first). In addition:

1. **Public data only.** AgriTerminal is MIT-licensed and free. Never add employer or other proprietary price data, names or methods. The freight side uses USDA's public barge rates.
2. **No look-ahead.** Weekly sources (barge rates, lock traffic) carry a release schedule, and forecasts are stored by issue time, so every as-of join stays honest.
3. **Probabilistic wording.** River events are "possible drivers", never causes, matching the move explainer rules.
4. **Thresholds are configuration, not code.** Gauge thresholds and weights live in `config/waterways.json` and are calibrated in Phase 7.
5. **Confirm before building.** API details in this plan come from desk research and must be verified in Phase 0. If something cannot be confirmed, record it and adjust the plan rather than guessing endpoints, dataset ids or thresholds.
6. **Checks after every phase:**
   `npm run lint && npm test && npm run build`, `cargo fmt --check`, `cargo clippy ... -D warnings`, `cargo test` (see README "Checks"). Live provider contract tests go under `--ignored`.

## 3. Scope

**In (v1):** Mississippi River, gauges at St. Louis and Memphis; NWS river forecasts; USDA weekly downbound grain barge rates; weekly grain barge lock movements; constraint score; RIVER panel; river timeline combined view; river alerts; river drivers in the move explainer; backtest and calibration.

**Linked but dependent:** the Gulf vs interior basis spread needs the planned USDA AMS basis connector (PRD priority 2). Phase 6 builds the river side of it and leaves a clean slot if AMS coverage is still unconfirmed.

**Later:** Paraná River at Rosario (Argentine soymeal and oil exports), Amazon tributaries (Brazil northern arc exports), Panama Canal (Gatun Lake, US Gulf–Asia grain), Rhine.

## 4. Data sources (to confirm in Phase 0)

| Data | Provider | What to confirm | Shape |
|---|---|---|---|
| River stage, St. Louis | USGS Water Services | Site `07010000`, gage height parameter `00065`; daily values vs instantaneous values endpoint; JSON format; history depth for 5-year bands | Daily, ft |
| River stage, Memphis | USGS Water Services | Site id (believed `07032000`); same checks | Daily, ft |
| River forecast | NWS / National Water Prediction Service | Gauge ids (St. Louis believed `EADM7`); machine-readable forecast endpoint; issue time field; horizon | Forecast series by issue time |
| Grain barge rates | USDA AMS (Grain Transportation Report; AgTransport open data, also listed on data.gov) | Dataset id and API (Socrata or file); locations (St. Louis, Cairo–Memphis, etc.); units (% of 1976 tariff and/or $/ton); weekly release day and time | Weekly |
| Grain barge lock movements | USDA AMS AgTransport (from USACE lock data) | Dataset id, locks covered, units (tons), release timing | Weekly |
| Gulf and interior basis | USDA AMS MARS | Same open question as the PRD: grain coverage, report ids, PDFs vs API | Daily or weekly |

Useful references: USGS site page (waterdata.usgs.gov/mo/nwis/uv?site_no=07010000), USGS instantaneous values docs (nwis.waterservices.usgs.gov/docs/instantaneous-values/), NWS gauge page (water.noaa.gov/gauges/eadm7), USDA AMS transportation analysis (ams.usda.gov/services/transportation-analysis), data.gov "Weekly Downbound Grain Barge Rates".

## 5. Index method

Adapted from `../waterway-index/docs/METHODOLOGY.md`, with weekly lock tonnage replacing daily vessel tracking.

```
deficit(L) = clamp((normal − L) / (normal − critical), 0, 1)

DEPTH   = deficit(stage today)
FCST    = deficit(min forecast stage over next 7 days)        // latest forecast issued by today
TRAFFIC = clamp((avg4w(lock tons) − latest week) / avg4w / 0.5, 0, 1)

score = 100 × (w_depth·DEPTH + w_fcst·FCST + w_traffic·TRAFFIC)   // defaults 0.5 / 0.3 / 0.2
bands: 0–39 NORMAL, 40–69 ELEVATED, 70–100 HIGH
```

If a component is missing (forecast unavailable, lock data not yet released), re-weight the remaining components and flag the score as partial in the UI. Also compute the gauge against its 5-year same-week range with the existing `seasonal_band` helper, like crop condition.

## 6. Phases

### Phase 0: Spike and confirm sources (S)

- Hit each source in section 4 and save one real response per source as a fixture under `src-tauri/tests/fixtures/river/` (trim to a small size).
- Write `docs/research/river-sources.md`: confirmed endpoints, ids, units, release timing, history depth, licence and credit text, rate limits, and anything unconfirmed.
- Research and record reasonable starting low-water thresholds for St. Louis and Memphis (normal, restriction, critical) with their sources. Mark them as provisional.
- **Stop and report.** No app code in this phase.

**Done:** the research doc exists, fixtures are saved, open questions are listed.

### Phase 1: Gauge data and configuration (S)

- Add `config/waterways.json`: rivers, gauges (USGS site, NWS id, unit), provisional thresholds, weights. Load it the way `report-calendar.json` and `crop-regions.json` are loaded (bundled copy, app-data override).
- Add a bundled manifest `plugins/builtin/usgs-river-stage.toml` for daily stage at St. Louis and Memphis, following `us-drought-monitor.toml`. Series ids such as `river.stlouis.stage` (match how the built-in drought manifest names its series).
- Backfill at least six years of history so 5-year bands work (check the USGS daily values endpoint and `max_bytes`; split requests if needed).
- Tests: manifest validates; parser against the saved fixture.

**Done:** stage history and daily updates appear in `RAW`.

### Phase 2: Forecast, barge rates and lock traffic (M)

- **NWS forecast:** likely a Rust `DataSource` rather than a manifest, because rows are future dates tied to an issue time. Store each forecast point with `period` = target date and `released_at` = issue time; a new issue is a new revision, never an overwrite.
- **Barge rates:** weekly manifest or Rust source (whichever Phase 0 shows fits), with a `[release]` schedule matching the Grain Transportation Report. Series such as `river.barge_rate.stlouis`.
- **Lock movements:** weekly source, series such as `river.locks.<lock>.grain_tons`.
- Add the Grain Transportation Report to `config/report-calendar.json` (`kind: "GTR"`).
- Wire all sources into the scheduler with their cadences and backoff.
- Tests: parsers against fixtures; release timing; forecast revisions.

**Done:** all river series appear in `RAW` with correct release times; the calendar shows GTR.

### Phase 3: Analytics (M)

- Add `src-tauri/src/analytics/river.rs`:
  - `constraint_score(...)` → total, components, band, `partial` flag (section 5).
  - `river_timeline(...)` in the style of `crop_stress_timeline`: futures close, stage, stage 5-year band, latest forecast, barge rate, score, and a basis spread slot (empty until Phase 6). Use `as_of_join` with sensible `MAX_*_AGE_DAYS` for weekly series.
- Expose IPC commands (`get_river_status`, `get_river_timeline`) and typed wrappers in `src/lib/ipc.ts`.
- Tests: score maths with known inputs, missing-component re-weighting, band edges, and a no-look-ahead test (a barge rate released Thursday must not appear on Wednesday's row).

**Done:** tests pass; IPC returns data from the stored series.

### Phase 4: Panels, commands, help, templates (M)

- Register a **River status** panel (`type: "river"`, command `RIVER`, `RIVER MISS`; config schema lets the user pick the gauge). Shows: score and band with component breakdown, stage now vs thresholds and 5-year range, 7-day forecast, latest barge rate and week-on-week change, lock tonnage vs 4-week average, freshness of each input.
- Register a **River timeline** panel (`type: "river-timeline"`, command `RIVER TIMELINE`), linked to the price commodity via link groups. Lightweight Charts, like the crop stress timeline.
- Add both to `help-text.ts` and panel guides (the help panel tests likely require an entry for every panel), and add the command grammar entries with tests.
- Templates (`config/workspace-templates.json`): add the river panels to Trader and Analyst; for Farmer, add the River status panel with plain wording about local basis.
- Update the demo fixtures (`demo/fixtures.ts`, `demo/mock.ts`) so `demo.html` shows the river panels with clearly labelled fictional data.

**Done:** panels render in the app and the demo; commands work; help covers them.

### Phase 5: Alerts and move explainer (M)

- **River alerts:** stage crosses a threshold; latest forecast enters the restriction zone within N days; score moves up a band. Fire once per crossing and re-arm, like price alerts (`src-tauri/src/alerts.rs`). Show them in the Alerts panel.
- **Move explainer:** add a driver kind `river_event` in `analytics/attribution.rs`. A threshold crossing, band change or barge-rate jump within a short window before a flagged move becomes a candidate with a reason ("St. Louis stage fell below the restriction level 2 days earlier"). Keep the existing labels and thresholds; river candidates must not crowd out a scheduled report landing at the time of the move.
- Note in help that river effects usually show up more in basis and spreads than in futures, so river drivers are weaker evidence for futures moves.
- Tests: alert crossing and re-arm; attribution ranking with and without competing events.

**Done:** alerts fire on fixture data; the explainer can surface a river driver.

### Phase 6: Basis link (L, depends on the AMS basis connector)

- If the AMS basis connector exists or Phase 0 confirmed coverage: compute a Gulf minus interior basis spread series and fill the timeline's basis slot.
- Add `estimate_sensitivity(...)`: least-squares slope of the change in spread (and barge rate) against depth below the restriction level, from stored history. Show "expected pressure, next 14 days" on the River status panel, using the forecast, with clear caveats.
- If AMS coverage is still unconfirmed: use barge rates as the price side, keep the basis slot hidden, and write down what is blocking it.

**Done:** either the spread is live with sensitivity, or the gap is documented and the UI degrades cleanly.

### Phase 7: Backtest and calibration (M)

- Use real history to check the 2022 and 2023 low-water episodes: lead and lag correlation between score, barge rates and (if available) basis spread; did FCST alerts fire before barge rates jumped?
- Extend the backtest harness or add a river report: hit rate and lead time of alerts against barge-rate jumps. Hand-labelled moves only, per `docs/backtest.md` (no fabricated labels).
- Tune thresholds and weights in `config/waterways.json` and record the reasoning.
- Write `docs/river.md`: method, sources, calibration results, limitations.

**Done:** calibrated config, documented results, and an honest accuracy statement.

## 7. Risks

| Risk | Mitigation |
|---|---|
| USDA dataset ids or formats change | Fixture tests fail loudly; ids live in config |
| Forecast feed has no clean API | Fall back to stage-only score with `partial` flag |
| Barge rates are weekly and lag the river | That is the point of the index; show release times and freshness |
| Users read the score as a price call | Probabilistic wording, caveats on expected pressure, backtest results visible in help |
| Basis coverage unconfirmed | Phase 6 degrades cleanly; barge rates carry the price side |
| Scope creep to other rivers | Keep `waterways.json` generic, but ship Mississippi first |

## 8. Sizes

| Phase | Size |
|---|---|
| 0 Spike | S |
| 1 Gauge data | S |
| 2 Forecast, rates, locks | M |
| 3 Analytics | M |
| 4 Panels | M |
| 5 Alerts and explainer | M |
| 6 Basis link | L |
| 7 Backtest | M |
