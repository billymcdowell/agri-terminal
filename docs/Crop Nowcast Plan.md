# AgriTerminal: Crop Nowcast Plan (yield, acreage and crop damage)

*Add-on plan. Draft v0.1, November 1, 2026. Companion to the PRD, the main implementation plan and the River Constraint Plan.*

## 0. How to run this plan in Claude Code

Open the `agri-terminal` folder in Claude Code and paste:

> Read `docs/Crop Nowcast Plan.md` in full, then `README.md`, `docs/prd.md`, `docs/AgriTerminal Implementation Plan.md`, `docs/plugins.md` and `docs/backtest.md`. Create a branch `feature/crop-nowcast`. Do Phase 0 only, then stop and report what you confirmed, what you could not confirm, and anything in the plan that should change.

After each review, say "Do Phase N". Each phase ends with the relevant checks passing and one commit on the branch. Claude Code should not push, open a PR, or create remote repositories unless asked.

## 1. Purpose

USDA's yield estimates (monthly WASDE and Crop Production reports) and its acreage reports (March Prospective Plantings, June Acreage) are the biggest scheduled price movers in corn and soybeans. AgriTerminal already explains moves after those reports. This plan lets it look ahead by building three **new datasets from public data with machine learning**:

1. **Yield nowcast:** weekly state and national corn and soybean yield with a likely range (p10, p50, p90), compared with USDA's latest estimate as a **yield gap**.
2. **Acreage nowcast:** in-season corn and soybean planted area by state, estimated from satellite imagery.
3. **Crop damage events:** acres hit by hail, wind (derecho) or flooding, sized from before/after imagery.

Plus a plain-English **weekly brief** written by a language model through Cloudflare AI Gateway.

## 2. Architecture

