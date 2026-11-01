# Crop nowcast source spike

Checked 1 November 2026 against the live services, without a NASS key or Cloudflare credentials. These notes pin what the crop nowcast work (see `docs/Crop Nowcast Plan.md`) can rely on. Recorded responses are in `pipelines/crop-nowcast/tests/fixtures/` and described in its `README.md`. Recheck a provider before depending on anything not listed here.

## Summary

| Data | Status | Source to use | Cadence and release | History |
| --- | --- | --- | --- | --- |
| Final yields and acreage | Confirmed | NASS Quick Stats (`YEAR` reference period) | Annual; revised the following September | County corn yield 1910–2025; state and national longer |
| USDA yield forecasts by vintage | **Confirmed, August to November only** | NASS Quick Stats `YEAR - AUG/SEP/OCT/NOV FORECAST` | Crop Production, 12:00 ET | National and state, 1974–2026 |
| USDA yield before August | Confirmed, national only | WASDE archive on ESMIS (XML per release) | WASDE, 12:00 ET | ESMIS XML; usda.gov CSV from April 2010 (browser only) |
| USDA acreage by vintage | Partly confirmed | Quick Stats `YEAR - MAR ACREAGE`, `YEAR - JUN ACREAGE`; ESMIS for older years | March 31, June 30 | Quick Stats: March from 2012, June from 2018 |
| Crop condition and progress | Confirmed | NASS Quick Stats, state level | Weekly, Monday 16:00 ET | Iowa corn condition from 1986 |
| Drought | Confirmed | USDM state and county statistics | Weekly, Thursday | From 2000-01-04 |
| Weather history | Confirmed | gridMET (Climatology Lab THREDDS); Open-Meteo as fallback | Daily, about 2 days behind | 1979 onward |
| Vegetation greenness | Confirmed, **but MODIS is ending** | Planetary Computer `modis-13Q1-061` | 16-day composites, Terra and Aqua offset by 8 days | 2000-02-18 onward |
| Crop type maps | Confirmed, **not on Planetary Computer after 2021** | NASS CropScape web services | Year Y published late February of Y+1 | 1997–2025 |
| HLS and Sentinel-2 | Confirmed | Planetary Computer `hls2-l30`, `hls2-s30`, `sentinel-2-l2a` | A few days after acquisition | HLS L30 from 2013, S30 from 2020; S2 L2A from 2015 |
| Soil moisture (Crop-CASMA) | **Not confirmed** | — | — | NASS metadata says 2015-03-31 to 2025-01-31 |
| Storm reports | Confirmed | IEM local storm reports (includes floods); SPC SVRGIS for final history | Near real time; SVRGIS yearly | SVRGIS 1950–2025; SPC daily CSV from 2004 |
| AI brief | **Docs confirmed, no test call** | Cloudflare AI Gateway REST API | — | — |

## USDA NASS Quick Stats

- API: `https://quickstats.nass.usda.gov/api/api_GET/`. Without a key it returns HTTP 401 with `{"error":["unauthorized"]}` (fixture). Each call returns at most 50,000 records; `get_counts` checks a query's size first. Operators such as `year__GE` are appended to parameter names. No numeric rate limit is published.
- Terms: services built on the API must show that the product "is not endorsed or certified by NASS". Add this to the nowcast credits.
- **Bulk files need no key.** `https://www.nass.usda.gov/datasets/` lists `qs.crops_YYYYMMDD.txt.gz` and four other sector files. On 1 November 2026 the newest was `qs.crops_20261031.txt.gz` (1.13 GB, `Last-Modified` 31 October 07:14 UTC), so it is refreshed about daily. Streaming it through a filter for corn and soybean survey rows took 3 minutes and produced 2.0 million rows. Columns are tab-separated and upper case (`SOURCE_DESC` … `VALUE`, `CV_%`); the API uses the same names in lower case. `VALUE` is text with thousands separators (`95,338,000`) and suppression codes such as `(D)`.
- The fixtures in this spike come from the bulk file because no key was available. The API's JSON shape was not recorded.

### Yield forecasts by vintage: confirmed

Quick Stats stores each month's forecast as its own reference period. For `CORN, GRAIN - YIELD, MEASURED IN BU / ACRE` and `SOYBEANS - YIELD, MEASURED IN BU / ACRE`:

