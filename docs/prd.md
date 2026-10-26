# AgriTerminal: Product Requirements Document

*Working name. High-level draft v0.2, October 18, 2026.*

## 1. Overview

AgriTerminal is a free, open source, standalone desktop application that gives farmers, merchants, analysts and students a Bloomberg-style terminal for agricultural commodity markets. It combines futures prices, USDA supply and demand data, CFTC positioning, crop conditions, drought and weather data, and news in a configurable, keyboard-driven workspace. Its distinguishing ideas are **combined views** that line up independent data sources on one timeline, and a **move explainer** that suggests what may have influenced a price move.

It is built with Rust and Tauri. Public government data sources are free. Futures prices come from a licensed provider using a key that each user supplies, so the project never redistributes exchange data.

## 2. Problem and Opportunity

- Professional terminals cost $25k or more per seat, which prices out farmers, co-ops, small merchants, students and independent analysts.
- Agricultural data is scattered across USDA, CFTC, NOAA and trade press, each with its own format, key and release schedule.
- Existing open source tools (such as OpenBB) are general-purpose and weak on ag-specific data such as crop progress, drought and basis.
- Most key ag data is free and public but has no good unified interface, and no free source of futures prices is both reliable and clearly licensed for apps.

**Opportunity:** a focused, free, ag-first terminal that combines fundamentals, positioning, weather and basis in one place and shows how they relate, which general terminals do poorly.

## 3. Goals and Non-Goals

**Goals**

1. Deliver a useful terminal for grains and oilseeds (corn, soybeans, wheat first) using public data plus a user-supplied futures price key.
2. Provide a fast, keyboard-first, highly configurable panel workspace.
3. Make data freshness and source reliability always visible.
4. Show combined views that relate weather, crop condition, supply, demand, positioning and price.
5. Build an extensible plugin system so the community can add sources, panels and analyses.
6. Work offline-first with local caching.

**Non-goals (v1)**

- Real-time exchange data or paid benchmark feeds (Platts, Argus, Fastmarkets).
- Bundling or redistributing exchange or vendor data. Users bring their own keys.
- Trading, order execution or brokerage integration.
- Energy and metals coverage.
- Cloud accounts, sync or hosted services.
- Mobile apps.
- Claims of proven cause for price moves. The move explainer reports possible drivers only.
- Price forecasts or trade recommendations. Combined views show relationships, not predictions.

## 4. Target Users

| Persona | Needs |
|---|---|
| Farmer or grower | Local cash bids and basis, weather, simple price and report alerts |
| Grain merchant or elevator | Basis tracking, spreads, positioning, report calendar |
| Independent analyst or trader | Supply and demand, seasonality, COT, multi-panel layouts, combined views |
| Student or researcher | Free access, clean data, guided onboarding, exportable data |

## 5. Product Principles

- **Keyboard first.** A command bar is the primary navigation (for example `ZC`, `COT ZS`, `WASDE`, `WX IOWA`).
- **Dense but readable.** Dark theme, compact layout, color used only for meaning.
- **Honest about data.** Every datapoint shows its source and freshness. Delayed data is never presented as real-time.
- **Never blocked.** If a source fails, cached data is shown with a stale label.
- **Configurable by default.** Users build and share their own workspaces.
- **Indicators, not predictions.** Analytical views describe what data shows and avoid implying forecasts or causes.

## 6. Scope: MVP (v1.0)

**Commodities:** corn, soybeans, wheat, with soybean meal and oil as fast follows.

**Core features**

1. **Workspace and panels:** dockable, resizable, tabbed panels, multiple saved workspaces, pop-out windows for multi-monitor use, auto-save and restore.
2. **Command bar:** autocomplete for commodities, functions and workspaces.
3. **Panel types (MVP):**
   - Price chart with seasonal average and range overlays
   - Move explainer: flagged price moves with ranked possible drivers (section 7a)
   - Combined views (section 6a)
   - Cash and basis table (USDA AMS), subject to coverage confirmation (section 8)
   - COT positioning with historical percentile
   - Supply and demand (PSD balance sheet and export sales)
   - Crop progress and condition (NASS)
   - Weather and drought map for crop regions
   - News feed
   - Watchlist