```
┌──────────────────────── pipelines/crop-nowcast (Python, runs weekly) ───────────────────────┐
│ NASS Quick Stats ─┐                                                                         │
│ Drought Monitor ──┤                                                                         │
│ Weather history ──┼─► features (as-of, no look-ahead) ─► models ─► outputs ─► AI brief     │
│ Satellite (STAC) ─┤        (LightGBM quantile / classifier)        (CSV+JSON)   (AI Gateway)│
│ CDL crop maps ────┘                                                                         │
└──────────────────────────────────────────────┬──────────────────────────────────────────────┘
                                               │ published to a public GitHub data repo
                                               ▼
┌──────────────────────── AgriTerminal (Tauri, offline-first) ─────────────────────────────────┐
│ bundled plugin manifest (numbers) + small Rust source (brief, events) ─► SQLite             │
│ ─► NOWCAST panel, yield-gap timeline, alerts, move explainer drivers, backtest               │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

Why split it: satellite processing and model training are too heavy for a desktop app. A separate weekly job publishes a small, versioned dataset, and the app ingests it like any other source. The app keeps working offline and never needs imagery or model code.

## 3. Rules for this work

All guiding rules from the main implementation plan apply. In addition:

1. **Public data only.** AgriTerminal is MIT-licensed. No proprietary or employer data, names or methods.
2. **No look-ahead, anywhere.** Training features for a given week use only data released by that week (condition ratings as published, USDA estimates by vintage, imagery acquired by then). The app's as-of joins use the nowcast's publish time as `released_at`.
3. **Probabilistic wording.** Always show the range, never a single "call". Use "the model estimates", never "will be".
4. **Benchmark honestly.** Every model is compared against USDA's own estimate at the same point in the season and against a simple trend baseline. A model that does not beat the baseline is not shipped.
5. **Language models never produce numbers.** The AI brief only describes numbers the pipeline computed. A validator checks this (Phase 7).
6. **AI provider:** Cloudflare AI Gateway using the **OpenAI chat completions schema**. Do not use Claude or Anthropic models. Default to an open-weights model on Workers AI. Base URL and model are configuration.
7. **Secrets** (NASS key, Cloudflare token) live in GitHub Actions secrets or the OS keychain. Never in the repo, logs or SQLite.
8. **Confirm before building.** Endpoints, collection ids and model names come from desk research and must be verified in Phase 0.

## 4. Scope

**Crops:** corn and soybeans.
**Geography:** national, plus the top producing states (start with IA, IL, NE, MN, IN, OH, SD, ND, KS, MO; align with `config/crop-regions.json`).
**Season:** yield weekly from about mid-June to harvest; acreage weekly June to August; damage events April to October.
**Later:** wheat, South America (Brazil/Argentina), county-level map view.

## 5. Data sources (to confirm in Phase 0)

| Data | Source | Use | Notes to confirm |
|---|---|---|---|
| County and state yields, acreage | USDA NASS Quick Stats API | Training labels, history | App already has a NASS key. History back to 2000 or earlier |
| USDA yield forecasts by vintage | NASS Quick Stats (Crop Production forecasts, e.g. "YEAR - AUG FORECAST") and/or FAS PSD | Benchmark and yield gap | Confirm the reference-period fields give each monthly vintage |
| Crop condition and progress | NASS (already in app) | Features | Weekly, by state |
| Drought | U.S. Drought Monitor (already in app) | Features | Weekly, by state |
| Weather history | Open-Meteo historical archive (ERA5), or gridMET/Daymet | Features: heat days, growing degree days, rainfall by window | Rate limits; Daymet lags about a year |
| Vegetation greenness | MODIS 250 m vegetation indices (Planetary Computer `modis-13Q1-061`, believed) | Yield features, 2000 onward | Collection id and access via STAC |
| Crop type maps | USDA Cropland Data Layer (CDL), via CropScape or Planetary Computer `usda-cdl` (believed) | Crop masks and acreage training labels | CDL for a year is published after that season, so in-season work uses the prior year's map |
| Higher-resolution imagery | Harmonized Landsat Sentinel-2 (HLS) or Sentinel-2 L2A on Planetary Computer | Acreage classification, damage detection | Collection ids, cloud masks |
| Soil moisture | Crop-CASMA (USDA NASS with NASA, SMAP-based) | Optional feature, 2015 onward | Access method; short history |
| Storm reports | NOAA Storm Prediction Center daily reports (hail, wind, tornado) | Triggers for damage detection | CSV format and history |
| AI brief | Cloudflare AI Gateway, OpenAI-compatible endpoint | Weekly summary | See section 7 |

Planetary Computer STAC is preferred because public collections need no account (the `planetary-computer` Python package signs asset URLs), so the pipeline can run in GitHub Actions. Google Earth Engine is the fallback if a collection is missing.

## 6. Output data contract (`docs/nowcast-data-contract.md`, written in Phase 1)

Published files (one folder per publish date plus a `latest/` copy):

- `yield.csv` — `published_at, crop, geo, week_ending, p10, p50, p90, usda_latest, usda_vintage, gap_p50, baseline_trend, model_version`
- `acreage.csv` — `published_at, crop, geo, week_ending, acres_p10, acres_p50, acres_p90, usda_latest, usda_report, model_version`
- `damage_events.json` — `[{ id, published_at, event_date, cause, states, crop, affected_acres_p50, affected_acres_range, confidence, storm_report_refs, method }]`
- `brief.json` — `{ published_at, model_version, ai_model, summary, bullets[], validated: true|false, fallback_used: true|false }`
- `model_card.json` — metrics from backtests (section 8, Phase 8), feature list, training years, known limitations

Units: yield bu/acre, acreage acres. `geo` is `US` or a two-letter state code (lowercase in series ids).

## 7. Cloudflare AI Gateway (OpenAI schema)

**Endpoint** (OpenAI-compatible unified API):

```
POST https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/compat/chat/completions
Headers:
  cf-aig-authorization: Bearer {CF_AIG_TOKEN}
  Content-Type: application/json
Body (OpenAI chat completions schema):
  { "model": "workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    "messages": [ {"role":"system","content":"..."}, {"role":"user","content":"<structured JSON>"} ],
    "temperature": 0.2,
    "response_format": { "type": "json_object" } }