- `YEAR - AUG FORECAST`, `YEAR - SEP FORECAST`, `YEAR - OCT FORECAST` and `YEAR - NOV FORECAST` exist at `NATIONAL` and `STATE` level. National corn forecasts run from 1974 to 2026 (53 years). In 2026 the August corn forecast covers 30 states plus `OT` (other states) and the soybean forecast 29, including all ten plan states.
- **`LOAD_TIME` on forecast rows is the release time**, for example `2018-08-10 12:01:40` and `2026-10-09 12:00:00`. These match the 12:00 Eastern release, so treat `LOAD_TIME` as Eastern time. NASS does not state the time zone.
- Values match the published reports: national corn 2020 was 181.8 (Aug), 178.5 (Sep), 178.4 (Oct) and 175.8 (Nov). Iowa corn 2026 was 216 (Aug), 219 (Sep) and 219 (Oct), and the September and October values match the October 2026 Crop Production table.
- **Missing vintages are missing, not filled.** There is no 2025 `OCT FORECAST`, because the October 2025 report was not issued during the funding lapse. The pipeline must not assume four vintages a year.
- **There are no June or July vintages.** NASS does not survey yields before August. USDA's May to July yields are WASDE projections, national only (below).
- **`YEAR` is overwritten in place, so it is not a vintage.** During the season it mirrors the latest forecast (2026 `YEAR` was 181.2 with `LOAD_TIME` 2026-10-09, the same as the October forecast). It is then replaced by the January annual estimate and again by the following September's revision (2023 loaded 2024-09-30, 2024 loaded 2025-09-30, 2025 loaded 2026-09-30). Use `YEAR` as the final label for finished seasons only, never for the current season, and do not expect the January vintage in Quick Stats.

### Acreage vintages: short history

For `CORN - ACRES PLANTED` and `SOYBEANS - ACRES PLANTED`, national and state:

| Reference period | Years present |
| --- | --- |
| `YEAR - MAR ACREAGE` (Prospective Plantings) | 2012–2026 |
| `YEAR - JUN ACREAGE` (Acreage) | 2018–2026 |
| `YEAR - AUG/SEP/OCT FORECAST` | Scattered, 2020–2026 |
| `YEAR - AUG ACREAGE`, `YEAR - OCT ACREAGE` | 2018–2019 only |

Older vintages are only in the report archive. ESMIS lists Acreage reports back to 1975 and Crop Production back to 1964, as PDFs for old years. The year machine-readable files begin was not checked.

### Condition, progress and county yields

- State condition rows (`CORN - CONDITION, MEASURED IN PCT EXCELLENT` and so on) go back to 1986 for Iowa. Progress categories: corn `PLANTED`, `EMERGED`, `SILKING`, `DOUGH`, `DENTED`, `MATURE`, and `CORN, GRAIN - PROGRESS, MEASURED IN PCT HARVESTED`; soybeans `PLANTED`, `EMERGED`, `BLOOMING`, `SETTING PODS`, `COLORING`, `DROPPING LEAVES`, `HARVESTED`.
- **Historical `LOAD_TIME` is a reload date, not the release.** Recent weeks carry the Monday 16:00 release (week ending 2026-10-25 loaded 2026-10-26 16:00), but 2005 rows all carry `2013-01-01 12:00:00`. Compute `released_at` from `WEEK_ENDING` plus one day at 16:00 Eastern, as the app's NASS connector already does.
- **The app's NASS connector is national only, from 2015** (`agg_level_desc = NATIONAL`, `year__GE = 2015` in `src-tauri/src/sources/fundamentals.rs`). The pipeline must fetch state history itself, since it cannot reuse the app's stored series.
- County corn grain yield runs from 1910 to 2025. The 2025 county rows (1,241 counties) were loaded 2026-05-05, so county labels for a season arrive in the following spring.

## USDA forecasts before August: WASDE

