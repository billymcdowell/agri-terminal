import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatAge } from "@/lib/freshness";
import { getWeatherForCommodity, refreshWeather } from "@/lib/ipc";
import { cropAdjective } from "@/lib/regions";
import { useCrop } from "@/shell/crop";
import { PanelHeader } from "./panel-header";
import { nextForecastsBySource } from "./weather";
import { WeatherMap } from "./weather-map";

const REFRESH_MS = 30 * 60_000;
/** States listed before the full table. */
const LISTED = 5;

/** Reads the local forecast cache and refreshes it in the background, so the panel works offline. */
export function WeatherPanel() {
  const commodity = useCrop((state) => state.crop);
  const queryClient = useQueryClient();
  const snapshot = useQuery({ queryKey: ["weather", commodity], queryFn: () => getWeatherForCommodity(commodity) });
  const [refreshError, setRefreshError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => refreshWeather(commodity)
      .then(() => !cancelled && setRefreshError(null))
      .catch((error) => !cancelled && setRefreshError(String(error)))
      .finally(() => !cancelled && void queryClient.invalidateQueries({ queryKey: ["weather", commodity] }));
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [commodity, queryClient]);

  const forecasts = snapshot.data?.forecasts;
  const upcoming = useMemo(() => nextForecastsBySource(forecasts ?? [], Date.now()), [forecasts]);
  const mapPoints = useMemo(() => upcoming.filter((point) => point.provider === "Open-Meteo"), [upcoming]);
  const fetchedAt = snapshot.data?.fetchedAt;
  // One row per state (Open-Meteo, or NWS where Open-Meteo has none); both providers and the map on request.
  const byRegion = useMemo(() => {
    const rows = new Map<string, (typeof upcoming)[number]>();
    for (const point of upcoming) if (!rows.has(point.regionId) || point.provider === "Open-Meteo") rows.set(point.regionId, point);
    return [...rows.values()];
  }, [upcoming]);
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="workspace-panel">
      <PanelHeader title={`Weather in ${cropAdjective(commodity).toLowerCase()} states`} kind="weather" />
      {expanded && <WeatherMap locations={mapPoints} />}
      <Card className="terminal-card">
        <CardContent>
          {!expanded && (
            <Table>
              <TableHeader>
                <TableRow><TableHead>State</TableHead><TableHead>Temp</TableHead><TableHead>Precip</TableHead><TableHead>Wind</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {byRegion.slice(0, LISTED).map((point) => (
                  <TableRow key={point.regionId}>
                    <TableCell>{point.regionName}</TableCell>
                    <TableCell>{point.temperatureC?.toFixed(1) ?? "—"} °C</TableCell>
                    <TableCell>{point.precipitationMm?.toFixed(1) ?? "—"} mm</TableCell>
                    <TableCell>{point.windKph?.toFixed(0) ?? "—"} km/h</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {expanded && <Table>
            <TableHeader>
              <TableRow><TableHead>Region</TableHead><TableHead>Provider</TableHead><TableHead>Valid</TableHead><TableHead>Temp</TableHead><TableHead>Precip</TableHead><TableHead>Wind</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {upcoming.map((point) => (
                <TableRow key={`${point.regionId}:${point.provider}`}>
                  <TableCell>{point.regionName}</TableCell>
                  <TableCell>{point.provider}</TableCell>
                  <TableCell>{new Date(point.validAt).toLocaleString()}</TableCell>
                  <TableCell>{point.temperatureC?.toFixed(1) ?? "—"} °C</TableCell>
                  <TableCell>{point.precipitationMm?.toFixed(1) ?? "—"} mm</TableCell>
                  <TableCell>{point.windKph?.toFixed(0) ?? "—"} km/h</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>}
          {upcoming.length > 0 && (
            <Button size="xs" variant="ghost" className="show-all" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
              {expanded ? "Show fewer" : `All ${byRegion.length} states, both providers, map`}
            </Button>
          )}
          <p className="panel-freshness" data-status={refreshError ? "error" : fetchedAt ? "ok" : "empty"}>
            {fetchedAt ? `${refreshError ? "Update failed · showing the forecast from" : "Updated"} ${formatAge(fetchedAt, Date.now())}` : refreshError ? "Could not load yet" : "Loading the first forecast…"}
            {" · Open-Meteo.com (CC BY 4.0) and the National Weather Service · map © OpenStreetMap"}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
