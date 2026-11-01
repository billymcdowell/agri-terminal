import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatAge } from "@/lib/freshness";
import { getRiverStatus, type RiverInput, type RiverStatus } from "@/lib/ipc";
import { findGauge, GAUGES } from "@/lib/waterways";
import { useRiverUpdates } from "@/state/use-series";
import type { PanelComponentProps } from "@/workspace/types";
import { PanelHeader } from "./panel-header";
import { BAND_LABELS, componentBreakdown, describeSensitivity, formatFeet, formatPercentChange, formatTons, RIVER_TEXT, stagePosition } from "./river-text";

/** "Released 29 Oct · fetched 3h old · usda-agtransport", so every input shows how current it is. */
export function inputFreshness(input: Pick<RiverInput, "releasedAt" | "fetchedAt" | "sourceId">, now: number) {
  return `Released ${new Date(input.releasedAt).toLocaleDateString()} · fetched ${formatAge(input.fetchedAt, now)} · ${input.sourceId}`;
}

function ScoreCard({ status }: { status: RiverStatus }) {
  const score = status.score;
  return (
    <Card className="terminal-card">
      <CardHeader><CardTitle className="side-card-title">{RIVER_TEXT.scoreHeading}</CardTitle></CardHeader>
      <CardContent>
        {score ? (
          <>
            <div className="river-score">
              <span className="metric-value" aria-label="Constraint score out of 100">{Math.round(score.total)}</span>
              <span className="river-band" data-band={score.band}>{BAND_LABELS[score.band].toUpperCase()}</span>
              {score.partial && <span className="river-partial">{RIVER_TEXT.partial}</span>}
            </div>
            <p className="metric-foot">{componentBreakdown(score)} (points of 100)</p>
            {score.partial && <p className="metric-foot">{RIVER_TEXT.partialNote}</p>}
          </>
        ) : <p className="metric-foot">{RIVER_TEXT.noScore}</p>}
        {status.provisional && <p className="metric-foot">{RIVER_TEXT.provisional}</p>}
      </CardContent>
    </Card>
  );
}

function StageCard({ status, now }: { status: RiverStatus; now: number }) {
  const { thresholds, stageBand } = status;
  return (
    <Card className="terminal-card">
      <CardHeader><CardTitle className="side-card-title">{RIVER_TEXT.stageHeading}</CardTitle></CardHeader>
      <CardContent>
        <div className="metric-value">{formatFeet(status.stage?.value)}</div>
        <p className="metric-foot">{stagePosition(status)}</p>
        <p className="metric-foot">Normal {formatFeet(thresholds.normal)} · restriction {formatFeet(thresholds.restriction)} · critical {formatFeet(thresholds.critical)}</p>
        <p className="metric-foot">
          {stageBand ? `Same time of year, previous ${stageBand.years} years: ${formatFeet(stageBand.low)} to ${formatFeet(stageBand.high)} (average ${formatFeet(stageBand.mean)})` : "Not enough history for a five-year range yet."}
        </p>
        {status.stage && <p className="metric-foot">Reading for {status.stage.period} · {inputFreshness(status.stage, now)}</p>}
      </CardContent>
    </Card>
  );
}