4. **Link groups:** color-coded groups so changing the commodity in one panel updates all linked panels.
5. **Panel configuration:** settings forms auto-generated from each panel's schema, with a live preview.
6. **Templates:** role-based starter workspaces (Farmer, Trader, Analyst, Student).
7. **Alerts and calendar:** price and report-release alerts with OS notifications, plus a USDA/CFTC report calendar.
8. **Data source management:** status, last refresh, schedule, enable/disable, retry controls, and guided API key setup with a "test connection" button for each source that needs a key.
9. **Import and export:** workspaces as JSON files; data export to CSV.
10. **Onboarding:** short first-run setup that loads a working workspace with real data quickly. Keys are optional at first so the app is useful before any are added.
11. **Move explainer widget:** detects significant price moves on a chart and lists ranked, source-linked news and scheduled events that may have influenced them, each with a confidence label and the reasons behind it.

## 6a. Combined Market Views

Each data source answers one question about the market. Prices tend to move along a chain: weather, then crop condition, then yield, then supply, then price, with demand and fund positioning acting on top. Any single source shows one link. These views line sources up so users can see where the links agree or disagree.

| View | Combines | What it shows |
|---|---|---|
| Crop stress timeline | Price, NASS crop condition, Drought Monitor percentages, weather forecast | Stacked charts on one shared time axis against the five-year range, showing the weather-to-price chain as it plays out |
| Supply vs positioning map | PSD stocks-to-use, price percentile, COT positioning | A scatter of supply tightness versus price level, with points colored by fund positioning, highlighting crowded or lopsided setups |
| Demand pulse | Weekly export sales, USDA projection pace, five-year average, price | Whether cumulative demand is keeping pace with the projection, with price underneath |
| Market scorecard | Weather, crop condition, demand, positioning, macro (FRED), price momentum | A row of gauges, each shown as a percentile versus history, giving a quick overall picture |
| Year analog finder | Current-season price and crop-condition paths versus past seasons | Overlays the current year on historical years and highlights the closest matches |
| Everything timeline | Price with markers for reports, export surprises, drought changes, COT extremes and news | A single event-annotated chart that also feeds the move explainer |

**Requirements**

- Align sources by release date, not just period date, because sources update at different rates (daily, weekly, monthly).
- Show each series' source and freshness inside the view.
- Present percentiles and ranges as descriptive indicators, with no predictive wording.
- Let users choose which series appear in each view.

## 7. Key User Flows

1. **First launch:** choose role, pick commodities and home region, optionally add API keys, land in a template workspace.
2. **Daily loop:** open app, workspace restores, scan ticker strip and report calendar, drill into a commodity through the command bar, linked panels update.
3. **Build a workspace:** add panels from the library, configure them, set link groups, arrange, save, optionally export.
4. **Commodity deep dive:** price and seasonality, supply and demand, positioning, weather, crop condition and news for one commodity, including a combined view.
5. **Alerts:** create an alert, receive an OS notification, click through to the relevant panel.
6. **Source troubleshooting:** a source fails, status turns amber, cached data stays visible, background retry runs, status clears.
7. **Understand a move:** click a flagged move or drag a range on a chart, review ranked possible drivers with confidence and reasons, open the source article, pin or dismiss drivers.
8. **Add a key:** open source management, follow the guided steps for a source that needs a key, paste it, test the connection, and see the related panels fill with data.

Wireframes for the main workspace, onboarding, settings and data sources, panel configuration, and the move explainer widget are in the accompanying design canvas. A wireframe for combined views has not been created yet.

## 7a. Move Explainer Widget

The move explainer flags unusual price moves on a chart and shows ranked news and scheduled events that may have influenced them. It reports possible drivers, never proven causes.

**How it works**

1. **Detect:** flag moves beyond a volatility-based threshold (for example, a daily return larger than 2 standard deviations of recent returns), or let the user click or drag a range on the chart.
2. **Collect:** gather news and scheduled events in a window around the move (for daily data, from the prior close to the move).
3. **Filter:** keep items relevant to the commodity using keyword and entity matching, plus embeddings or a small language model for relevance.
4. **Score:** rank each candidate on timing, relevance, source quality, and whether its direction fits the move.
5. **Display:** show markers on the chart and a ranked list in a side panel, each item with a confidence label and the reasons behind it.

