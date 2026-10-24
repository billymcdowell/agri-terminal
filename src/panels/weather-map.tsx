import { useEffect, useRef, useState } from "react";
import type { GeoJSONSource, Map as MapLibreMapType } from "maplibre-gl";
import type { WeatherForecast } from "@/lib/ipc";

/** Crop-region markers on an OpenStreetMap raster basemap. MapLibre loads lazily to keep startup fast. */
export function WeatherMap({ locations }: { locations: WeatherForecast[] }) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMapType | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!host.current) return;
    let disposed = false;
    let instance: MapLibreMapType | undefined;
    void Promise.all([import("maplibre-gl"), import("maplibre-gl/dist/maplibre-gl.css")]).then(([maplibre]) => {
      if (disposed || !host.current) return;
      const created = new maplibre.Map({
        container: host.current,
        style: {
          version: 8,
          sources: { osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap contributors" } },
          layers: [{ id: "osm", type: "raster", source: "osm" }],
        },
        center: [-95.5, 41.5],
        zoom: 4,
      });
      instance = created;
      map.current = created;
      created.addControl(new maplibre.NavigationControl(), "top-right");
      // "load" also waits for every basemap tile, which can stall on a slow or offline tile server.
      // The style is inline, so markers can be added as soon as it is parsed.
      let initialized = false;
      const addMarkers = () => {
        if (initialized) return;
        initialized = true;
        created.addSource("weather-locations", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        created.addLayer({ id: "weather-locations", type: "circle", source: "weather-locations", paint: { "circle-radius": 8, "circle-color": "#88ac75", "circle-stroke-color": "#f3eee4", "circle-stroke-width": 2 } });
        setReady(true);
      };
      created.on("style.load", addMarkers);
      if (created.isStyleLoaded()) addMarkers();
    });
    return () => { disposed = true; instance?.remove(); map.current = null; setReady(false); };
  }, []);

  useEffect(() => {
    const source = ready ? (map.current?.getSource("weather-locations") as GeoJSONSource | undefined) : undefined;
    source?.setData({
      type: "FeatureCollection",
      features: locations.map((point) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [point.longitude, point.latitude] },
        properties: { region: point.regionName, temperature: point.temperatureC, precipitation: point.precipitationMm },
      })),
    });
  }, [locations, ready]);

  return <div className="weather-map" ref={host} role="img" aria-label="Map of crop regions with weather forecasts" />;
}
