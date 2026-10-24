# AgriTerminal

AgriTerminal is an offline-first desktop workspace for agricultural commodity markets. The current vertical slice stores a clearly labeled synthetic corn OHLC fixture in SQLite and renders it through the local Tauri bridge.

## Development

Install dependencies with `npm install`, then start the desktop app with `npm run tauri dev`. The frontend uses React, TanStack Query, Lightweight Charts, and the shadcn components in `src/components/ui`. The Rust backend owns the SQLite database in Tauri's application data directory.

The corn fixture lives in `tests/fixtures/corn_daily.csv`. It is synthetic demonstration data, not a market quote. The chart and source status label it as demo data.

## Current implementation

- Local SQLite migration and observation storage, with release and fetch timestamps plus revision numbers.
- A fixture source for deterministic offline chart data.
- Tauri commands for series queries, source status, and refreshing the fixture view.
- A React Query hook that subscribes to `data-updated` events.
- A candlestick price panel with date range selection and source/freshness context.

The Databento connector, scheduler, workspace persistence, and additional market panels are still planned. No real market data is currently fetched.

See [the implementation plan](docs/AgriTerminal%20Implementation%20Plan.md) and [the product requirements](docs/prd.md) for the full roadmap.