**Confidence tiers**

| Tier | Criteria | Label shown |
|---|---|---|
| Scheduled event | A release with an exact timestamp (WASDE, crop progress, export sales, COT) lands at the time of the move | Likely driver |
| Single dominant story | One highly relevant article shortly before the move and no strong competitor | Possible driver |
| Several or weak candidates | Multiple plausible stories, or low relevance scores | Possible driver, low confidence |
| No match | Nothing scores above the threshold | No clear driver found |

**Requirements**

- Use wording such as "possible driver". Never "caused by".
- Show the move and article timestamps, the source name, and a link to the original.
- Show the reasons behind each score (timing, relevance, direction fit).
- Let users tune detection sensitivity, and pin, dismiss or annotate a driver.
- Work on cached news when offline, with stale labels.
- Store only headlines, summaries and links for sources that restrict republishing.
- Any language-model summary (later phase) must cite its article, avoid causal wording, and state its uncertainty.

**Limits to design around**

- Daily data blurs timing, so several same-day stories cannot be told apart. Intraday data improves this, but free intraday data is limited.
- The GDELT article search covers only roughly the last three months and returns at most 250 results per request, so it supports live news but not deep historical backtesting. Older news would need GDELT's bulk files or another archive, which still needs to be verified.
- Many moves come from positioning, spreads, other markets or macro news with no matching headline.

**Validation:** backtest against known events (past WASDE surprises, droughts, export bans) and measure how often the top-ranked candidate is correct. Set the accuracy target after the first backtest.

**Phasing**

1. Move detection and scheduled-event attribution, using free data.
2. Ranked news candidates from GDELT and RSS, with confidence labels.
3. Intraday timing if an optional licensed data plugin is added.
4. Language-model summaries, with the rules above enforced.

## 8. Data Sources

This section reflects a verification pass against public documentation in October 2026. Terms, limits and endpoints change, so re-verify each source before building on it. Items marked "unconfirmed" were not verified.

| Source | What it provides | Why it is useful | Access and limits | Priority |
|---|---|---|---|---|
| **Futures prices: Massive** (formerly Polygon.io; user-supplied key) | CME, CBOT, NYMEX and COMEX futures, including daily session bars with settlement prices | Price is the market's verdict, and every other source is judged against it | Free Futures Basic plan for individual, non-professional use: 5 requests per minute, 2 years of history, data roughly 8 hours behind; paid plans from $29 a month add history and fresher data; no continuous contracts, so the app builds the front month from contract volume; exchange licensing terms pass through to the user | 1 |
| **CFTC Commitments of Traders** | Weekly positions of managed money, commercials and swap dealers | Shows crowding and hedger behavior | Open data API at publicreporting.cftc.gov; released Fridays at 3:30 p.m. Eastern; publication was interrupted Oct 1 to Nov 12, 2025 during a funding lapse, so expect occasional gaps | 1 |
| **USDA NASS QuickStats** | Crop progress, crop condition, production statistics | Early read on yield, weekly during the season | Free API key; 50,000-record cap per query | 1 |
| **USDA FAS OpenData** | PSD supply and demand balance sheets, weekly export sales, trade data | Stocks-to-use and demand pace | Free API key from the FAS portal; WASDE report formats are unconfirmed | 1 |
| **US Drought Monitor** | Weekly drought severity by county and state, spatial maps, history since 2000 | Weather stress that has already happened | Official REST services from the University of Nebraska-Lincoln; third-party documentation indicates no key is needed | 1 |
| **NWS API (api.weather.gov)** | US forecasts, alerts and observations | Weather stress that is coming (US) | No key; a descriptive User-Agent header is required; rate limit not public; the NWS says an API key is planned for the future | 2 |
| **Open-Meteo** | Global forecasts and historical weather data | Global weather coverage | Free for non-commercial use under 10,000 calls per day (5,000 per hour, 600 per minute); attribution required; commercial use needs a paid plan | 2 |
| **USDA AMS MARS** | Cash prices, basis and market reports | The local price view that matters to farmers and elevators | Register at My Market News for a personal API key; endpoint is marsapi.ams.usda.gov; grain coverage is unconfirmed, and some grain reports are published as PDFs and regional or terminal-level rather than per-elevator | 2 (spike early) |
| **FRED** | Macro series such as the dollar, interest rates and inflation | Macro backdrop | Free key; 120 requests per minute; some series carry the original provider's copyright | 2 |
| **GDELT DOC API** | News article search | Live news for the move explainer | No key; roughly three months of article search; at most 250 results per request; no guaranteed rate limit | 2 |
| **World Bank Pink Sheet** | Monthly prices for about 71 commodities since 1960 | Long-run history overlay | Excel download whose URL hash changes monthly, which makes scraping fragile; reported as CC BY 4.0 | 3 |
| **IMF commodity prices (PCPS)** | Commodity price indices and prices | Long-run history, overlaps with FRED and World Bank | Moved to the new SDMX 3.0 portal at data.imf.org; expect migration churn | 3 |
| **UN Comtrade** | Bilateral trade flows | Trade context | Free key allows 500 calls per day and 100,000 records per call; data lags | 3 |
| **Satellite data (NASA, Copernicus)** | Vegetation and crop health | Yield signal | Unconfirmed; post-v1 | 3 |
| **Yahoo-style unofficial feed** | Convenience futures prices | Development fallback only | Unofficial; personal-use terms; one endpoint reportedly stopped working in January 2026; never the default | Fallback |

