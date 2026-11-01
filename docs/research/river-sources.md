# River constraint source spike

Checked 31 October 2026, without keys, against the live provider APIs. These notes pin what the river constraint work (see `docs/River Constraint Plan.md`) can rely on. Recorded responses are in `tests/fixtures/river/` and described in `tests/fixtures/README.md`. Recheck a provider before depending on anything not listed here.

## Summary

| Data | Status | Source to use | Cadence and release | History |
| --- | --- | --- | --- | --- |
| St. Louis stage | Confirmed | USGS Water Data OGC API v1, site `07010000` | Daily 08:00 reading, posted about an hour later | Daily from 1982-10-01 |
| Memphis stage | **Not available from USGS** | NWPS observed (live) plus IEM HML archive (history) | Hourly | IEM back to at least 2015 |
| River forecast | Confirmed, latest issue only | NWPS `/gauges/{lid}/stageflow` | Once a day, about 15:00–16:00 UTC | None from NWS; IEM archive from 2012 |
| Grain barge rates | Confirmed | AgTransport `deqi-uken` | Weekly, week ending Tuesday, published Thursday | From 2004-01-07 |
| Lock movements | Confirmed | AgTransport `n4pw-9ygw` | Weekly, week ending Saturday, published the next Thursday | From 2003 (three locks), 2013 (seven) |
| Gulf and interior basis | Partly confirmed | AgTransport `v85y-3hep` and `an4w-mnp7` (keyless); MARS still unchecked | Weekly, week ending Friday, published the next Thursday | From 2007 (basis), 2000 (spreads) |

## USGS river stage

**Use the new API.** The legacy WaterServices site (`waterservices.usgs.gov`) says it will be shut down on 22 February 2027, with intentional slowdowns and outages from January 2027. It still answered on 31 October 2026, but nothing new should depend on it. The replacement is the OGC API at `api.waterdata.usgs.gov/ogcapi/v1` (`v0` also answers; the docs use `v1`).

