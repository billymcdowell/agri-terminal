# Recorded data fixtures

Fixtures are saved, unmodified provider responses where licensing permits. Keep a short note beside each fixture with the provider, retrieval date, request parameters, and any transformation applied before checking it in. Never commit API keys or data that the provider does not permit redistribution.

`corn_daily.csv` is deterministic demonstration OHLC data for the local fixture source. It is synthetic and must not be treated as market data.
# Phase 3 parser fixtures

`cftc_disaggregated_recorded.json` and `drought_monitor_recorded.json` are unmodified rows from the live CFTC Socrata dataset `72hh-3qpy` (corn, 2026-10-13 and 2026-10-20 reports) and the U.S. Drought Monitor state statistics service (Iowa, same weeks), retrieved 24 October 2026. Both are U.S. government public data. Earlier invented fixtures had the wrong shape (a date without a time, and capitalised drought keys), so the parsers passed their tests but failed against the real APIs; the nightly contract tests now assert the series that must come back.

`phase3_nass_synthetic.json` and `phase3_fas_synthetic.json` contain invented rows shaped to exercise the NASS and FAS parsers, because both APIs need a key. They follow the documented field names (`short_desc`, `unit_desc`, `class_desc`, `week_ending`; PSD `attributeId` with a lookup) but are not USDA measurements. Replace them with recorded responses once a key is available.

`phase4_*_synthetic.json` files contain invented forecast values for NWS and Open-Meteo parser tests. They are not provider observations or forecasts.
`phase4_news_synthetic.xml` contains invented RSS headlines used to test commodity filtering and feed parsing.

`massive_contracts_synthetic.json` and `massive_aggs_*_synthetic.json` copy the shape of Massive futures contracts and session-bar responses recorded on 26 October 2026, with invented prices and volumes, because Massive's exchange data may not be redistributed. The last session in each bar file has no `settlement_price`, as a session still in progress does.