- **usda.gov "Historical WASDE Report Data"** (`https://www.usda.gov/historical-wasde-report-data-3`) has monthly CSVs from April 2010 to October 2026 "as it was reported and appeared at the time of publication", with columns `WasdeNumber, ReportDate, ReportTitle, Attribute, ReliabilityProjection, Commodity, Region, MarketYear, ProjEstFlag, AnnualQuarterFlag, Value, Unit, ReleaseDate, ReleaseTime, ForecastYear, ForecastMonth`. Each file has only the current month's projection. July 2026: US corn 2026/27 yield 183.00 bu, soybeans 53.00 bu, released 2026-07-10 12:00.
- **usda.gov refuses non-browser clients.** Plain `curl` gets HTTP 403 for both the page and the CSV files, so a GitHub Actions job cannot use them. The fixture excerpt was read through a browser.
- **ESMIS works with plain clients.** `https://esmis.nal.usda.gov/publication/world-agricultural-supply-and-demand-estimates` lists every release with `.txt`, `.xls` and `.xml` files (`wasde0726.xml` is 2.05 MB). The XML is deeply nested (`sr12` is the U.S. feed grain and corn table, `sr15` soybeans), carries both the previous and the current month for the new crop year (corn 2026/27: June 183.0, July 183.0), and appends footnote markers to values (`183.0 *`, `53.0 **`). It needs a careful parser.
- WASDE is national only. **USDA publishes no state yields before the August Crop Production report**, so a state yield gap in June and July has no USDA figure to compare against.
- FAS PSD (key required, not called) holds the current revised estimates, not vintages. The WASDE page itself points to PSD for "revised historical series". PSD is not a vintage source.
- Crop Production releases on ESMIS (`https://esmis.nal.usda.gov/publication/crop-production`) come with a zip of CSV tables (`crop1026.zip`, 52 KB, 40 files). Table 183 is corn for grain by state with the previous and current forecast (`Iowa,13150,12800,210,219,219,…`) and table 146 is soybeans. The files are Latin-1 (the en dash in titles is byte `0x96`), and row types are marked `t` (title), `h` (header), `u` (units) and `d` (data). The first line gives the release date ("Released October 9, 2026").

## U.S. Drought Monitor

- State: `https://usdmdataservices.unl.edu/api/StateStatistics/GetDroughtSeverityStatisticsByAreaPercent?aoi=19&startdate=1/1/2000&enddate=1/31/2000&statisticsType=1` returns weekly rows from 2000-01-04 (the first map). Fields as the app's manifest uses them: `mapDate`, `stateAbbreviation`, `none`, `d0`–`d4` (cumulative percent of area), `validStart`, `validEnd`.
- County: `…/CountyStatistics/GetDroughtSeverityStatisticsByAreaPercent?aoi=IA&…` returns `fips`, `county`, `state` and the same percentages (99 Iowa counties, 24 KB for one week). No key.
- **"Share of growing area in drought" is not a USDM product.** Compute it from county D1+ percentages weighted by county corn or soybean area (NASS county planted area, or CDL pixel counts).
- Licence: public. Credit the National Drought Mitigation Center, USDA and NOAA (as in `plugins/builtin/us-drought-monitor.toml`).

## Weather history

### gridMET (recommended)

- Climatology Lab THREDDS, for example `http://thredds.northwestknowledge.net:8080/thredds/dodsC/agg_met_tmmx_1979_CurrentYear_CONUS.nc` (OPeNDAP; `tmmx` is daily maximum temperature in K). It is **plain HTTP on port 8080**. On 1 November 2026 the aggregate held 17,470 days, from 1979-01-01 to 2026-10-30, about two days behind.
- Metadata marks recent slices as "provisional" and then "early", "subject to change with subsequent updates". Days end at midnight Mountain Standard Time (07:00 UTC). Citation: Abatzoglou (2013), DOI 10.1002/joc.3413. Planetary Computer lists gridMET as CC0-1.0.
- **Planetary Computer's `gridmet` stops at 2020-12-31**, so it is only good for backfill.
- Being gridded (about 4 km), it can be masked with CDL corn and soybean pixels and weighted by area, which point weather cannot do.

### Open-Meteo archive (fallback)

- `https://archive-api.open-meteo.com/v1/archive?latitude=42.0&longitude=-93.5&start_date=2000-07-01&end_date=2000-07-05&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=America%2FChicago` works without a key (fixture). No rate-limit headers came back.
- **Recent days are not ERA5.** The default model returned values up to 2026-10-31 (yesterday), but `models=era5` stopped at 2026-10-25. The last week comes from other models and is later replaced, so a value can change after it is first fetched.
- Terms (from the PRD): free for non-commercial use under 10,000 calls a day, attribution required. Open-Meteo counts large requests (many locations or long spans) as several calls, so a county-level backfill over 25 years would use many calls. That counting rule was not rechecked in this spike.

