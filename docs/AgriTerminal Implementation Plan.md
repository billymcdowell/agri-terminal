# AgriTerminal: Implementation Plan

*Companion to the PRD (v0.2). Draft v0.1, October 18, 2026.*

## 1. Purpose and Assumptions

This plan explains how to build AgriTerminal, phase by phase, in an order that always leaves something runnable. It assumes:

- The Tauri app is scaffolded, `npm run tauri dev` opens a window, and the Rust and frontend dependencies from the PRD's setup section are installed.
- One developer or a small team works in vertical slices.
- Sizes are relative effort (S, M, L), not calendar time.
- API details are from research in October 2026 and must be confirmed against each provider's documentation when its connector is built.

## 2. Guiding Rules

1. **Vertical slices first.** Prove price in, store, IPC, chart before building breadth.
2. **Everything goes through the common data model.** Panels never know which source supplied data.
3. **Every observation carries lineage.** Source, fetch time, release time and revision are stored with each datapoint, so views can align series by release date and show freshness.
4. **Offline-first.** The UI reads local storage only. Connectors write to storage in the background.
5. **Connectors are swappable.** One trait, one file per source, no source-specific logic in panels.
6. **Record real responses as fixtures.** Parsers are tested against saved responses, so a changed API shows up as a failing test.
7. **Spike risky sources before building them** (see section 6).

## 3. Target Layout and Core Contracts

### 3.1 Repository layout

```
src-tauri/src/
  core/        types, errors, units, time helpers
  sources/     one module per connector (databento, cftc, nass, fas, drought, nws, openmeteo, gdelt, ams, fred)
  plugins/     declarative loader, manifest types, permissions
  scheduler/   cadence, backoff, freshness
  store/       sqlite access, migrations, queries
  analytics/   seasonality, percentiles, alignment, move detection, attribution
  commands/    Tauri commands (thin wrappers only)
  secrets/     keychain access
src/
  panels/      one folder per panel type
  workspace/   layout engine glue, serialization, link groups
  command-bar/ grammar parser and UI
  state/       zustand stores, react-query hooks
  lib/         IPC wrapper, formatting, theme tokens
plugins/builtin/   declarative manifests for built-in sources
tests/fixtures/    recorded API responses
```

### 3.2 Core Rust types (sketch)

```rust
pub struct SeriesId(pub String);      // price.ZC.close, cot.ZC.managed_money_net
pub struct SourceId(pub String);

pub struct Observation {
    pub series: SeriesId,
    pub period: NaiveDate,            // the date the value describes
    pub released_at: DateTime<Utc>,   // when it became public
    pub value: f64,
    pub unit: Unit,
    pub source: SourceId,
    pub fetched_at: DateTime<Utc>,
    pub revision: u32,                // 0 = first release
}

pub struct SourceMeta {
    pub id: SourceId,
    pub cadence: Cadence,             // Daily, Weekly(day, time), Monthly, Interval(minutes)
    pub requires_key: Option<KeySpec>,
    pub license_note: &'static str,
}

#[async_trait]
pub trait DataSource: Send + Sync {
    fn meta(&self) -> &SourceMeta;
    async fn fetch(&self, ctx: &FetchContext, req: FetchRequest)
        -> Result<Vec<Observation>, SourceError>;
}
```

`SourceError` separates `Auth`, `RateLimited { retry_after }`, `Transient`, `Parse` and `Unavailable`, so the scheduler can react differently to each.

### 3.3 Storage schema (SQLite first)