**Dropped:** Stooq. It now requires a key obtained through a CAPTCHA, its free license is non-commercial, and users report that futures data is not downloadable.

**Replaced:** Databento, the first price connector. It offers 16+ years of history, but it bills by usage once its free credits expire. Massive's free plan covers daily grain bars, so users don't need to pay to get real prices.

**Notes**

- The free Massive plan is licensed for individual use through a key that each user supplies, so the project never redistributes exchange data. The app shows clearly when prices are unavailable and keeps the price connector swappable.
- News is shown as headlines and links, not republished articles.
- Several sources need a free key (NASS, FAS, MARS, FRED, Comtrade). The app should work before any are added and guide users through each one.

## 8a. Data Source Priorities

- **Priority 1 (core, build in phase 3):** futures prices, CFTC COT, NASS, FAS (PSD and export sales), Drought Monitor.
- **Priority 2 (phase 4):** NWS and Open-Meteo weather, FRED, GDELT, and USDA AMS cash and basis once coverage is confirmed.
- **Priority 3 (later):** World Bank Pink Sheet, IMF, UN Comtrade, satellite data.

## 9. Technical Architecture (High Level)

- **Shell:** Tauri desktop app (Windows, macOS, Linux).
- **Backend (Rust):** async connectors behind a common `DataSource` trait (tokio, reqwest, serde); scheduler tuned to each source's cadence; normalizer to a common data model; analytics with Polars (seasonality, spreads, percentiles).
- **Storage:** SQLite for settings, metadata and news; DuckDB or Parquet for time series.
- **Frontend:** TypeScript with React or Svelte; dockable layout engine; TradingView Lightweight Charts and ECharts; MapLibre for maps; TanStack Table.
- **IPC:** Tauri commands for queries and events for pushed updates.
- **Security:** user API keys stored in the OS keychain; plugins sandboxed.
- **Data lineage:** source and fetch time stored with every datapoint, so views can align series by release date.

## 10. Plugin System

A plugin lets someone add to the app without changing its code. The app provides the slots and plugins fill them. There are three kinds.

| Kind | Does what | Has UI? | Can be declarative? |
|---|---|---|---|
| Data source | Brings data into the common data model | No | Yes |
| Panel | Adds a new widget to the screen | Yes | No (HTML and JavaScript) |
| Analysis | Computes new series from existing data | No (shows in other panels) | Yes for simple math, WASM for complex logic |

**Phases**

- **Phase 1:** declarative plugins (TOML or JSON) describing HTTP sources and field mappings to the common data model. Safe, no code execution. The first built-in connectors are written this way.
- **Phase 2:** WASM plugins in a sandbox with explicit, user-visible permissions (for example, allowed network hosts).
- **UI plugins:** custom panels in sandboxed iframes with a host message API.
- **Distribution:** a Git-based plugin registry. Native dynamic libraries are explicitly not supported.

**Data source plugin (example)**

