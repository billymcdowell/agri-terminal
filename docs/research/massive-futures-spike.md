# Massive futures spike

Checked 26 October 2026 with a free Futures Basic key against `https://api.massive.com`. Massive is the renamed Polygon.io. These notes pin the shape the `massive` connector relies on; recheck them before depending on anything new.

## Endpoints

- `GET /futures/v1/contracts?product_code.any_of=ZC,ZS,ZW&date=YYYY-MM-DD&active=true&type=single&limit=1000` lists every contract trading on that date: about 44 for the three grains. Tickers are root, month code and one year digit (`ZCZ6`, `ZSF7`). Each row carries `last_trade_date`, `trading_venue` (`XCBT`) and tick sizes. `sort` accepts only `date`, `product_code` or `ticker`, so the connector orders by expiry itself.
- `GET /futures/v1/aggs/{ticker}?resolution=1session&window_start.gte=YYYY-MM-DD&sort=window_start.asc` returns one bar per session with `session_end_date`, `open`, `high`, `low`, `close`, `volume` and `settlement_price`. Prices are in cents per bushel (`456` is $4.56).
- `GET /futures/v1/products?product_code.any_of=ZC,ZS,ZW` confirms all three are CBOT products of 5,000 bushels in USD. It returns one row per product per day since 2017, so it isn't useful at refresh time.
- The key works as `Authorization: Bearer <key>`, which keeps it out of URLs.

## Behaviour that shapes the connector

- **No continuous contract.** The connector requests the two nearest contracts of each root and, for every session, keeps the one with more volume. November soybeans showed the roll in progress: on 23 October the November contract still traded more, and on the 26th January had taken over.
- **The current session is returned before it settles**, without `settlement_price`. The connector skips such bars; the next refresh picks them up once settled. On the free plan, Friday's settled bar was already there when checked at midday on Monday.
- **History stops at two years on the free plan.** `ZCZ4` bars began on 2024-10-28; `ZCZ3` returned HTTP 200 with an empty `results` array, not an error.
- **Rate limit:** five requests a minute. The sixth returned HTTP 429 with an empty body and `x-ratelimit-reset: 49` (seconds), but no `Retry-After`. A refresh makes seven requests (one contract list, six bar requests), so on the free plan it waits once for the limit to reset.