```sql
CREATE TABLE observations (
  series_id TEXT NOT NULL, period TEXT NOT NULL, revision INTEGER NOT NULL,
  released_at TEXT NOT NULL, value REAL NOT NULL, unit TEXT NOT NULL,
  source_id TEXT NOT NULL, fetched_at TEXT NOT NULL,
  PRIMARY KEY (series_id, period, revision)
);
CREATE TABLE source_status (
  source_id TEXT PRIMARY KEY, state TEXT NOT NULL, last_ok TEXT,
  last_attempt TEXT, next_expected TEXT, error TEXT
);
CREATE TABLE news_items (
  id TEXT PRIMARY KEY, published_at TEXT NOT NULL, title TEXT NOT NULL,
  url TEXT NOT NULL, source TEXT NOT NULL, commodities TEXT NOT NULL
);
CREATE TABLE events (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, scheduled_at TEXT NOT NULL,
  commodity TEXT, title TEXT NOT NULL
);
CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, json TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE alerts (id TEXT PRIMARY KEY, json TEXT NOT NULL, enabled INTEGER NOT NULL);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
```

Use a simple migration runner keyed on `PRAGMA user_version`. Keep time series in SQLite through phase 4. Introduce DuckDB or Polars in phase 5, when analytics need columnar scans, and keep SQLite as the system of record unless profiling shows a problem.

### 3.4 IPC surface

| Command | Purpose |
| --- | --- |
| `get_series(series_id, range, as_of?)` | Points plus freshness metadata |
| `list_sources()` | Source metadata and live status |
| `set_source_enabled(id, bool)` | Toggle a source |
| `save_secret(id, value)` / `test_connection(id)` | Keychain write and a one-call check |
| `refresh_source(id)` | Manual refresh |
| `list_workspaces()`, `load_workspace(id)`, `save_workspace(ws)` | Workspace persistence |
| `query_news(commodity, range)`, `query_events(range)` | News and calendar |
| `explain_move(series_id, range)` | Ranked candidate drivers (phase 5) |

| Event (Rust to UI) | Payload |
| --- | --- |
| `data-updated` | Changed series IDs |
| `source-status` | Source ID and new state |
| `alert-fired` | Alert ID and context |

Commands stay thin: validate, call into a module, return. All logic lives in the modules so it can be unit tested without Tauri.

### 3.5 Frontend contracts

```ts
interface PanelDef<C> {
  type: string;                 // price-chart, cot, move-explainer
  title: string;
  configSchema: JSONSchema;     // drives the settings form
  defaultConfig: C;
  component: React.ComponentType<PanelProps<C>>;
}

interface WorkspaceState {
  version: number;
  layout: unknown;              // serialized dock layout
  panels: Record<string, { type: string; config: unknown; linkGroup?: string }>;
}
```

Panels fetch data through hooks such as `useSeries(seriesId, range)` that wrap `get_series` and subscribe to `data-updated`. Link groups live in a zustand store keyed by group name (for example `{ A: { commodity: 'ZC' } }`).

## 4. Phases

### Phase 0: Conventions (S)

**Tasks**

1. Add CI: `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`, frontend lint and `vitest`, on Linux, macOS and Windows.
2. Add `tracing` setup writing to a rotating log file in the app data directory.
3. Define the app data directory layout (database, logs, plugins, cache).
4. Add a `CONTRIBUTING.md` stub and a `tests/fixtures` folder with a README on how fixtures are recorded.

**Done when:** CI is green on all three OSes with a trivial test.

### Phase 1: Vertical Slice (M)

**Goal:** price data flows from a source to a chart, offline.

**Tasks**

1. Implement `core` types, `SourceError`, and unit handling.
2. Implement `store`: migration runner, `upsert_observations`, `query_series(range, as_of)`.
3. Implement a **fixture source** that reads a CSV of daily corn prices. This keeps the slice working with no key and gives every later test deterministic data.
4. Implement the **Databento connector** for daily bars. Confirm symbology for continuous front-month contracts and the freshness of daily bars in their docs. Read the key from the keychain.
5. Implement a minimal scheduler that runs one source on an interval and writes to the store.
6. Implement `get_series` and the `data-updated` event.
7. Frontend: IPC wrapper, react-query provider, `useSeries`, and a price chart panel using Lightweight Charts.
8. Show a freshness label (source name and age) under the chart from day one.

**Tests:** store round-trip, revision handling (a later revision wins when `as_of` is now), connector parser against a recorded Databento response, chart panel renders from a mocked `useSeries`.

**Done when:** a corn chart renders from the local database with the network off, and a stale label appears when data is old.