```

- Model ids use `{provider}/{model}`. Default to a Workers AI open model; any non-Anthropic provider can be swapped in through config. **Do not configure `anthropic/*` models.**
- Cloudflare's docs mark `/compat` as deprecated for single-model calls in favour of `https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1/chat/completions`. Make the base URL configurable so either works, and confirm the current recommendation in Phase 0.
- Use any OpenAI-schema client (the `openai` Python package with `base_url`, or plain HTTP). Check in Phase 0 whether the chosen model honours `response_format`; if not, ask for JSON in the prompt and parse defensively.
- Config: `AI_BASE_URL`, `AI_MODEL`, `CF_ACCOUNT_ID`, `CF_GATEWAY_ID`, `CF_AIG_TOKEN` (secrets in GitHub Actions; for the optional in-app feature, the token goes in the OS keychain like the app's other keys).
- Gateway features worth turning on: request logging, caching of identical prompts, rate limiting and spend limits.

## 8. Phases

### Phase 0: Spike and confirm (S)

- Verify every source in section 5: endpoints, collection ids, history depth, units, release timing, licence and credit text. Save small real responses as fixtures under `pipelines/crop-nowcast/tests/fixtures/`.
- Confirm NASS Quick Stats returns USDA yield forecasts by monthly vintage (needed for an honest benchmark).
- Make one test call to Cloudflare AI Gateway with the default Workers AI model, using the OpenAI schema; record whether `response_format` works and the latency.
- Recommend where outputs are published: a separate public repo (suggested `agri-terminal-data`, read via `raw.githubusercontent.com`) or a branch of this repo. Do not create it; ask.
- Write `docs/research/nowcast-sources.md`. **Stop and report.** No app or model code.

**Done:** research doc, fixtures, a publishing recommendation and open questions.

### Phase 1: Data contract, pipeline skeleton, app ingestion (S)

- Create `pipelines/crop-nowcast/` as a Python project (Python 3.12, `uv`, `pytest`, `ruff`). Folders: `sources/`, `features/`, `models/`, `publish/`, `ai/`, `tests/`.
- Write `docs/nowcast-data-contract.md` from section 6 and a **synthetic** sample output set (clearly flagged `sample`) under `pipelines/crop-nowcast/sample_output/`.
- App: a bundled manifest `plugins/builtin/crop-nowcast.toml` that reads `yield.csv` and `acreage.csv` (series such as `nowcast.corn.ia.yield_p50`, `.yield_p10`, `.yield_p90`, `.usda_latest`), following `us-drought-monitor.toml`. A small Rust source for `brief.json` and `damage_events.json` (text and events do not fit numeric series). Point both at the sample output for now.
- Add a GitHub Actions workflow skeleton (manual trigger only) that runs tests.
- Tests: manifest validates; parsers against sample files.

**Done:** sample nowcast series and the brief appear in `RAW`.

### Phase 2: Baseline yield model, no imagery (M)

The quick win: data AgriTerminal already uses.

- Features per state and week of season: condition index (weighted good/excellent minus poor/very poor), crop progress (silking/blooming dates vs normal), share of growing area in drought (D1+), weather windows (corn: heat days and rainfall around silking; soybeans: August rainfall; growing degree days), and a yield trend term.
- Model: one LightGBM quantile model per crop (p10, p50, p90) with "week of season" as a feature, trained on features truncated to what was known at each week. Also fit a trend-only baseline.
- Evaluation: leave-one-year-out across 2005 onward. For each week, compare error against the trend baseline and against USDA's estimate available at that date, measured against the final NASS yield. Check whether the range covers the outcome about 80% of the time.
- Publish `yield.csv` and `model_card.json` locally.

**Done:** model card shows where the baseline beats trend and where it does not; outputs match the contract.

### Phase 3: NOWCAST panel and yield-gap timeline (M)

- Register a **Crop nowcast** panel (`type: "nowcast"`, commands `NOWCAST`, `NOWCAST CORN`, `NOWCAST SOY`): national and state table with p10/p50/p90, USDA latest and vintage, gap, change vs last week, freshness, and a link to the model card.
- A **Yield gap timeline** in the style of the crop stress timeline: nowcast range band through the season, USDA estimate steps by vintage, final yield for past years, futures price underneath. Linked by link groups.
- Before each WASDE or Crop Production release (from the report calendar), show the gap as "model vs USDA going into the report", with caveats.
- Help text, panel guides, command grammar tests, Analyst and Trader templates, and demo fixtures (`demo/fixtures.ts`) with clearly fictional data.

**Done:** panels render in the app and the demo with sample data, and with real data once the pipeline publishes.

### Phase 4: Satellite greenness features (M/L)

- Crop masks: prior-year CDL (corn and soybean pixels) aggregated to county and state.
- From MODIS 250 m vegetation indices, compute masked county curves of greenness (NDVI or EVI): seasonal peak, area under the curve to date, anomaly vs the 5-year same-date average. Aggregate to state with acreage weights.
- Add these features to the Phase 2 model, retrain and re-run the same evaluation. **Keep them only if they improve accuracy** over the no-imagery baseline. Record the difference in the model card.
- Optional: soil moisture from Crop-CASMA as an extra feature from 2015 onward.
- Cache imagery aggregates so weekly runs only fetch new composites.

**Done:** model card shows baseline vs imagery-enhanced accuracy by week of season.

### Phase 5: Acreage nowcast (L)

- Sampling design: a fixed stratified sample of points on cropland in each state (not full-resolution mapping), which keeps compute small enough for weekly runs.
- Labels: CDL crop type at each point for past years. Features: HLS or Sentinel-2 time series to date (greenness and band statistics by period) plus **last year's crop at that point** (corn–soybean rotation is a strong prior early in the season).
- Model: LightGBM classifier per week of season. State area = cropland area × predicted corn and soybean share, with intervals from the sample and the classifier's error rate.
- Be explicit about timing: June estimates lean on the rotation prior and are lower confidence; imagery separates corn from soybeans more reliably from about mid-July. Compare against Prospective Plantings, June Acreage and the final estimates in the model card.
- Publish `acreage.csv` weekly June to August.

**Done:** acreage estimates with intervals and an honest accuracy record by week.

### Phase 6: Crop damage events (M)

- Trigger: NOAA storm reports (hail, wind, tornado) and flood reports in the crop states.
- Method: compare HLS or Sentinel-2 greenness on corn and soybean pixels (prior-year CDL mask) inside the affected area before and after the event, against nearby unaffected control fields. Flag areas with an abnormal drop; estimate affected acres with a range and a confidence level.
- Validate against a known historical event (the August 2020 Iowa derecho is a good test case), and write up the result.
- Publish `damage_events.json`. App: show events on the Nowcast panel, add a damage alert, and add a move explainer driver kind `crop_damage` with probabilistic labels.

**Done:** detection works on the validation event; events flow into the app.

### Phase 7: Weekly AI brief via Cloudflare AI Gateway (S/M)

- Pipeline `ai/brief.py`: build a structured input (yield and acreage outputs, week-on-week changes, gap vs USDA, top feature contributions from SHAP, damage events), send it through the AI Gateway OpenAI-compatible endpoint (section 7) with a system prompt requiring plain English, probabilistic wording, no new numbers and no trading advice.
- **Validator:** every number in the reply must match a number in the input (after rounding); no banned phrases ("will", "guaranteed", "buy", "sell"). If validation fails twice, publish a template-generated brief and set `fallback_used: true`.
- App: show the brief on the Nowcast panel labelled "AI-generated summary of the model output", with the model name and publish time.
- Optional, off by default: an in-app "Explain this change" button that sends the same structured context to the user's own AI Gateway (base URL, model and token configured in Settings, token in the keychain). The app must work fully without it.
- Tests: validator unit tests, a mocked gateway response, and the fallback path.

**Done:** briefs publish weekly and never contain numbers the pipeline did not compute.

### Phase 8: Backtest, explainer integration and automation (M)

- **WASDE backtest:** for each past August–November release, did the sign of the pre-report gap (model p50 minus USDA's previous estimate) match the direction of USDA's revision? Report the hit rate and how it varies with gap size, in the model card and the Help panel.
- Move explainer: add a driver kind `nowcast_gap` for WASDE and Crop Production release days, with wording like "The model estimated a lower yield than USDA going into this report (possible driver)".
- Alerts: gap above a user-set size before a release; damage event in a user's chosen states.
- Turn on the scheduled GitHub Actions run (weekly in season, using secrets), publishing to the location agreed in Phase 0. Switch the app's manifest and Rust source from the sample output to the published `latest/` URLs.
- Write `docs/crop-nowcast.md`: method, sources and credits, metrics, limitations.

**Done:** the weekly pipeline publishes automatically; the app shows live nowcasts with a visible accuracy record.

## 9. Risks

| Risk | Mitigation |
|---|---|
| Model adds nothing over USDA or trend | Benchmark rule: do not ship; still publish the honest result |
| Look-ahead leaks into training | Vintage-aware feature builders; dedicated no-look-ahead tests |
| Imagery processing too slow or costly for Actions | Point sampling, cached aggregates, MODIS before HLS; run the historical backfill once locally |
| Cloud cover in key weeks | Composites, cloud masks, and a "low imagery coverage" flag in outputs |
| Satellite catalogue or collection ids change | Ids in config; fixture tests fail loudly; Earth Engine fallback |
| AI brief misstates numbers | Numeric validator and template fallback; AI never produces numbers |
| `/compat` endpoint deprecation | Configurable base URL; REST endpoint as alternative |
| Users read the gap as a trading signal | Ranges, caveats, backtest record in Help, probabilistic labels |

## 10. Sizes

| Phase | Size |
|---|---|
| 0 Spike | S |
| 1 Contract and ingestion | S |
| 2 Baseline yield model | M |
| 3 Panels | M |
| 4 Satellite features | M/L |
| 5 Acreage nowcast | L |
| 6 Damage events | M |
| 7 AI brief | S/M |
| 8 Backtest and automation | M |
