# AgriTerminal

AgriTerminal is an offline-first desktop workspace for agricultural commodity markets. The first vertical slice provides a local SQLite price store, a clearly labeled synthetic corn fallback, and an optional Databento daily-bar connector.

## Development

Install dependencies with `npm install`, then start the desktop app with `npm run tauri dev`. The frontend uses React, TanStack Query, Lightweight Charts, and the existing shadcn components in `src/components/ui`. The Rust backend owns SQLite data in Tauri's application data directory.

The corn fixture lives in `tests/fixtures/corn_daily.csv`. It is synthetic demonstration data, not a market quote. AgriTerminal keeps it visibly labeled and uses it when no real Databento observations are cached.

## Price data

Add a Databento API key from **Data sources**. The key is stored in the operating system keychain and is never written to SQLite or logs. **Load prices** requests 30 days of `GLBX.MDP3` daily OHLCV for the continuous corn symbol; provider usage charges may apply. CME quotes corn in U.S. cents per bushel, so values are normalized to USD per bushel before storage and display. After a key is saved, a background refresh runs every 24 hours. Bars retain their source, release time, fetch time, unit, and revision.

## Current implementation

- Versioned SQLite schema and as-of series queries that select the latest visible revision.
- Separate fixture and Databento source modules behind a shared async source trait.
- Keychain storage for the Databento credential.
- Tauri commands and events for source refresh, status, cached series, and new data.
- React Query hooks and a candlestick price panel with range selection and a dynamic freshness label.
- A daily Databento refresh scheduler, started only when a key exists.

Workspace persistence, additional source connectors, CI checks, automated test coverage, and later roadmap phases are still outstanding. Logs rotate daily under the app data directory; SQLite, logs, plugin files, and cache each have their own location there. See [the implementation plan](docs/AgriTerminal%20Implementation%20Plan.md) and [the product requirements](docs/prd.md).