### Phase 2: Workspace Shell (M)

**Goal:** it feels like a terminal.

**Tasks**

1. Panel registry: `registerPanel`, lookup by type, and a panel library list.
2. Integrate dockview: add, remove, drag, tab and resize panels; serialize and restore layout.
3. Workspace persistence: save to the `workspaces` table with debounced auto-save; restore on launch.
4. Link groups: zustand store, colored group indicator in each panel header, panels subscribe to the group's commodity.
5. Command bar with cmdk. Write the grammar as a pure TypeScript module with unit tests: `ZC` (open or retarget), `ZC COT`, `WASDE`, `WX IOWA`, `WS name` (switch workspace).
6. Theme tokens as CSS variables: dark default, dense type scale, color reserved for up/down and stale/error.
7. Pop-out windows: open a panel in a second Tauri window and sync workspace state through events.
8. Keyboard map: focus command bar with `/`, cycle panels, close panel.

**Tests:** command grammar table tests, workspace serialize/restore round-trip, link group propagation test.

**Done when:** a user opens three panels with the command bar, arranges them, restarts the app, and the layout returns exactly.

### Phase 3: Core Data (L)

**Goal:** real fundamentals, with honest freshness. This is the first point where the application is genuinely useful.

**Tasks**

1. **Scheduler v2:** per-source cadence, jitter, retry with exponential backoff, respect `retry_after`, run missed jobs on startup, and compute `next_expected` for the source status table.
2. **Freshness model:** each series declares its expected cadence; the UI shows OK, stale (with how long), or error.
3. **Secrets:** `keyring` wrapper, `save_secret`, `test_connection`, and no key ever written to disk or logs.
4. **Declarative plugin loader (minimal):** parse a TOML manifest into an `HttpSourceSpec` (URL template, auth, response format, JSON-path or CSV column mapping to observation fields) and run it through the same `DataSource` trait.
5. **Connectors**, each preceded by a spike (section 6) and a recorded fixture:
   - CFTC COT (Socrata-style API; map managed money, commercial and swap net positions).
   - NASS QuickStats (crop progress and condition; split queries to stay under the record cap).
   - FAS OpenData (PSD balance sheets and weekly export sales).
   - US Drought Monitor (weekly percent area by drought category for states or counties).
6. **Report calendar:** a seeded events table from a maintained config file of known release schedules (WASDE, crop progress, export sales, COT), with a loader that can be updated without a release.
7. **Panels:** COT positioning (with historical percentile), crop condition, supply and demand balance sheet, drought, and the report calendar.
8. **Source management screen:** list, status, last refresh, enable/disable, retry, and the guided key setup with a test-connection button.

**Tests:** parser tests for every connector from fixtures; scheduler tests with a fake clock (backoff, missed-run catch-up); freshness classification tests; a contract test per connector that hits the live API, marked `#[ignore]` and run nightly in CI.

**Done when:** COT, crop condition, supply and demand and drought panels show live data with correct freshness labels, a failing source shows cached data with a stale label, and a user can add a key and watch the panel fill in.

**Checkpoint:** put this build in front of two or three real users (a farmer, an analyst) before starting phase 4. Their feedback decides what comes next.

### Phase 4: Weather, News and Basis (M)

**Tasks**

1. **Weather connectors:** NWS (set a descriptive User-Agent, handle the gridpoint lookup) and Open-Meteo (honor the non-commercial limits, show attribution in the UI).
2. **Weather panel** with MapLibre for crop-region overlays, linked to the commodity's growing regions (a small config file mapping commodity to regions).
3. **News ingest:** GDELT article search plus RSS feeds via `feed-rs`. Deduplicate by URL and normalized title, tag commodities by keyword and entity rules, store headline, source, time and link only.
4. **News panel** with commodity filter and link-out.
5. **USDA AMS decision gate:** run the spike (section 6). If grain cash and basis coverage is adequate, build the connector and a basis panel. If not, document the gap and skip.
6. **Alerts on the calendar:** notify before major releases.

