import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatAge } from "@/lib/freshness";
import { getWeatherForCommodity, refreshWeather } from "@/lib/ipc";
import type { PanelComponentProps } from "@/workspace/types";
import { PanelHeader, usePanelCommodity } from "./panel-header";
import { nextForecastsBySource } from "./weather";
import { WeatherMap } from "./weather-map";

const REFRESH_MS = 30 * 60_000;

/** Reads the local forecast cache and refreshes it in the background, so the panel works offline. */
export function WeatherPanel({ api, params }: PanelComponentProps) {
  const { commodity, change } = usePanelCommodity(params, api);
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

  return (
    <div className="workspace-panel">
      <PanelHeader eyebrow="CROP REGION WEATHER" title={`${commodity} forecast`} api={api} params={params} commodity={commodity} onCommodityChange={change} />
      <WeatherMap locations={mapPoints} />
      <Card className="terminal-card">
        <CardHeader><CardTitle className="side-card-title">Next forecast period by region</CardTitle></CardHeader>
        <CardContent>
          <Table>
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
          </Table>
          <p className="panel-freshness" data-status={refreshError ? "error" : fetchedAt ? "ok" : "empty"}>
            {fetchedAt ? `${refreshError ? "ERROR · CACHED FORECAST" : "OK"} · ${formatAge(fetchedAt, Date.now())}` : refreshError ? "ERROR · no cached forecast" : "WAITING · fetching first forecast"}
            {refreshError ? ` · ${refreshError}` : ""}
          </p>
          <p className="panel-freshness">
            Weather data by Open-Meteo.com (CC BY 4.0, non-commercial use) and the U.S. National Weather Service. Map tiles © OpenStreetMap contributors.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
