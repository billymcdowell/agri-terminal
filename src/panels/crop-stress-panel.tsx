import { useQuery } from "@tanstack/react-query";
import { Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cropStressTimeline, type StressPoint } from "@/lib/ipc";
import { usePalette } from "@/lib/theme";
import { toDisplayPrice, UNIT_LABELS, useUnits } from "@/lib/units";
import type { PanelComponentProps } from "@/workspace/types";
import { PanelHeader, usePanelCommodity } from "./panel-header";

/** Recharts range areas take a [low, high] pair; gaps are null so the band disappears off-season. */
export function toChartRows(points: StressPoint[]) {
  return points.map((point) => ({
    ...point,
    band: point.conditionLow !== null && point.conditionHigh !== null ? [point.conditionLow, point.conditionHigh] : null,
  }));
}

export function CropStressPanel({ api, params }: PanelComponentProps) {
  const { commodity, change } = usePanelCommodity(params, api);
  const palette = usePalette();
  const timeline = useQuery({ queryKey: ["crop-stress", commodity], queryFn: () => cropStressTimeline(commodity) });
  const units = useUnits();
  const rows = toChartRows((timeline.data ?? []).map((point) => ({ ...point, close: toDisplayPrice(point.close, commodity, units) })));
  const hasCondition = rows.some((row) => row.condition !== null);
  return (
    <div className="workspace-panel">
      <PanelHeader eyebrow="COMBINED VIEW" title={`Crop stress timeline · ${commodity}`} api={api} params={params} commodity={commodity} onCommodityChange={change} />
      <Card className="terminal-card">
        <CardHeader><CardTitle className="side-card-title">Price, crop condition and drought on one timeline</CardTitle></CardHeader>
        <CardContent>
          <div className="stress-chart" role="img" aria-label={`Price, good-to-excellent crop condition against its five-year range, and drought area for ${commodity}`}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={palette.grid} vertical={false} />
                <XAxis dataKey="date" tick={{ fill: palette.muted, fontSize: 10 }} minTickGap={40} />
                <YAxis yAxisId="price" tick={{ fill: palette.muted, fontSize: 10 }} domain={["auto", "auto"]} width={42} tickFormatter={(value: number) => value.toFixed(2)} />
                <YAxis yAxisId="percent" orientation="right" tick={{ fill: palette.muted, fontSize: 10 }} domain={[0, 100]} width={36} unit="%" />
                <Tooltip contentStyle={{ background: palette.tooltipBackground, border: `1px solid ${palette.tooltipBorder}`, color: palette.price, fontSize: 11 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area yAxisId="percent" dataKey="band" name="Condition 5-yr range" stroke="none" fill={palette.conditionBand} isAnimationActive={false} connectNulls={false} />
                <Line yAxisId="percent" dataKey="condition" name="Good / excellent %" stroke={palette.condition} dot={false} strokeWidth={1.5} isAnimationActive={false} connectNulls={false} />
                <Line yAxisId="percent" dataKey="drought" name="Growing-area drought (D1+) %" stroke={palette.drought} dot={false} strokeWidth={1.5} strokeDasharray="4 3" isAnimationActive={false} connectNulls={false} />
                <Line yAxisId="price" dataKey="close" name={`Close (${UNIT_LABELS[units]})`} stroke={palette.price} dot={false} strokeWidth={1.5} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="panel-freshness">
            {timeline.isError ? String(timeline.error) : rows.length === 0 ? "No cached prices for this commodity yet." : !hasCondition ? "No crop condition is cached for this period; add a NASS key under Data sources, or the crop is out of season." : "Each weekly value appears only after its release, and gaps mean no current report. The band is the same week over the previous five years."}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