**Tests:** dedupe and tagging unit tests with labeled sample headlines; NWS and Open-Meteo parsers from fixtures; attribution text present in the weather panel.

**Done when:** weather and news panels follow the selected commodity, and the calendar shows upcoming releases.

### Phase 5: Combined Views and Move Explainer (L)

**Goal:** the differentiating features.

**Tasks**

1. **Analytics foundations:** add DuckDB or Polars. Build seasonal averages and ranges, rolling percentiles, and an **as-of join** that aligns series by `released_at` so a weekly report is never used before it was public.
2. **Combined view 1: crop stress timeline.** Price, NASS condition, drought percentage and weather forecast on a shared axis against the five-year range. Ship this first and validate it with users.
3. **Further views, in order of effort:** demand pulse (export sales vs projection pace), supply vs positioning map, market scorecard, year analog finder, everything timeline.
4. **Move detection:** rolling standard deviation of log returns, a configurable threshold (default 2 standard deviations), and user range selection.
5. **Attribution, stage one:** match flagged moves to scheduled events by timestamp from the `events` table. This stage uses only free data and has the highest confidence.
6. **Attribution, stage two:** candidate news from the news table, scored on timing, relevance, source quality and direction fit; tiers map to the labels in the PRD.
7. **Backtest harness:** a labeled JSON file of known events (past WASDE surprises, droughts, export bans) and a command that reports how often the top candidate matches. Set the accuracy target only after the first run.
8. **Move explainer panel** and chart markers, with pin, dismiss and annotate actions stored in settings.

**Tests:** alignment tests (no lookahead), detection tests on synthetic series with known spikes, scoring tests on hand-built candidate sets, snapshot tests of the explainer output on fixture data.

**Done when:** flagged moves show ranked drivers with reasons and confidence labels, at least one combined view renders from live data, and a backtest report exists.

**Guardrails:** no causal wording anywhere in the UI or strings; add a lint-style test that fails on banned phrases in the panel's text resources.

### Phase 6: Experience (M)

**Tasks**

1. **Onboarding:** role, commodities and home region, optional keys, then load a template workspace. Keys optional so the app works immediately.
2. **Templates:** Farmer, Trader, Analyst and Student workspaces as JSON.
3. **Panel configuration forms:** generate forms from each panel's JSON schema, with live preview.
4. **Alerts engine:** price and release alerts, evaluated after each data update, delivered through the notification plugin.
5. **Settings:** theme, units, data directory, export workspace, export data to CSV.
6. **Accessibility pass:** keyboard reachability, contrast, labels, and text or symbols alongside color for status.

**Done when:** a new user reaches a useful workspace in under a minute, measured on a clean install.

### Phase 7: Plugin Ecosystem (L)

**Tasks**

1. **Manifest schema** and validation errors a contributor can act on.
2. **Permission enforcement in the HTTP client:** a plugin can only reach hosts listed in its permissions. Enforce this in one place so it cannot be bypassed.
3. **Plugin manager UI:** install from file or registry, review permissions, enable, disable, remove.
4. **Convert built-in connectors** to manifests where the declarative format allows it, to prove the format.
5. **Panel plugins:** sandboxed iframe, a `postMessage` API (`query`, `subscribe`, `settings`), and permission checks on every request.
6. **Analysis plugins:** declarative expressions first (a small expression evaluator), then a `wasmtime` runtime with fuel limits and no ambient access.
7. **Registry:** a Git repository of manifests with checksums, plus contributor docs and a plugin template.

**Tests:** a malicious-plugin suite (disallowed host, oversized response, infinite loop in WASM, panel requesting unpermitted data) that must all fail safely.

**Done when:** a third party installs a plugin they wrote, from the registry, with no change to the app.

### Phase 8: Hardening and Release (M)

**Tasks**

1. Error-path review: every connector failure mode produces a clear UI state.
2. Performance pass against the budgets in section 5.
3. Packaging and code signing for macOS and Windows, Linux packages, and the auto-updater.
4. Data-license audit: attribution shown where required, non-commercial limits documented, no bundled third-party data.
5. Documentation site: user guide, key setup guides, plugin authoring.
6. Release checklist and a beta program.