### Daymet

- Planetary Computer's `daymet-daily-na` ends 2020-12-30, and Daymet lags about a year at source. Drop it.

## Planetary Computer STAC

- Catalogue: `https://planetarycomputer.microsoft.com/api/stac/v1`, 139 collections, search without an account.
- **Signing:** the `sign` endpoint (`/api/sas/v1/sign?href=…`) and the account/container token (`/api/sas/v1/token/modiseuwest/modis-061-cogs`) both worked anonymously and gave HTTP 206 range reads of a real GeoTIFF. The collection-level token (`/api/sas/v1/token/modis-13Q1-061`) returned a token that the storage account rejected ("Signature did not match"). Use the `planetary-computer` package's `sign`, which uses the account/container route. Tokens expire after about 15 minutes, and none are saved in the fixtures.
- Collection metadata can understate holdings: `hls2-l30` says it starts in 2020, but its items over Iowa start in 2013.

| Collection | Items over Iowa (tile T15TVG or MODIS h11v04) | Notes |
| --- | --- | --- |
| `modis-13Q1-061` | 2000-02-18 to the composite of 2026-09-30–10-15 | Terra (`MOD13Q1`) and Aqua (`MYD13Q1`) alternate 8 days apart. Assets include `250m_16_days_NDVI`, `_EVI`, `_VI_Quality`, `_pixel_reliability`, `_composite_day_of_the_year`; NDVI is int16 with scale 0.0001. The newest composite ended 15 October and was produced 16 October. |
| `usda-cdl` | 2008–2021 only | Collection extent and items agree. **Stale.** |
| `hls2-l30` | 2013-07-30 to 2026-10-23 | Landsat only, 16-day revisit before Landsat 9. |
| `hls2-s30` | 2020-01-02 to 2026-10-25 | Sentinel-2 part of HLS only from 2020. |
| `sentinel-2-l2a` | 2015-10-05 to 2026-10-30 | About two days behind. Assets include `B01`…`B12`, `B8A` and the `SCL` scene classification (cloud mask); the newest item has processing baseline 05.13, so older baselines need harmonising. |
| `landsat-c2-l2` | 1982-11-15 to 2026-10-23 | — |
| `gridmet`, `daymet-daily-na` | End 2020 | See above. |

- No VIIRS collections are on Planetary Computer.
- Licences: Planetary Computer labels HLS and Sentinel-2 "proprietary" and MODIS and CDL "other", but the underlying terms are open. NASA data have no restrictions (cite the product). Copernicus Sentinel data need the credit "Contains modified Copernicus Sentinel data [year]". CDL is public domain (cite NASS).

### MODIS is ending

