# Crop nowcast fixtures

Recorded on 1 November 2026 for the Phase 0 source spike (`docs/research/nowcast-sources.md`). Files ending `_recorded` are real provider responses or excerpts of them; nothing here is invented. All sources are U.S. government public data, NASA or Copernicus open data, CC0 (gridMET), Open-Meteo (CC BY 4.0, credit Open-Meteo) or the Iowa Environmental Mesonet (free for any lawful use, credit IEM). No keys or signed URLs are stored.

## USDA NASS

- `nass_api_unauthorized_recorded.json`: the body of `api_GET` without a key (HTTP 401).
- `nass_bulk_*_recorded.tsv`: rows from the keyless bulk file `https://www.nass.usda.gov/datasets/qs.crops_20261031.txt.gz`, filtered to `SOURCE_DESC = SURVEY`, `DOMAIN_DESC = TOTAL`, and corn or soybeans. Only 18 of the file's 39 columns are kept: `SOURCE_DESC, COMMODITY_DESC, CLASS_DESC, PRODN_PRACTICE_DESC, UTIL_PRACTICE_DESC, STATISTICCAT_DESC, UNIT_DESC, SHORT_DESC, AGG_LEVEL_DESC, STATE_ALPHA, COUNTY_ANSI, COUNTY_NAME, YEAR, FREQ_DESC, REFERENCE_PERIOD_DESC, WEEK_ENDING, LOAD_TIME, VALUE`. Values are unchanged.
  - `yield_vintages`: corn grain and soybean yield (bu/acre), national, Iowa and Illinois, 2019–2026, every reference period. Shows the `YEAR - AUG/SEP/OCT/NOV FORECAST` vintages, the missing 2025 October forecast, and `YEAR` rows overwritten by later revisions.
  - `acreage_vintages`: corn and soybean planted acres, national and Iowa, 2024–2026, every reference period.
  - `condition_ia`: Iowa corn condition for October 2026 (release-time `LOAD_TIME`) and May–June 2005 (`LOAD_TIME` of a 2013 reload).
  - `county_yield_ia`: 2025 corn grain yield for Linn, Polk and Story counties.

## USDA WASDE and Crop Production

- `usda_wasde_report_data_2026_07_us_excerpt_recorded.csv`: the header and the United States corn and soybean area, production, yield and ending-stocks rows from `https://www.usda.gov/sites/default/files/documents/oce-wasde-report-data-2026-07.csv`. Read in a browser because usda.gov returns 403 to plain HTTP clients.
- `esmis_wasde0726_{corn,soybeans}_excerpt_recorded.xml`: the `sr12` (U.S. feed grain and corn) and `sr15` (U.S. soybeans and products) elements of `https://esmis.nal.usda.gov/sites/default/release-files/795974/wasde0726.xml`, unchanged, with an XML declaration added.
- `esmis_crop1026_{corn_t183,soybeans_t146}_recorded.csv`: unchanged tables from `https://esmis.nal.usda.gov/sites/default/release-files/796123/crop1026.zip` (Crop Production, 9 October 2026). Latin-1 encoded.

## Drought and weather

- `usdm_state_ia_2000-01_recorded.json`: USDM state statistics for Iowa, January 2000 (the first weeks of the record).
- `usdm_county_ia_2020-08-11_recorded.json`: USDM county statistics for Iowa, map of 11 August 2020.
- `open_meteo_archive_ia_2000-07_recorded.json`: Open-Meteo archive, 42.0 N 93.5 W, 1–5 July 2000, daily maximum and minimum temperature and precipitation.
- `gridmet_tmmx_das_recorded.txt`: OPeNDAP attributes of the gridMET daily maximum temperature aggregate on the Climatology Lab THREDDS server.

## Satellite catalogue

- `pc_stac_search_{collection}_ia_{asc,desc}_recorded.json`: Planetary Computer STAC search at 93.5 W 42.0 N, one item, sorted by date (`asc` is the oldest item, `desc` the newest), for `modis-13Q1-061`, `hls2-l30`, `hls2-s30`, `sentinel-2-l2a` and `usda-cdl`. Asset hrefs are unsigned.
- `pc_stac_collection_usda-cdl_recorded.json`: the `usda-cdl` collection document, whose temporal extent ends in 2021.
- `cropscape_getcdlstat_ia_2025_recorded.xml` and `cropscape_cdl_stat_ia_2025_recorded.csv`: CropScape `GetCDLStat` for Iowa 2025, and the CSV its `returnURL` points to.

## Storm reports

- `spc_200810_rpts_filtered_{wind,hail}_recorded.csv`: SPC daily storm reports for 10 August 2020 (Iowa derecho). Times are UTC.
- `spc_svrgis_2020_wind_ia_2020-08-10_excerpt_recorded.csv`: the header and the 140 Iowa rows for 10 August 2020 from `https://www.spc.noaa.gov/wcm/data/2020_wind.csv`. Times are CST (`tz = 3`).
- `iem_lsr_ia_2020-08-10T16_recorded.geojson`: IEM local storm reports for Iowa, 16:00–17:00 UTC on 10 August 2020.
- `iem_lsr_ia_2008-06-12_flood_recorded.geojson`: IEM local storm reports for Iowa, 00:00–06:00 UTC on 12 June 2008, including `FLOOD` and `FLASH FLOOD`.