**Done when:** installers exist for all three platforms and a clean machine passes the onboarding flow.

## 5. Cross-Cutting Practices

**Testing**

- Unit tests for parsers, scoring, scheduling and the command grammar.
- Recorded fixtures for every connector, refreshed deliberately.
- Nightly live contract tests (ignored by default) that open an issue when an API changes.
- Frontend component tests with vitest and Testing Library.
- A small end-to-end smoke test that launches the app against the fixture source.

**Performance budgets**

- Cold start under 3 seconds.
- Command bar response under 100 ms.
- Charts stay smooth on 5+ years of daily data (downsample for display if needed).
- Each IPC query under 50 ms from local storage.

**Security and privacy**

- Keys only in the OS keychain, never logged.
- No telemetry by default.
- Plugins sandboxed, with permissions shown before enabling.

**Data integrity**

- Never overwrite an observation; add a new revision.
- Always store `released_at` so combined views cannot look ahead.

## 6. Spikes to Run Before the Related Build

Each spike is a one-day script that calls the real API, saves the response as a fixture, and answers a specific question.

| Spike | Question | Decides |
| --- | --- | --- |
| Databento daily bars | How soon after the close do daily bars appear, what do continuous front-month symbols look like, and what does a typical user's monthly cost look like? | Phase 1 connector design and the freshness label wording |
| USDA AMS (MARS) grain | Which grain cash and basis reports exist in the API, at what geography, and in what format? | Whether phase 4 includes a basis panel |
| WASDE and PSD | Which machine-readable formats exist, and does PSD plus export sales cover the needed fields? | Phase 3 supply and demand connector |
| Drought Monitor | What are the exact endpoints, geographies and response formats, and is a key really not needed? | Phase 3 drought connector |
| GDELT archive | Is there a workable archive for news older than a few months for backtesting? | Phase 5 backtest scope |
| NASS query shapes | Which queries return the needed series under the record cap? | Phase 3 NASS connector |

## 7. Critical Path and Dependencies

1. Phase 1 gates everything, because it validates the data model, storage and IPC.
2. Phase 2 can start in parallel with phase 3 connector work once the registry and workspace contracts exist.
3. Phase 5 needs the news table and calendar (phases 3 and 4) and the as-of join.
4. Phase 7 should not start until the declarative loader from phase 3 has handled at least four real sources.
5. Combined views depend on `released_at` being correct for every connector, so make that a required field in connector tests from phase 3.

## 8. Risks During Implementation

| Risk | Response |
| --- | --- |
| A free API changes or rate-limits | Fixtures catch parser breaks; nightly contract tests flag changes; connectors are swappable |
| Key setup scares off new users | The app works with no keys; guided setup; a test-connection button |
| USDA grain coverage is poor | The spike decides early; skip the basis panel rather than ship a weak one |
| Move explainer is wrong too often | Backtest first; conservative labels; a visible "no clear driver found" state |
| Workspace complexity grows | Keep the panel contract small and versioned; migrate saved workspaces by version number |
| Heavy dependencies slow builds | Add DuckDB, Polars and wasmtime only in the phase that needs them |
| Non-commercial data terms limit monetization | Track terms per source; keep sources swappable |

## 9. First Ten Tasks

If you start tomorrow, do these in order:

1. Set up CI with fmt, clippy and tests on three OSes.
2. Add `tracing` and the app data directory layout.
3. Write the `core` types and `SourceError`.
4. Write the SQLite migration runner and the first migration.
5. Implement `upsert_observations` and `query_series`, with tests.
6. Build the CSV fixture source and load sample corn prices.
7. Implement `get_series` and the `data-updated` event.
8. Build the `useSeries` hook and the price chart panel.
9. Add the freshness label under the chart.
10. Run the Databento spike and write its connector against the recorded response.

At that point phase 1 is done, and you can decide how fast to move on phase 2 and phase 3.
