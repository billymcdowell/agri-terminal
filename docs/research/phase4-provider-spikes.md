# Phase 4 provider spikes

Checked 24 October 2026 against provider documentation and report catalogs.

## NWS and Open-Meteo

- NWS publishes an open JSON/GeoJSON API at `api.weather.gov`. Forecast retrieval uses `/points/{lat},{lon}` first, then the `forecastHourly` URL returned in `properties`; the grid mapping can change and should be looked up again periodically. Requests identify this app with a descriptive `User-Agent`. The connector does a fresh point lookup for each configured region and reads hourly forecasts. See the [NWS API guide](https://www.weather.gov/documentation/services-web-api).
- Open-Meteo's forecast API accepts coordinates and hourly variables such as `temperature_2m`, `relative_humidity_2m`, `precipitation`, and `wind_speed_10m`. The free endpoint is limited to non-commercial usage, including under 10,000 calls/day, and requires CC BY 4.0 attribution. The weather panel displays this attribution. See [Forecast API](https://open-meteo.com/en/docs) and [Terms](https://open-meteo.com/en/terms).
- The app maps representative points for corn, soybean, and wheat growing states from `config/crop-regions.json`. These points provide regional context, not a field-level forecast.
- MapLibre renders OpenStreetMap raster tiles and includes the required visible attribution. The tile provider is configurable in the UI code if deployment needs a hosted tile service.

## GDELT and RSS

- The GDELT DOC API supports ArticleList (`mode=ArtList`) JSON queries, date windows such as `timespan=7d`, sorting by date, and up to 250 article results per request. The connector asks for at most 75 English-language results and stores only headline, source domain, publication time, link, and commodity tag. See [GDELT DOC 2.0 API documentation](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/).
- USDA NASS publishes its [News & Events RSS feed](https://www.nass.usda.gov/rss/news.xml) and [Today's Reports RSS feed](https://www.nass.usda.gov/rss/reports.xml). The parser filters feed titles by commodity terms and does not store article text.

## USDA AMS MARS coverage decision

- Coverage is adequate to justify a grain cash/basis connector. The USDA AMS state-grain catalog links current state and regional cash grain reports. The [Minneapolis Daily Grain Report](https://mymarketnews.ams.usda.gov/node/9740) is an active daily grain report and explicitly documents bids/trades, prices, and basis. The [California Grain Report](https://www.ams.usda.gov/mnreports/ams_3146.pdf) includes corn futures and local corn cash price and basis columns; the Iowa daily report also shows state average corn and soybean prices.
- MARS provides JSON report resources using a report slug, and documentation shows filtering by commodity and date. For example, the Minneapolis report uses slug `3046`; a grain report's API endpoint is `https://marsapi.ams.usda.gov/services/v1.2/reports/{slug}`. Requests require the user's personal key as HTTP Basic username and the key must remain secret. The API documentation explicitly says browser calls are unsupported. See [AMS report catalog](https://www.ams.usda.gov/market-news/state-grain-reports), [report 3046](https://mymarketnews.ams.usda.gov/node/9740), [MARS API examples](https://mymarketnews.ams.usda.gov/mymarketnews-api/examples), and [authentication guide](https://mymarketnews.ams.usda.gov/mymarketnews-api/authentication).
- **Decision: build the connector.** Before enabling basis outputs, capture a small keyed response for report 3046 and one Iowa report, because the published guide documents report lookup/filtering but does not show a grain-row JSON example. The report PDFs establish the coverage and useful fields; exact API field mapping remains a keyed contract check.