```toml
name = "usda-ams"
version = "0.1.0"
kind = "source"
permissions = ["network:marsapi.ams.usda.gov"]
schedule = "daily"
auth = { type = "api_key", setting = "usda_ams_key" }

[request]
url = "https://marsapi.ams.usda.gov/services/v1.2/reports"
format = "json"

[mapping]
date     = "report_date"
location = "market_location"
price    = "avg_price"
basis    = "basis_value"
```

The endpoint and field names are illustrative, and the real report IDs and fields must be confirmed against the MARS documentation.

**Panel plugin (example)**

```toml
name = "crop-condition-map"
version = "0.1.0"
kind = "panel"
entry = "panel.html"
permissions = ["data:crop_condition", "data:weather"]

[settings]
commodity = { type = "enum", options = ["corn", "soybeans", "wheat"], default = "corn" }
metric    = { type = "enum", options = ["good_excellent", "poor_very_poor"], default = "good_excellent" }

[link]
listens_to = ["commodity"]
```

The panel runs in a sandboxed iframe, asks the host for data it has permission to read, and only draws. The app fetches, stores and permission-checks all data.

**Analysis plugin (example)**

```toml
name = "soy-corn-ratio"
version = "0.1.0"
kind = "analysis"

[inputs]
a = { series = "ZS", field = "close" }
b = { series = "ZC", field = "close" }

[output]
name = "Soy/Corn ratio"
expr = "a / b"
unit = "ratio"
usable_as = ["chart_overlay", "table_column", "alert_source"]
```

These manifest shapes are a proposed design, not a standard. Field names and permission strings will be finalized when the plugin loader is built.

## 11. Non-Functional Requirements

- **Performance:** cold start under 3 seconds; command bar response under 100 ms; smooth charting on 5+ years of daily data.
- **Reliability:** offline-first; no crash or blocked UI when a source fails; automatic retry with backoff.
- **Privacy:** no telemetry by default; all data and keys stay on the user's machine.
- **Accessibility:** full keyboard operation, sufficient contrast, labelled controls, and status shown with text or symbols as well as color.
- **Portability:** workspaces and settings are plain files that are easy to back up and share.
- **Licensing:** permissive open source license (to be decided). Respect each data source's terms, including attribution requirements and non-commercial limits.

## 12. Success Metrics

- Time to first useful workspace: under 60 seconds from first launch.
- Weekly active users and 30-day retention.
- Share of users who customize or save a workspace.
- Share of users who add at least one optional data key.
- Number of community-contributed plugins and workspaces.
- GitHub stars, contributors and issue-resolution time.
- Data uptime: percentage of scheduled refreshes that succeed.
- Move explainer: usage, and the share of suggested drivers users pin versus dismiss.
- Combined views: usage per view type.

## 13. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Free APIs change, break or rate-limit | Swappable connectors, caching, source status UI, community maintenance |
| No reliable free futures price source | User-supplied key for a licensed provider; optional unofficial fallback labeled best-effort; clear "prices unavailable" state |
| Exchange data licensing | Never bundle or redistribute data; users bring their own keys; review terms per provider |
| Key setup friction (several free keys) | App useful before any keys are added; guided setup with test-connection; optional keys |
| Federal data outages or API migrations (for example the 2025 funding lapse, USDA platform migration) | Cache everything, show stale labels, keep connectors swappable |
| USDA AMS grain coverage is unconfirmed | Spike the connector early; fall back to NASS, FAS and regional reports if coverage is poor |
| Non-commercial licenses (Open-Meteo, Stooq-style terms) if the project is ever monetized | Track license terms per source; keep sources swappable; use paid plans if monetized |
| Licensing or redistribution limits on news | Link out for news; store only headlines, summaries and links |
| Scope creep into other commodity groups | Hold v1 to grains and oilseeds; add verticals via plugins |
| Frontend complexity of a configurable workspace | Build panel registry and layout engine first; ship few, well-built panels |
| Small contributor base | Clear plugin docs, good first issues, role templates that attract varied users |
| Users read move attributions as proven causes | Probabilistic labels, no causal wording, visible reasons, and a "no clear driver found" result |
| Combined views read as predictions | Descriptive indicators only, no predictive wording, visible sources and freshness |
| Thin free news history and daily-only timing weaken attribution | Start with scheduled events, add GDELT for recent news, offer intraday data through an optional licensed plugin |