function ForecastCard({ status, now }: { status: RiverStatus; now: number }) {
  return (
    <Card className="terminal-card">
      <CardHeader><CardTitle className="side-card-title">{RIVER_TEXT.forecastHeading}</CardTitle></CardHeader>
      <CardContent>
        {status.forecast.length === 0 ? <p className="metric-foot">{RIVER_TEXT.noForecast}</p> : (
          <>
            <Table>
              <TableHeader><TableRow><TableHead>Day</TableHead><TableHead className="text-right">Low</TableHead><TableHead>Restriction</TableHead></TableRow></TableHeader>
              <TableBody>
                {status.forecast.map((day) => {
                  const below = day.low <= status.thresholds.restriction;
                  return (
                    <TableRow key={day.date}>
                      <TableCell>{day.date.slice(5)}</TableCell>
                      <TableCell className="text-right">{formatFeet(day.low)}</TableCell>
                      <TableCell className={below ? "river-warning" : undefined}>{below ? "below" : "above"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {status.restrictionForecastOn && <p className="metric-foot river-warning">Forecast to reach the restriction level by {status.restrictionForecastOn}.</p>}
            {status.forecastIssuedAt && (
              <p className="metric-foot">Issued {new Date(status.forecastIssuedAt).toLocaleString()}{status.forecastFetchedAt ? ` · fetched ${formatAge(status.forecastFetchedAt, now)}` : ""} · NWS</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function FreightCard({ status, now }: { status: RiverStatus; now: number }) {
  const rate = status.bargeRate;
  return (
    <Card className="terminal-card">
      <CardHeader><CardTitle className="side-card-title">{RIVER_TEXT.freightHeading}{rate?.location ? ` · ${rate.location}` : ""}</CardTitle></CardHeader>
      <CardContent>
        {!rate ? <p className="metric-foot">{RIVER_TEXT.noFreight}</p> : (
          <>
            <div className="metric-value">{Math.round(rate.latest.value)}% of tariff</div>
            <p className="metric-foot">
              {rate.dollarsPerTon !== null ? `About $${rate.dollarsPerTon.toFixed(2)} per short ton · ` : ""}
              {formatPercentChange(rate.changePercent)} on the week before
            </p>
            <p className="metric-foot">Week ending {rate.latest.period} · {inputFreshness(rate.latest, now)}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function PressureCard({ status }: { status: RiverStatus }) {
  const pressure = status.pressure;
  const sign = (value: number) => (value > 0 ? "+" : value < 0 ? "−" : "");
  return (
    <Card className="terminal-card">
      <CardHeader><CardTitle className="side-card-title">{RIVER_TEXT.pressureHeading}</CardTitle></CardHeader>
      <CardContent>
        {!pressure ? <p className="metric-foot">{RIVER_TEXT.noPressure}</p> : (
          <>
            <div className="metric-value">{sign(pressure.change)}{Math.abs(pressure.change).toFixed(0)}% of tariff</div>
            <p className="metric-foot">
              {pressure.dollarsPerTon !== null ? `About ${sign(pressure.dollarsPerTon)}$${Math.abs(pressure.dollarsPerTon).toFixed(2)} per short ton · ` : ""}
              depth below restriction {formatFeet(pressure.currentDepth)} over the last week, {formatFeet(pressure.expectedDepth)} expected in the forecast's second week
            </p>
            <p className="metric-foot">{describeSensitivity(pressure.sensitivity)}</p>
          </>
        )}
        <p className="metric-foot">{RIVER_TEXT.pressureCaveat}</p>
      </CardContent>
    </Card>
  );
}

function TrafficCard({ status }: { status: RiverStatus }) {
  const traffic = status.traffic;
  return (
    <Card className="terminal-card">
      <CardHeader><CardTitle className="side-card-title">{RIVER_TEXT.trafficHeading}</CardTitle></CardHeader>
      <CardContent>
        {!traffic ? <p className="metric-foot">{RIVER_TEXT.noTraffic}</p> : (
          <>
            <div className="metric-value">{formatTons(traffic.tons)}</div>
            <p className="metric-foot">{formatPercentChange(traffic.changePercent)} against the four weeks before ({formatTons(traffic.averageTons)} a week)</p>
            <p className="metric-foot">Week ending {traffic.week} · {traffic.locks.join(" and ")} · released {new Date(traffic.releasedAt).toLocaleDateString()}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function RiverPanel({ api, params }: PanelComponentProps) {
  const gauge = findGauge(params.gauge) ?? GAUGES[0];
  useRiverUpdates();
  const status = useQuery({ queryKey: ["river-status", gauge.id], queryFn: () => getRiverStatus(gauge.id), staleTime: 60_000 });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const data = status.data;
  return (
    <div className="workspace-panel">
      <PanelHeader eyebrow={RIVER_TEXT.eyebrow} title={RIVER_TEXT.title(gauge.name)} api={api} params={params} />
      {status.isError && <p className="panel-freshness" data-status="error" role="status">{String(status.error)}</p>}
      {status.isPending && <p className="panel-freshness" role="status">Loading…</p>}
      {data && (
        <>
          <div className="river-grid">
            <ScoreCard status={data} />
            <StageCard status={data} now={now} />
            <ForecastCard status={data} now={now} />
            <FreightCard status={data} now={now} />
            <PressureCard status={data} />
            <TrafficCard status={data} />
          </div>
          <p className="panel-freshness">{params.audience === "farmer" ? RIVER_TEXT.farmer : RIVER_TEXT.trader}</p>
        </>
      )}
    </div>
  );
}