NASA Earthdata ([transition from MODIS to VIIRS](https://www.earthdata.nasa.gov/data/alerts-outages/transition-from-modis-viirs)) says Terra and Aqua "will begin shutting down operations" in late 2026 or early 2027, that both are "currently drifting out of their designed orbits", and points users to VIIRS. A NASA Terra feature, seen only in a search summary, projects end of science in February 2027 for Terra and September 2027 for Aqua. MODIS can still supply 2000–2026 training history, but **the 2027 season will need another greenness source**. The VIIRS vegetation index (VNP13A1, 500 m, from 2012) is not on Planetary Computer: it needs a free NASA Earthdata login, or Earth Engine. HLS aggregated to county is the account-free alternative, at higher compute cost.

## Cropland Data Layer

- **Use NASS CropScape, not Planetary Computer, for 2022 onward.** `https://nassgeodata.gmu.edu/axis2/services/CDLService/GetCDLStat?year=2025&fips=19&format=csv` returns an XML wrapper whose `returnURL` points to a CSV (`Value, Category, Count, Acreage`). Iowa 2025: corn 60,622,798 pixels (13,482,185.7 acres), soybeans 42,557,170 (9,464,486.8 acres). `GetCDLFile?year=2025&fips=19169` returns a county GeoTIFF the same way. No key.
- Years accepted: 1997–2025. A 2026 request fails with "The year must be between 1997 and 2025". Full CONUS coverage is believed to start in 2008, with earlier years covering some states only. Neither was checked state by state.
- Release timing: the 2025 CDL metadata gives `Publication_Date: 20260227`. The plan's rule holds: in-season work uses the prior year's map.
- CDL pixel acreage is a classification count, not an official estimate. It differs from NASS planted area and should not be presented as one.

## Soil moisture: Crop-CASMA

Not confirmed. `https://nassgeo.csiss.gmu.edu/CropCASMA/` (and the older `cloud.csiss.gmu.edu/Crop-CASMA/`) now redirects to a CropSmart sign-in page. NASS's own metadata gives the data's time period as 2015-03-31 to 2025-01-31, offered as 9 km and 1 km rasters, with no access constraints. A NASA abstract says it is served over OGC WMS and WCS, but no endpoint was found. Drop it from Phase 4, or revisit with SMAP Level-4 from NASA Earthdata (login required).

## Storm reports

### SPC daily reports

- `https://www.spc.noaa.gov/climo/reports/YYMMDD_rpts_filtered_{wind,hail,torn}.csv`. Wind columns: `Time,Speed,Location,County,State,Lat,Lon,Comments` (hail has `Size`, tornado `F_Scale`). **Times are UTC** (a Sioux City report at `1316` is 07:16 CST in SVRGIS).
- 10 August 2020 (Iowa derecho): 548 filtered wind reports, 131 in Iowa (fixture).
- History is uneven: the `_filtered_` names answer from 2012, while `YYMMDD_rpts_{hail,wind,torn}.csv` (unfiltered) answers from 2004 (2005, 2008 and 2010 checked). 2003 returns 404. These are preliminary reports, not quality-controlled.

### SPC SVRGIS (final database)

- `https://www.spc.noaa.gov/wcm/data/YYYY_{hail,wind,torn}.csv` per year through 2025 (the 2025 files were last modified 2026-04-24), plus `1950-2025_actual_tornadoes.csv`. Columns `om,yr,mo,dy,date,time,tz,st,stf,…,mag,…,slat,slon,elat,elon,…`; `tz` is `3` (CST) for every 2020 row. 2020-08-10 Iowa: 140 wind rows. The format is described in `data/SPC_severe_database_description.pdf`.
- Final, quality-controlled history, but a season is only added the following spring.

### IEM local storm reports (recommended trigger feed)

- `https://mesonet.agron.iastate.edu/geojson/lsr.php?sts=2020-08-10T12:00Z&ets=2020-08-11T06:00Z&states=IA` returns GeoJSON (227 reports for the derecho day, 2 seconds). Properties: `valid` (UTC), `typetext`, `magnitude`, `unit`, `state`, `county`, `city`, `lat`, `lon`, `remark`, `source`, `wfo`, `product_id`.
- **It includes floods**, which SPC does not: 12 June 2008 Iowa had `FLASH FLOOD` and `FLOOD` reports alongside hail, wind and tornado (fixture). One feed covers all three damage causes.
- Terms: the IEM disclaimer allows use "freely by anyone for any lawful purpose" and asks for credit to the Iowa Environmental Mesonet of Iowa State University (see `docs/research/river-sources.md` on the river branch).

## Cloudflare AI Gateway

No test call was made: there is no Cloudflare account ID, gateway or token in this environment. From the docs (checked 1 November 2026):

- **`/compat` is deprecated for single-model calls.** The chat completion page ("Last updated Oct 2, 2026") says "For standard single-model chat completions, this endpoint is deprecated", that `/compat/chat/completions` "will continue to work for existing integrations", and recommends the REST API. No removal date is given. On `/compat` the Workers AI model is `workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast` with `cf-aig-authorization: Bearer {gateway token}`.
- **Recommended endpoint:** `POST https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1/chat/completions` with `Authorization: Bearer {Cloudflare API token}`. The token needs the Account > Workers AI > Read permission; a token with only AI Gateway permissions gets HTTP 401 with error code 10000. **`cf-aig-gateway-id` is required for Workers AI models.** Workers AI models are named `@cf/author/model`, without the `workers-ai/` prefix. With the OpenAI SDK, set the base URL to `…/accounts/{account_id}/ai/v1` and send the gateway header as a default header.
- **Model:** `@cf/meta/llama-3.3-70b-instruct-fp8-fast` is listed with no deprecation notice. It has a 24,000-token context window and costs $0.293 per million input tokens and $2.253 per million output tokens, so a weekly brief costs a fraction of a cent.
- **JSON mode:** Workers AI accepts `response_format` with `type` `json_object` or `json_schema`, and this model is first on the supported list. The docs say "Workers AI can't guarantee that the model responds according to the requested JSON Schema", that it may return "JSON Mode couldn't be met", and that JSON mode does not support streaming. Keep the plan's defensive parsing.

To make the Phase 0 test call, set the three variables and run:

```bash
curl -sS -w '\nHTTP %{http_code} in %{time_total}s\n' -X POST "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/ai/v1/chat/completions" -H "Authorization: Bearer $CF_API_TOKEN" -H "cf-aig-gateway-id: $CF_GATEWAY_ID" -H "Content-Type: application/json" -d '{"model":"@cf/meta/llama-3.3-70b-instruct-fp8-fast","temperature":0.2,"response_format":{"type":"json_object"},"messages":[{"role":"system","content":"Reply only with a JSON object with keys summary and bullets."},{"role":"user","content":"{\"crop\":\"corn\",\"geo\":\"US\",\"p50\":181.0,\"usda_latest\":181.2}"}]}'
```

## Publishing the outputs

**Decision (1 November 2026): a separate public repository, `billymcdowell/agri-terminal-data`, read through `raw.githubusercontent.com`.** The plan's Phase 8 has been updated to match. The repository is not created yet; create it when Phase 8 starts. The reasons, and the alternative considered:

- Weekly data commits stay out of the app's history and clones. A `data` branch here would still be fetched by every full clone and would mix data commits into the app's activity.
- The data can carry its own licence and credits (USDA, NOAA, NASA, Copernicus, gridMET, IEM, and Open-Meteo's CC BY 4.0 if it is used), separate from the code's MIT licence.
- `raw.githubusercontent.com` serves https from one host with no redirect, so a manifest needs only `hosts = ["raw.githubusercontent.com"]`. GitHub release assets redirect to a second host, which the plugin client checks on every hop. Raw files are cached for a few minutes, which does not matter for weekly data.
- Cost: the workflow in this repository needs a fine-grained token (or deploy key) that can write only to the data repository, stored as an Actions secret. A `data` branch in this repository would avoid that secret.

## Findings in this repository that affect the plan

- **The plugin manifest cannot take `released_at` from a row.** `extract` in `src-tauri/src/plugins/source.rs` sets it from `[release]` (period plus an offset, via `scheduled_release`) or the fetch time. The plan's rule that "as-of joins use the nowcast's publish time as `released_at`" needs either an optional row field for the release time in the manifest format, or a Rust source for the numeric files as well.
- `crop-nowcast` must be added to `RESERVED_IDS` in `src-tauri/src/plugins/manifest.rs`. Built-in manifests are trusted and may write any series id.
- Series ids elsewhere use the futures symbol (`nass.zc.condition.good_excellent`, `drought.ia.D1`), and link groups carry `ZC` and `ZS`. `nowcast.zc.ia.yield_p50` would fit better than the plan's `nowcast.corn.ia.yield_p50`.
- `config/crop-regions.json` has nine states (IA, IL, NE, MN, IN, KS, ND, SD, OH) with **no Missouri**, and maps ZC to only five of them. The plan lists ten states including MO.
- The river constraint work is now on `master` and merged into this branch (1 November 2026). Its `river_alerts` table took database migration 11, so the nowcast `documents` table is migration 12.
- The revision caveat in `docs/research/river-sources.md` (on the river branch) applies here: revised values inherit their original release time unless the source supplies a real one.

## Recommended changes to the plan

Not yet applied to `docs/Crop Nowcast Plan.md`, apart from the publishing decision above and the parts of item 14 done in Phase 1 (the `[response.released_at]` manifest field and the reserved ids).

1. **Section 5, USDA forecasts by vintage:** replace "and/or FAS PSD" with NASS Quick Stats (August to November, national and state) plus the WASDE archive on ESMIS (May to July, national only). PSD has no vintages.
2. **Section 6 and Phase 3, yield gap:** state rows have no USDA figure before August. Allow an empty `usda_latest`, and give `usda_vintage` a source and month (for example `wasde-2026-07`, `nass-2026-08`). The June–July state gap can only be against trend.
3. **Phases 2 and 8, labels and benchmarks:** use Quick Stats `YEAR` as the final yield only for finished seasons. The January estimate is not kept as a vintage, and some years lack a month (2025 has no October). The Phase 8 backtest should step through whichever releases exist.
4. **Phase 5, acreage benchmark:** Quick Stats has Prospective Plantings only from 2012 and June Acreage only from 2018. Either limit the comparison to those years or add an ESMIS Acreage parser.
5. **Section 5, CDL:** Planetary Computer's `usda-cdl` ends at 2021. Take CDL from NASS CropScape (keyless, 1997–2025).
6. **Phase 4, greenness:** MODIS ends in late 2026 or early 2027. Decide before Phase 4 between VIIRS (NASA Earthdata login, a free account and a secret) and HLS aggregated to county (no account, more compute). Train on MODIS history either way.
7. **Phase 5, imagery history:** HLS S30 starts in 2020 and L30 in 2013, so the full HLS cadence covers six seasons (2020–2025). Say so in the model card, or add Sentinel-2 L2A from 2015 with baseline harmonisation.
8. **Section 5, weather:** make gridMET the primary source (Climatology Lab THREDDS, not Planetary Computer), with Open-Meteo as fallback. Drop Daymet.
9. **Section 5 and Phase 4, soil moisture:** drop Crop-CASMA for now.
10. **Section 5 and Phase 6, storm reports:** use IEM local storm reports as the trigger feed (they include floods) and SPC SVRGIS for final history. SPC daily CSVs remain a backup.
11. **Phase 2, drought feature:** compute the share of growing area in drought from USDM county statistics weighted by county crop area.
12. **Phase 2, NASS access:** backfill from the keyless bulk file. Weekly updates can use the API with the key as an Actions secret. Add the "not endorsed or certified by NASS" notice to the credits.
13. **Section 7, AI Gateway:** default to the REST endpoint (`api.cloudflare.com/client/v4/accounts/{id}/ai/v1`), which takes a Cloudflare API token in `Authorization` and the gateway in `cf-aig-gateway-id`. Model ids differ by endpoint (`@cf/…` on REST, `workers-ai/@cf/…` on `/compat`), so config needs `AI_BASE_URL`, `AI_MODEL`, `AI_GATEWAY_ID` and one token. The 24,000-token context limits the structured input.
14. **Phase 1, app ingestion:** add an optional row field for `released_at` to the manifest format (or read the numbers in the Rust source too), reserve the `crop-nowcast` id, and use `zc`/`zs` in series ids.
15. **Section 4, states:** add Missouri to `config/crop-regions.json` or drop it from the plan.
16. **Before Phase 3:** merge `feature/river-constraint`, which changes the same panel, alert, attribution and demo files. Done: it is on `master` and merged here.

## Still unconfirmed

- A keyed Quick Stats API response (JSON shape and whether `load_time` matches the bulk file). With `NASS_API_KEY` set, this records one:

  ```bash
  curl -sS "https://quickstats.nass.usda.gov/api/api_GET/?key=$NASS_API_KEY&commodity_desc=CORN&short_desc=CORN,%20GRAIN%20-%20YIELD,%20MEASURED%20IN%20BU%20%2F%20ACRE&agg_level_desc=NATIONAL&year__GE=2024&format=JSON" -o pipelines/crop-nowcast/tests/fixtures/nass_api_corn_yield_national_recorded.json
  ```

- The time zone of Quick Stats `LOAD_TIME` (it matches Eastern release times, but this is not documented).
- The Cloudflare test call: whether `response_format` is honoured through the gateway, and the latency.
- How far back ESMIS has machine-readable (XML or CSV) WASDE, Crop Production and Acreage files.
- FAS PSD (needs a key). It is no longer needed for vintages.
- Crop-CASMA access and current coverage.
- Anonymous rate limits for Planetary Computer, IEM, CropScape and gridMET THREDDS. None sent rate-limit headers.
- The exact end of MODIS science data, and whether NASA will publish a final MODIS collection.
- CDL coverage of each plan state before 2008.
