# Recorded data fixtures

Fixtures are saved, unmodified provider responses where licensing permits. Keep a short note beside each fixture with the provider, retrieval date, request parameters, and any transformation applied before checking it in. Never commit API keys or data that the provider does not permit redistribution.

`corn_daily.csv` is deterministic demonstration OHLC data for the local fixture source. It is synthetic and must not be treated as market data.
# Phase 3 parser fixtures

`cftc_disaggregated_recorded.json` and `drought_monitor_recorded.json` are unmodified rows from the live CFTC Socrata dataset `72hh-3qpy` (corn, 2026-10-13 and 2026-10-20 reports) and the U.S. Drought Monitor state statistics service (Iowa, same weeks), retrieved 24 October 2026. Both are U.S. government public data. Earlier invented fixtures had the wrong shape (a date without a time, and capitalised drought keys), so the parsers passed their tests but failed against the real APIs; the nightly contract tests now assert the series that must come back.

`phase3_nass_synthetic.json` and `phase3_fas_synthetic.json` contain invented rows shaped to exercise the NASS and FAS parsers, because both APIs need a key. They follow the documented field names (`short_desc`, `unit_desc`, `class_desc`, `week_ending`; PSD `attributeId` with a lookup) but are not USDA measurements. Replace them with recorded responses once a key is available.

`phase4_*_synthetic.json` files contain invented forecast values for NWS and Open-Meteo parser tests. They are not provider observations or forecasts.
`phase4_news_synthetic.xml` contains invented RSS headlines used to test commodity filtering and feed parsing.

`massive_contracts_synthetic.json` and `massive_aggs_*_synthetic.json` copy the shape of Massive futures contracts and session-bar responses recorded on 26 October 2026, with invented prices and volumes, because Massive's exchange data may not be redistributed. The last session in each bar file has no `settlement_price`, as a session still in progress does.

# River constraint fixtures

The files in `river/` were retrieved on 31 October 2026 without keys for the river constraint spike (see `docs/research/river-sources.md` for the full requests). All are U.S. government public data unless noted.

- `usgs_daily_stage_stlouis_recorded.json`: unmodified USGS Water Data OGC API v1 `daily` response for St. Louis (site `07010000`, gage height `00065`, statistic `30800`, the 08:00 reading), 24 to 30 October 2026, requested with `skipGeometry=true&sortby=time`.
- `nwps_stageflow_eadm7_recorded.json` and `nwps_stageflow_memt1_recorded.json`: NWS National Water Prediction Service `/gauges/{lid}/stageflow` responses for St. Louis and Memphis. The forecast block is unmodified; the observed block is cut to its last eight readings.
- `iem_hml_forecasts_eadm7_2022_recorded.csv` and `iem_hml_obs_memt1_2022_recorded.csv`: unmodified Iowa Environmental Mesonet HML archive extracts (one St. Louis forecast issued 1 October 2022, and Memphis hourly stage on 21 October 2022). IEM data may be used for any lawful purpose; credit the Iowa Environmental Mesonet of Iowa State University.
- `agtransport_barge_rates_recorded.json`: unmodified USDA AgTransport `deqi-uken` rows (downbound grain barge rates, percent of 1976 tariff) for the weeks ending 20 and 27 October 2026.
- `agtransport_lock_tons_recorded.json`: unmodified USDA AgTransport `n4pw-9ygw` rows (downbound grain tons by lock and commodity, from USACE) for the week ending 24 October 2026.
- `agtransport_grain_basis_gulf_synthetic.json`: the shape of USDA AgTransport `v85y-3hep` Louisiana Gulf rows for the week ending 23 October 2026, with invented `bid`, `futures_price` and `basis` values, because the rows carry exchange futures prices.