## 14. Build Phases

Build in vertical slices, so every phase ends with something runnable. Sizes are relative effort (S, M, L), not calendar time.

| Phase | Goal | Key deliverables | Done when | Size |
|---|---|---|---|---|
| 0. Setup | Working dev environment | Rust and Node installed, Tauri app scaffolded, git repo, CI, lint and format | `npm run tauri dev` opens a window and CI builds on all three OSes | S |
| 1. Vertical slice | Prove the pipeline end to end | `DataSource` trait, one price connector (Massive with a user key, originally Databento, plus a development fallback), local storage, one Tauri command, one chart panel | A corn price chart renders from cached local data | M |
| 2. Workspace shell | The terminal feel | Layout engine, panel registry, command bar, link groups, save and load workspaces, dark theme | A user can open, arrange and restore three panels using the command bar | M |
| 3. Core data | Real fundamentals | Scheduler, freshness tracking, declarative plugin loader, CFTC, NASS, FAS and Drought Monitor connectors, matching panels, guided key setup | COT, crop condition, supply and demand, and drought panels show live data with stale labels | L |
| 4. Weather, news and basis | Context | NWS and Open-Meteo, weather map, GDELT and RSS news feed, report calendar, USDA AMS cash and basis if coverage is confirmed | Weather and news panels follow the selected commodity | M |
| 5. Combined views and move explainer | The differentiators | Combined views (crop stress timeline first), move detection, scheduled-event attribution, ranked news candidates, confidence labels, backtest set | Flagged moves show ranked drivers, a combined view renders from live data, and a backtest report exists | L |
| 6. Experience | Usable by newcomers | Onboarding, templates, settings and source status, alerts and notifications, panel configuration forms | A new user reaches a useful workspace in under 60 seconds | M |
| 7. Plugin ecosystem | Open to contributors | Plugin manager and permission review, panel and analysis plugins, WASM runtime, registry repo, plugin docs | A third-party plugin installs and runs with no app changes | L |
| 8. Hardening and release | Ship it | Tests, error handling, packaging and signing, auto-updater, docs site, license, contributor guide | Installers for macOS, Windows and Linux; public v1.0 | M |

**Ordering notes**

- Phase 1 proves the whole pipeline before anything else is built.
- Phase 3 builds the first connectors as declarative plugins, so the plugin interface is tested on real data from the start. Phase 7 opens it to outsiders.
- The core of the application is usable at the end of phase 3. Show it to a few early users then, and get feedback before investing in phases 4 to 8.
- Phase 5 depends on the news feed and report calendar from phases 3 and 4.
- Add heavy dependencies (DuckDB, Polars, wasmtime) only in the phase that needs them, since they slow compile times.

## 15. Environment Setup and Scaffolding

Versions and flags change, so if a command fails, check Tauri's [prerequisites](https://v2.tauri.app/start/prerequisites/) and [create a project](https://v2.tauri.app/start/create-project/) guides.

**Step 1: Install prerequisites**

```bash
# Rust (all platforms)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup update
rustc --version

# Node.js LTS: install from nodejs.org or a version manager, then check
node --version
npm --version
```

Platform dependencies:

