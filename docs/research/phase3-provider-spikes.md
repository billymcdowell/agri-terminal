# Phase 3 provider spikes

Checked 24 October 2026 against provider-owned API pages. These notes pin the initial integration shape; recheck a provider's schema before relying on it in a production connector.

## CFTC Commitments of Traders

- Use the CFTC **Disaggregated – Futures Only** dataset, Socrata ID [`72hh-3qpy`](https://publicreporting.cftc.gov/Disaggregated-Futures-Only/72hh-3qpy). Its display page says this report is futures-only and separates Producer/Merchant, Swap Dealers, Managed Money, and Other Reportables. The CFTC lists Corn, Soybeans, and Wheat under these agricultural contracts. See the [CFTC report family overview](https://publicreporting.cftc.gov/stories/s/r4w3-av2u).
- Socrata resource URL shape: `https://publicreporting.cftc.gov/resource/72hh-3qpy.json`. Use `$where` to filter contract names and `$order=report_date_as_yyyy_mm_dd DESC`; page with `$limit`/`$offset`. Request only the fields needed. The CFTC data page links the API for each report; confirm the current column API names from that page's dataset metadata before shipping.
- Expected fields for the initial projection are report date, contract market name, open interest, and the long/short counts for Managed Money, Producer/Merchant, and Swap Dealers. The CFTC publishes the report weekly on Fridays with positions as of the preceding Tuesday; use the report date as period, and fetch time as the conservative local availability timestamp. Do not infer a Friday release timestamp from the Tuesday observation period.
- The CFTC portal is public. No key is described as required for ordinary API reads; use an app token only if operational requirements later justify one.

## USDA NASS QuickStats

- The [official API guide](https://quickstats.nass.usda.gov/api) requires a registered API key and documents `GET /api/api_GET` for observations, `GET /api/get_counts` to preflight request size, and `GET /api/get_param_values` for legal filter values.
- The request accepts `key`, `format=json|csv|xml`, and filter fields from the What/Where/When dimensions. Example provider query: `commodity_desc=CORN&year__GE=2012&state_alpha=VA`. The documented response carries `year`, `week_ending`, `Value`, `unit_desc`, `short_desc`, `statisticcat_desc`, `state_alpha`, and other geography/classification metadata.
- Each request is capped at 50,000 rows. Call `get_counts` before broad queries; restrict commodity, statistic, frequency, geography, and season. Crop progress/condition should be weekly and state-level in the first slice, then split by state or query dimension if the count approaches the cap.
- `Value` is formatted text and may contain commas or suppression markers; parse deliberately and preserve the original description/unit metadata. The official guide's examples include annual area estimates, not the crop progress/condition rows, so select those observations by their `short_desc`, frequency, and week ending fields and verify with an actual keyed response.

## USDA FAS OpenData (PSD and Export Sales)

- The [FAS Open Data portal](https://apps.fas.usda.gov/opendataweb/home) describes the PSD and Export Sales (ESR) APIs and says API.Data.gov credentials are needed. Use the portal's generated [Swagger UI](https://apps.fas.usda.gov/opendata/swagger/ui/index) as the authority for the credential header and current operation schema; the portal's embedded OpenAPI response examples are incomplete in the rendered docs.
- PSD discovery resources include `/api/psd/commodities`, `/api/psd/commodityAttributes`, `/api/psd/unitsOfMeasure`, `/api/psd/countries`, and `/api/psd/commodity/{commodityCode}/dataReleaseDates`. Annual data is queried with `/api/psd/commodity/{commodityCode}/country/{countryCode}/year/{marketYear}` or its `/world/year/{marketYear}` form. The portal uses commodity code `0440000` for corn in its operation description. Join the returned attribute, unit, country, and commodity IDs through the matching lookup endpoints instead of hard-coding labels.
- ESR discovery resources include `/api/esr/commodities`, `/api/esr/unitsOfMeasure`, `/api/esr/countries`, and `/api/esr/datareleasedates`. Weekly records are retrieved from `/api/esr/exports/commodityCode/{commodityCode}/allCountries/marketYear/{marketYear}` (or a country-specific form). Use release-date metadata to detect revisions and reread affected market years.
- Before connector code depends on individual row property names, capture a keyed API response from the official endpoints. The docs expose operation paths and broad model purpose but don't render stable example JSON property names. The API key must remain in the operating system keychain and must never enter URLs in logs or fixtures.

## U.S. Drought Monitor

- The [official REST documentation](https://droughtmonitor.unl.edu/DmData/DataDownload/WebServiceInfo.aspx) defines comprehensive statistics as weekly values for None and D0-D4. For states use `StateStatistics`; the `aoi` is the two-digit state FIPS. Percent-of-area series use `GetDroughtSeverityStatisticsByAreaPercent` and `statisticsType=1` (traditional) or `2` (categorical). Dates use `M/D/YYYY`.
- URL shape: `https://usdmdataservices.unl.edu/api/StateStatistics/GetDroughtSeverityStatisticsByAreaPercent?aoi={state_fips}&startdate={m/d/yyyy}&enddate={m/d/yyyy}&statisticsType=1`. The service defaults to CSV. Send `Accept: application/json` to request JSON; the docs list `application/json` and `text/json` as accepted media types.
- The documentation specifies category semantics and output formats but does not publish a JSON property schema. Capture a real, small response before fixing serde field names. Use a synthetic fixture based on that captured shape and replace only dates/percentages with invented values; do not label invented rows as official measurements.
- This is a weekly observation. Preserve the provider's week-ending date as period and set `released_at` conservatively to the fetch timestamp unless the response supplies a release timestamp.

## Fixture and licensing notes

- Keep fixture rows minimal and synthetic where values can be mistaken for licensed or provider-published records. Label synthetic fixtures in the README and fixture filename. Provider endpoints, field names, units, and release-date handling should still match the official contracts.
- For CFTC and USDA public records, synthetic fixtures avoid treating changing downloaded records as a permanent contract; a small, attributed provider sample can be recorded locally only after checking the provider's terms and the project redistribution policy.
- This spike did not verify live credentials or make production-scale historical requests. FAS row property names/credential header and exact CFTC API keys must be confirmed from current machine-readable metadata before relying on them.