- Request: `https://api.waterdata.usgs.gov/ogcapi/v1/collections/daily/items?f=json&monitoring_location_id=USGS-07010000&parameter_code=00065&statistic_id=30800&datetime=2020-10-01/2026-10-31&skipGeometry=true&sortby=time&limit=3000`.
- Response: GeoJSON `FeatureCollection`. Each feature's `properties` has `time` (`YYYY-MM-DD`), `value` (a **string**, such as `"3.77"`), `unit_of_measure` (`ft`), `approval_status` (`Provisional` or `Approved`), `qualifier` and `last_modified`. Rows come back in no particular order unless `sortby=time` is set.
- **The St. Louis daily stage is not a daily mean.** The only daily gage-height series is statistic `30800`, "Observation at 08:00" (`computation_identifier: SelectedValue`). There is no `00003` mean for stage at this site. Instantaneous values (`00011`) run from 2001-10-01.
- Release timing: each day's 08:00 reading had `last_modified` between 14:04 and 14:39 UTC the same day throughout October 2026 (08:00 CDT is 13:00 UTC). In winter, 08:00 CST is 14:00 UTC, so expect about 15:05 UTC. A conservative manifest rule is `days_after_period = 0`, `hour_utc = 16`.
- Revisions: provisional values become `Approved` months later (2,040 of 2,196 rows in the last six years were approved), and `last_modified` changes when they do.
- Size: six years is 2,196 rows, 1.43 MB with all properties and geometry, or 0.52 MB with `skipGeometry=true&properties=time,value,approval_status`. Both fit the plugin client's 5 MiB default, and `{today-2200d}` is inside the template's 3,650-day limit. Six years took about 2.6 seconds.
- Rate limits: the API uses api.data.gov keys. Anonymous responses carried no `X-RateLimit-*` headers, so the anonymous limit is unknown. The docs show `X-RateLimit-Limit: 1000` (per hour) with a key, which can be sent as an `X-Api-Key` header. A daily refresh per gauge does not need a key.
- Manifest fit: the existing manifest format can read this directly (`rows = "/features"`, period field `properties.time`, value `properties.value`, a literal series id such as `river.stlouis.stage`). One manifest covers one gauge, because a manifest is one request and the rows carry only `USGS-07010000` as an identifier.
- Licence: USGS data are public domain. Credit the U.S. Geological Survey and show that provisional data are subject to revision (the API's own disclaimer).

### Memphis has no USGS stage

USGS site `07032000` (Mississippi River at Memphis) publishes discharge (`00060`: daily mean since 1933, instantaneous since 2014) and turbidity, but **no daily or instantaneous gage height**, only annual peak stages. The plan's Memphis assumption fails.

**Decision (31 October 2026): option 1.** Memphis stage comes from NWPS observed readings plus the IEM archive, through a Rust source. The plan's Phase 1 has been updated to match. The options considered, in order of preference:

1. **NWPS observed plus IEM history.** NWPS `MEMT1` returns about 30 days of hourly observed stage (`pedts: HGIRG`, sourced from the Corps). The Iowa Environmental Mesonet archive returns the same NWS hydrometeorological (HML) observations for past years (hourly; all of 2022 and samples from 2015 and 2019 came back, with a 2022 minimum of −10.97 ft at 20:00 UTC on 21 October). This needs a Rust source that picks one reading a day (the 08:00 Central reading, to match the USGS statistic at St. Louis). It is live and long, but stitched from two services.
2. **Substitute a USGS gauge between St. Louis and Cairo.** Cape Girardeau (`07020850`, NWS `CPGM7`, daily 08:00 stage from 1984) and Chester (`07020500`, NWS `CHSI2`, from 1982) both have USGS daily stage and an NWS forecast, so they work with the same manifest as St. Louis. Thebes (`07022000`, `THBI2`, from 1982) is a known low-water choke point but had no NWS forecast on 31 October 2026. None of them sits in the Cairo–Memphis barge rate reach.
3. **USACE CWMS for history only.** The national CWMS Data API has Memphis as `MS126` (office `MVM`): `MS126.Stage.Inst.1Day.0.MVM-PUB` is a daily 08:00 stage from 1932 to 2025-12-31, and `MS126.Stage.Inst.1Hour.0.opendcs-rev` is hourly from 2018. These series, like the other MVM series checked, stopped updating on 14 September 2026, so they cannot be the live feed.

## NWS river forecasts (National Water Prediction Service)

- Gauges confirmed: St. Louis `EADM7` (NCRFC, USGS `07010000`) and Memphis `MEMT1` (LMRFC, USGS id listed as `07032000`).
- Endpoints (from `https://api.water.noaa.gov/nwps/v1/docs/swagger.json`): `/nwps/v1/gauges/{lid}` (metadata), `/nwps/v1/gauges/{lid}/stageflow` (observed and forecast), `/nwps/v1/gauges/{lid}/stageflow/{product}` (`observed` or `forecast` alone).
- `stageflow` returns `observed` and `forecast` objects. Each has `issuedTime`, `pedts`, `primaryName` (`Stage`), `primaryUnits` (`ft`), `secondaryName` (`Flow`), `secondaryUnits` (`kcfs`) and `data`: a list of `{validTime, generatedTime, primary, secondary}`. Missing flow is `-999` (Memphis has no flow in either block).
- Forecast shape on 31 October 2026: one issue per gauge (St. Louis 16:03 UTC, 56 points; Memphis 15:20 UTC, 57 points), six-hourly values running about 14 days ahead (to 14 November). Memphis metadata has `TruncateFcst: "14"`. The gauges' `forecastReliability` says forecasts are issued routinely year-round.
- Observed: about 30 days, every 30 minutes at St. Louis and hourly at Memphis.
- **No forecast history.** The API exposes only the latest issue. The app can build its own history from the day it starts fetching, but past low-water episodes need the IEM archive below.
- Gauge metadata includes thresholds that matter here: `lowThreshold` (St. Louis −3.2 ft, Memphis −8 ft), `impactsLowWaters` (St. Louis: at 1.0 ft, "commercial barges may need to reduce tonnage"; Memphis: none listed), flood categories, `dataAttribution` (USACE RiverGages and USGS), and the upstream and downstream gauge ids.
- No key, and no rate-limit headers were returned. Send a descriptive `User-Agent`, as the existing NWS weather connector does.
- Licence: NOAA data are public domain. Credit the National Weather Service and the observation providers named in `dataAttribution`.
- Storage fit: `period` in the store is a date, but forecasts are six-hourly. Reduce each issue to one value per target date (the daily minimum fits the FCST formula) before storing. The store adds a revision only when a value changes, so a new issue that repeats a value keeps the earlier `released_at`, which is still honest.

## Iowa Environmental Mesonet HML archive

- Request: `https://mesonet.agron.iastate.edu/cgi-bin/request/hml.py?station=EADM7&sts=2022-10-01T00:00Z&ets=2022-10-03T00:00Z&kind=forecasts&fmt=csv&tz=UTC` (`kind=obs` for observations). Formats are `csv` or `excel` only; JSON is refused.
- Forecast CSV columns: `station, issued[UTC], primaryname, primaryunits, secondaryname, secondaryunits, forecast_valid[UTC], primary_value, secondary_value`. St. Louis had two issues a day in early October 2022 (about 01:20 and 15:50 UTC). Observation CSV columns: `station, valid[UTC], Stage[ft]`.
- Limits: the archive starts on 1 January 2012, and a forecast request must stay within one UTC year. It is slow: a year of hourly Memphis observations (249 KB) took 34 seconds. Use it for one-off backfill and the Phase 7 backtest, not for live polling.
- Terms: the IEM disclaimer says its data may be used "freely by anyone for any lawful purpose", and asks for credit to the Iowa Environmental Mesonet of Iowa State University.

## USDA grain barge rates (AgTransport)

- Dataset `deqi-uken`, "Downbound Grain Barge Rates": `https://agtransport.usda.gov/resource/deqi-uken.json`. Fields: `date` (week ending, a Tuesday), `week`, `month`, `year`, `location`, `rate`. Values are strings. An empty `rate` means no quote that week.
- Units: percent of the 1976 tariff. Dollars per short ton = rate × benchmark ÷ 100, with benchmarks (in cents per ton) of Twin Cities 619, Mid-Mississippi 532, St. Louis 399, Illinois 464, Cincinnati 469, Lower Ohio 446 and Cairo-Memphis 314. The week ending 27 October 2026 had St. Louis at 564.06 (about $22.51 a ton) and Cairo-Memphis at 481.25.
- Locations as they appear in the data: `Twin Cities`, `Mid-Mississippi`, `Lower Illinois` (the description says "Illinois River"), `St. Louis`, `Cincinnati`, `Lower Ohio`, `Cairo-Memphis`. Each has 1,191 weeks from 2004-01-07.
- `7spn-fbua` gives dollars per ton for 26 river segments. It is derived from the same quotes, so it is not needed.
- Release: the dataset's `Last-Modified` was Thursday 29 October 2026, 16:12 UTC, two days after the 27 October week ending. Every row has the same `:created_at`, so the dataset is replaced in full each week. There is no per-row release history, and a past week could be revised silently.
- The Grain Transportation Report archive (`ams.usda.gov/services/transportation-analysis/gtr/archive-YYYY`) lists 244 issues from January 2022 to October 2026: 243 on Thursday and one on Wednesday (18 June 2025, the Juneteenth week). **There were no issues from 2 October to 13 November 2025, or on 5 February 2026** (federal funding lapses). A fixed "Tuesday plus two days" rule would date those weeks earlier than they were really published.
- No key. No rate-limit headers; Socrata throttles anonymous use more than requests with an app token, but the limit was not measured. A weekly request is small.
- Licence: the dataset metadata says `useRestriction: Unrestricted` and attribution "USDA/AMS".
- Manifest fit: a series id built from `{location:lower}` would contain spaces and dots (`river.barge_rate.st. louis`). Either add a slug filter to the template, write one manifest per location with a `$where` clause and a literal id, or use a Rust source.

## USDA grain barge lock movements (AgTransport, from USACE)

- Dataset `n4pw-9ygw`, "Downbound Barge Grain Movements (Tons)". Fields: `date` (week ending, a Saturday), `week`, `month`, `year`, `commodity` (`Corn`, `Soybeans`, `Wheat`, `Other Grain`), `lock`, `tons` (short tons). One row per week, lock and commodity.
- Locks as they appear in the data: `MS Locks 27`, `OH Olmsted` and `AK Lock 1` from 2003; `MS Lock 15`, `MS Lock 25`, `MS Lock 26` and `IL La Grange` from 2013. The description still uses older names ("Miss Locks 27", "Ohio Olmstead") and says Olmsted replaced Ohio Lock 52 in November 2018.
- Release: the week ending Saturday 24 October 2026 was published on Thursday 29 October (five days later), with the same full replacement as the barge rates.
- Socrata can total the commodities on the server: `$select=date,lock,sum(tons) as tons&$group=date,lock`.
- What it measures: traffic leaving the locked rivers. The open river from St. Louis past Cairo to Memphis has no locks, and the dataset says 10 to 30 percent of downbound grain originates below Lock 27 and is not counted. Weekly totals swing widely at harvest: Locks 27 moved 84,300 tons in the week ending 3 October 2026 and 454,300 tons in the week ending 24 October.
- Related datasets not checked in detail: `w6ip-grsn` (loaded and empty barge counts) and `spd3-ku7f` (grain barge unloads in the New Orleans region).

## Gulf and interior basis

- **Keyless weekly basis exists.** AgTransport `v85y-3hep`, "Grain Basis", has weekly rows (week ending Friday, from 2007) with `market_name`, `market_type` (`30-Day to Arrive` for destinations, `Elevator Bid` for origins), `commodity`, `source`, `bid`, `contract_month`, `futures_price` and `basis`. The week ending 23 October 2026 was published on 29 October. `an4w-mnp7`, "Grain Price Spreads", gives destination minus origin prices for pairs such as Illinois–Gulf and Iowa–Gulf (corn, from 2000).
- The Louisiana Gulf corn and soybean rows come from AMS report `JO_GR850` (with U.S. Wheat Associates for wheat).
- **Licence concern for the interior side.** The interior elevator bids for Illinois, Iowa, Nebraska, Indiana, Ohio, Minnesota and others are labelled "GeoGrain Subscription", a commercial feed; only South Dakota comes from an AMS report (`SF_GR110`). The rows also carry exchange futures prices. USDA publishes them openly, but whether AgriTerminal may redistribute the GeoGrain-sourced series has not been confirmed. Until it is, use only the AMS-sourced Gulf side, and keep interior basis on the planned MARS connector.
- The keyed MARS API was not checked in this spike (no key). `docs/research/phase4-provider-spikes.md` still applies.

### Phase 6 decision: no basis spread yet

The plan's Gulf minus interior spread needs a public interior basis for the river states, and none is available without more work:

- **AgTransport's interior bids for the river states are commercial.** Illinois, Iowa, Indiana, Ohio, Minnesota and Nebraska elevator bids in `v85y-3hep` and the origin side of `an4w-mnp7` are labelled "GeoGrain Subscription". Rule 1 keeps proprietary price data out, so they are not used. The only AMS-sourced interior series there is South Dakota (`SF_GR110`), which ships mostly by rail and is not a river origin.
- **The public alternative is the USDA AMS Market News (MARS) API**, whose state grain reports (for example Iowa and Illinois) carry cash bids and basis. It needs a personal key, and the AgriTerminal connector for it is not built. Its grain-row JSON fields have not been checked against a keyed response.
- **The Gulf side is ready when the interior side is.** The Louisiana Gulf rows in `v85y-3hep` come from AMS report `JO_GR850`, keyless, weekly from 2007.

Until then the river timeline's basis slot stays empty and hidden, the panels say why, and barge freight is the price side. `estimate_sensitivity` takes any weekly price series, so the spread can use it as soon as it exists.

### Sensitivity: changes on changes, not the methodology's formula

`../waterway-index/docs/METHODOLOGY.md` estimates β as the slope of a price's change on the level of depth below the restriction level. Over the six stored years (2020–2026, weekly barge rates against the mean stage of each week), that gave nothing usable: St. Louis −5.0 percent of tariff per foot with R² 0.002, Cairo–Memphis −23.2 with R² 0.040. Rates jump as the river falls and then settle while it stays low, so the level of depth says little about the next week's change.

Regressing the change in rate on the change in depth below restriction over the same span works, with a response that builds over several weeks:

| Span | St. Louis β (R²) | Cairo–Memphis β (R²) |
| --- | --- | --- |
| 1 week | 20.8 (0.016) | 18.8 (0.011) |
| 2 weeks | 43.8 (0.055) | 40.0 (0.038) |
| 4 weeks | 89.3 (0.158) | 88.0 (0.126) |
| 6 weeks | 109.7 (0.171) | 128.4 (0.230) |

β is percent of tariff per foot deeper below the restriction level. AgriTerminal uses the two-week span, because that is how far the NWS forecast reaches, and applies it as β × (expected depth below restriction in the forecast's second week − depth below restriction over the last week). The intercept is left out, as drift unrelated to the river. Levels on levels fit better (R² 0.16 and 0.22) but mix in the autumn harvest freight peak, which falls when the river is usually lowest.

## Low-water thresholds (provisional)

All in feet on each gauge's own datum, for `config/waterways.json`. They are reference levels, not operational limits. The Phase 7 calibration against 2020–2026 kept them unchanged; see [`../river.md`](../river.md).

| Gauge | Normal | Restriction | Critical | Sources |
| --- | --- | --- | --- | --- |
| St. Louis (`07010000`, `EADM7`) | 5.0 | 1.0 | −3.5 | Normal: median of the daily 08:00 stage for August to December, 2012–2026 (USGS). Restriction: NWS `EADM7` low-water impact at 1.0 ft ("barges may need to reduce tonnage"). Critical: the Coast Guard and industry committee restricts drafts when the St. Louis gauge reaches −3.5 ft, per news reports from earlier low-water years; NWS's low threshold is −3.2 ft nearby. For reference, the 2022 and 2023 minima were −3.39 and −3.60 ft, and the USGS lowest measured stage is −5.96 ft. |
| Memphis (`MEMT1`) | 3.0 | −5.0 | −10.0 | Normal: median of the daily 08:00 stage for August to December, 2012–2025 (USACE CWMS `MS126`, 2.9 ft). Restriction: University of Arkansas extension (September 2024) calls −5 ft the low-water threshold, below which the Coast Guard required a 9-ft draft. Critical: near the record lows (CWMS daily −10.78 ft on 22 October 2022 and −12.0 ft on 17 October 2023; the extension article gives −11.91 ft for 2023). NWS's low threshold is −8 ft. |

Sources: [NWS NWPS EADM7](https://water.noaa.gov/gauges/eadm7) and its API metadata, [University of Arkansas Division of Agriculture, 5 September 2024](https://www.uaex.uada.edu/media-resources/news/2024/september2024/09-05-2024-ark-miss-river-trends-lower.aspx), [Feed & Grain, "Cold weather may impact barge logistics"](https://www.feedandgrain.com/news/cold-weather-may-impact-barge-logistics) (search summary only; the page refused direct access). The −3.5 ft St. Louis trigger rests on older reporting and should be checked against a current Coast Guard or USACE St. Louis District document.

Low-water days per year help with calibration. St. Louis had 122 days below 1.0 ft in 2022 and 146 in 2023, against 0 in 2016 and 2019. Memphis had 58 days below −5 ft in 2022 and 117 in 2023.

## Findings in this repository that affect the plan

- Fixtures live in `tests/fixtures/` and Rust tests read them with `include_str!("../../../tests/fixtures/...")`. `src-tauri/tests/fixtures/` is an empty, untracked folder, so the river fixtures are in `tests/fixtures/river/`.
- `config/crop-regions.json` is only bundled (`include_str!` in `commands.rs`, imported by `src/lib/regions.ts`). Only `report-calendar.json` has an app-data override (`lib.rs`).
- `help-text.ts` is `src/panels/help-text.ts`.
- **Revised values inherit their original release time.** `scheduled_release` returns the scheduled time for any row fetched more than seven days after it, and `append_metric_revisions` keeps the `released_at` it is given. A USGS value approved months later, or a barge rate revised in a later full replacement, would be stored as a new revision dated to the original release, and the as-of join would then use it before it was known. This already applies to the existing CFTC and drought sources.
- `Cadence` has only `Daily` and `Weekly`. That is enough for these sources.

## Still unconfirmed

- The anonymous rate limits for the USGS OGC API and AgTransport (Socrata).
- The exact GTR publication hour: only the dataset's `Last-Modified` (16:12 UTC on one Thursday) was seen. The GTR PDF could not be read here.
- Whether past barge rate or lock tonnage weeks are ever revised after publication.
- The redistribution terms for GeoGrain-sourced interior basis on AgTransport.
- MARS grain report fields (needs a key).
- A current, primary source for the St. Louis −3.5 ft restriction level.
- How far back IEM's Memphis observations go without gaps. All of 2022 and two-day samples from 2015 and 2019 came back; a January 2012 request returned no rows.
