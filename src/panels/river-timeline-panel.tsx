import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getRiverStatus, getRiverTimeline, type RiverPoint } from "@/lib/ipc";
import { usePalette } from "@/lib/theme";
import { toDisplayPrice, UNIT_LABELS, useUnits, type UnitSystem } from "@/lib/units";
import { findGauge, GAUGES } from "@/lib/waterways";
import { useRiverUpdates } from "@/state/use-series";
import type { PanelComponentProps } from "@/workspace/types";
import { PanelHeader, usePanelCommodity } from "./panel-header";
import { RIVER_TEXT } from "./river-text";

export type TimelineRange = "1Y" | "3Y" | "ALL";
const RANGE_DAYS: Record<TimelineRange, number> = { "1Y": 366, "3Y": 3 * 366, ALL: Number.POSITIVE_INFINITY };

/** The last `range` of points, with the stage band as the [low, high] pair Recharts range areas take. */
export function toTimelineRows(points: RiverPoint[], range: TimelineRange, commodity: string, units: UnitSystem) {
  const last = points.length ? Date.parse(points[points.length - 1].date) : 0;
  return points
    .filter((point) => last - Date.parse(point.date) < RANGE_DAYS[range] * 86_400_000)
    .map((point) => ({
      ...point,
      close: point.close === null ? null : toDisplayPrice(point.close, commodity, units),
      stageRange: point.stageLow !== null && point.stageHigh !== null ? [point.stageLow, point.stageHigh] : null,
    }));
}

export function RiverTimelinePanel({ api, params }: PanelComponentProps) {
  const { commodity, change } = usePanelCommodity(params, api);
  const gauge = findGauge(params.gauge) ?? GAUGES[0];
  useRiverUpdates();
  const palette = usePalette();
  const units = useUnits();
  const [range, setRange] = useState<TimelineRange>("1Y");
  const timeline = useQuery({ queryKey: ["river-timeline", gauge.id, commodity], queryFn: () => getRiverTimeline(gauge.id, commodity), staleTime: 60_000 });
  const status = useQuery({ queryKey: ["river-status", gauge.id], queryFn: () => getRiverStatus(gauge.id), staleTime: 60_000 });
  const rows = toTimelineRows(timeline.data ?? [], range, commodity, units);
  const thresholds = status.data?.thresholds;
  const hasBasis = rows.some((row) => row.basisSpread !== null);
  const tooltip = { background: palette.tooltipBackground, border: `1px solid ${palette.tooltipBorder}`, color: palette.price, fontSize: 11 };
  const axis = { fill: palette.muted, fontSize: 10 };
  return (
    <div className="workspace-panel">
      <PanelHeader eyebrow={RIVER_TEXT.timelineEyebrow} title={RIVER_TEXT.timelineTitle(gauge.name, commodity)} api={api} params={params} commodity={commodity} onCommodityChange={change} />
      <Card className="terminal-card">
        <CardHeader>
          <CardTitle className="side-card-title">{RIVER_TEXT.timelineIntro}</CardTitle>
          <div className="river-range" role="group" aria-label="Timeline range">
            {(Object.keys(RANGE_DAYS) as TimelineRange[]).map((option) => (
              <Button key={option} size="xs" variant={option === range ? "secondary" : "ghost"} aria-pressed={option === range} onClick={() => setRange(option)}>{option}</Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <div className="river-chart" role="img" aria-label={`Stage at ${gauge.name} against its five-year range, the lowest forecast stage, thresholds and the ${commodity} close`}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows} syncId="river-timeline" margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={palette.grid} vertical={false} />
                <XAxis dataKey="date" tick={axis} minTickGap={40} />
                <YAxis yAxisId="stage" tick={axis} width={42} unit=" ft" domain={["auto", "auto"]} />
                <YAxis yAxisId="price" orientation="right" tick={axis} width={42} domain={["auto", "auto"]} tickFormatter={(value: number) => value.toFixed(2)} />
                <Tooltip contentStyle={tooltip} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area yAxisId="stage" dataKey="stageRange" name="Stage 5-yr range" stroke="none" fill={palette.stageBand} isAnimationActive={false} connectNulls={false} />
                <Line yAxisId="stage" dataKey="stage" name="Stage (ft)" stroke={palette.stage} dot={false} strokeWidth={1.5} isAnimationActive={false} connectNulls={false} />
                <Line yAxisId="stage" dataKey="forecastMin" name="Lowest forecast, next 7 days (ft)" stroke={palette.forecast} dot={false} strokeWidth={1} strokeDasharray="4 3" isAnimationActive={false} connectNulls={false} />
                {thresholds && <ReferenceLine yAxisId="stage" y={thresholds.restriction} stroke={palette.threshold} strokeDasharray="2 4" label={{ value: "restriction", fill: palette.muted, fontSize: 10, position: "insideTopLeft" }} />}
                {thresholds && <ReferenceLine yAxisId="stage" y={thresholds.critical} stroke={palette.threshold} label={{ value: "critical", fill: palette.muted, fontSize: 10, position: "insideTopLeft" }} />}
                <Line yAxisId="price" dataKey="close" name={`${commodity} close (${UNIT_LABELS[units]})`} stroke={palette.price} dot={false} strokeWidth={1} isAnimationActive={false} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="river-chart river-chart-lower" role="img" aria-label="Constraint score and downbound barge freight">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows} syncId="river-timeline" margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={palette.grid} vertical={false} />
                <XAxis dataKey="date" tick={axis} minTickGap={40} />
                <YAxis yAxisId="score" tick={axis} width={42} domain={[0, 100]} />
                <YAxis yAxisId="freight" orientation="right" tick={axis} width={42} domain={["auto", "auto"]} unit="%" />
                <Tooltip contentStyle={tooltip} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line yAxisId="score" dataKey="score" name="Constraint score" stroke={palette.score} dot={false} strokeWidth={1.5} isAnimationActive={false} connectNulls={false} />
                <Line yAxisId="freight" dataKey="bargeRate" name="Barge rate (% of tariff)" stroke={palette.freight} dot={false} strokeWidth={1} type="stepAfter" isAnimationActive={false} connectNulls={false} />
                {hasBasis && <Line yAxisId="freight" dataKey="basisSpread" name="Gulf minus interior basis" stroke={palette.drought} dot={false} isAnimationActive={false} />}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="panel-freshness">
            {timeline.isError ? String(timeline.error) : rows.length === 0 ? RIVER_TEXT.timelineNoData : `Each value appears only from the day it was published. Gaps mean no current reading. ${hasBasis ? "" : RIVER_TEXT.basisNote}`}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