```bash
# macOS (desktop apps): Xcode Command Line Tools
xcode-select --install

# Debian or Ubuntu Linux
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

On Windows, install the Microsoft C++ Build Tools with the "Desktop development with C++" workload. WebView2 is already included on current Windows 10 and Windows 11.

**Step 2: Scaffold the app**

```bash
npm create tauri-app@latest agri-terminal
```

Suggested answers to the prompts: identifier `com.example.agriterminal`, language TypeScript, package manager npm, template React (or Svelte), flavor TypeScript. Then:

```bash
cd agri-terminal
npm install
npm run tauri dev
```

A desktop window should open. If it does, the toolchain is working.

**Step 3: Add Rust dependencies**

```bash
cd src-tauri
cargo add tokio --features full
cargo add reqwest --features json
cargo add serde --features derive
cargo add chrono --features serde
cargo add serde_json toml csv calamine feed-rs keyring anyhow thiserror async-trait tracing tracing-subscriber
cargo add rusqlite --features bundled
cd ..
```

Add these later, when the phase needs them (long first compile):

```bash
cd src-tauri
cargo add duckdb --features bundled
cargo add polars --features lazy,csv,parquet
cargo add wasmtime
cd ..
```

Tauri plugins (these update both the Rust and JavaScript sides):

```bash
npm run tauri add notification
npm run tauri add store
```

**Step 4: Add frontend dependencies**

```bash
npm install zustand @tanstack/react-query @tanstack/react-table
npm install lightweight-charts echarts maplibre-gl
npm install dockview cmdk date-fns
npm install -D vitest @testing-library/react prettier eslint
```

For styling, add Tailwind by following its Vite setup guide, or use plain CSS variables for the dense terminal look.

**Step 5: Create the folder structure**

```bash
mkdir -p src-tauri/src/{core,sources,store,analytics,commands,plugins,scheduler}
mkdir -p src/{panels,workspace,command-bar,state,lib}
mkdir -p plugins/builtin docs
```

Each new Rust folder needs a `mod.rs` file and a `mod` line in `main.rs` or `lib.rs`.

**Step 6: Start version control**

```bash
git init
git add -A
git commit -m "Scaffold Tauri app"
```

**Everyday commands**

```bash
npm run tauri dev      # run the app with hot reload
npm run tauri build    # build a production installer
cd src-tauri && cargo test      # Rust tests
cd src-tauri && cargo clippy    # Rust lint
cd src-tauri && cargo fmt       # Rust format
npx vitest             # frontend tests
```

For CI, use a GitHub Actions workflow with Tauri's official `tauri-apps/tauri-action` to build macOS, Windows and Linux installers on each release.

## 16. Open Questions

- Final product name, branding and open source license.
- Should an unofficial futures price fallback ship at all?
- Whether the free Massive plan's 2 years of history is enough for seasonal ranges, or users need a one-time backfill from a paid plan.
- Whether USDA AMS (MARS) exposes enough grain cash and basis data to support a basis panel.
- WASDE machine-readable formats, and whether PSD and export sales cover the needed fields.
- How to present guided key setup so that several free keys do not put off new users.
- React or Svelte for the frontend.
- Depth of weather and satellite features in v1 versus later.
- Whether to support non-US markets and regional data (Brazil, EU, Black Sea) early.
- Governance model for the plugin registry and community contributions.
- Funding and sustainability approach (donations, sponsorship, optional paid data add-ons), and how it interacts with non-commercial data licenses.
- Move explainer: default detection threshold, whether users can tune it, and how accuracy is measured and targeted.
- Move explainer: source for older news to support backtesting beyond GDELT's roughly three-month article search.
- Move explainer: whether a language-model summary step ships in v1 or later.
- Combined views: which view ships first (crop stress timeline is the suggested starting point) and how percentiles are calculated.

## 17. Sources and Verification Notes

Findings were gathered in October 2026 from public documentation and third-party library documentation. Re-verify before building. Key references:

- Massive futures pricing: https://massive.com/pricing?product=futures, and futures REST docs: https://massive.com/docs/rest/futures/aggregates
- USDA AMS My Market News and MARS API: https://mymarketnews.ams.usda.gov/mymarketnews-api
- CFTC Commitments of Traders: https://www.cftc.gov/MarketReports/CommitmentsofTraders/AbouttheCOTReports/index.htm
- USDA NASS QuickStats API: https://quickstats.nass.usda.gov/api/
- US Drought Monitor data services: https://droughtmonitor.unl.edu/DmData/DataDownload/WebServiceInfo.aspx
- NWS API: https://www.weather.gov/documentation/services-web-API
- Open-Meteo terms: https://open-meteo.com/en/terms
- FRED API keys: https://fred.stlouisfed.org/docs/api/api_key.html
- UN Comtrade developer portal: https://comtradedeveloper.un.org/
- IMF commodity prices: https://data.imf.org/Datasets/PCPS
- Tauri v2 setup: https://v2.tauri.app/start/create-project/

Verification status: strongest for CFTC, NASS, FRED and the Open-Meteo terms. Weakest for USDA AMS grain coverage, the exact delay of Massive's free plan, WASDE formats, and the claim that the Drought Monitor requires no key (taken from third-party documentation). Several claims, such as the Yahoo endpoint failure and the Stooq download limits, come from third-party reports rather than the providers themselves.