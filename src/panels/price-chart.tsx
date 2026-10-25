import { useEffect, useMemo, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  type ISeriesMarkersPluginApi,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";
import type { PriceBar } from "@/lib/ipc";
import { usePalette, type Palette } from "@/lib/theme";

const chartOptions = (palette: Palette) => ({
  layout: {
    background: { type: ColorType.Solid, color: palette.chartBackground },
    textColor: palette.text,
    fontFamily: "'Geist Mono Variable', monospace",
    fontSize: 11,
  },
  grid: { vertLines: { color: palette.grid }, horzLines: { color: palette.gridStrong } },
  rightPriceScale: { borderColor: palette.border },
  timeScale: { borderColor: palette.border, timeVisible: false, rightOffset: 4 },
  crosshair: { vertLine: { color: palette.crosshair }, horzLine: { color: palette.crosshair } },
});

const seriesOptions = (palette: Palette) => ({
  upColor: palette.up,
  downColor: palette.down,
  borderUpColor: palette.up,
  borderDownColor: palette.down,
  wickUpColor: palette.up,
  wickDownColor: palette.down,
});

export type MoveMarker = { date: string; direction: "up" | "down"; text: string };
type PriceChartProps = { bars: PriceBar[]; markers?: MoveMarker[] };

export function PriceChart({ bars, markers = [] }: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const palette = usePalette();
  const paletteRef = useRef(palette);
  paletteRef.current = palette;
  const data = useMemo(
    () =>
      bars.map((bar) => ({
        time: bar.period as Time,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      })),
    [bars],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, { autoSize: true, ...chartOptions(paletteRef.current) });
    const series = chart.addSeries(CandlestickSeries, seriesOptions(paletteRef.current));

    chartRef.current = chart;
    seriesRef.current = series;
    markersRef.current = createSeriesMarkers(series, []);
    const resizeObserver = new ResizeObserver(([entry]) => {
      if (entry)
        chart.resize(entry.contentRect.width, entry.contentRect.height);
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      markersRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.applyOptions(chartOptions(palette));
    seriesRef.current?.applyOptions(seriesOptions(palette));
  }, [palette]);

  useEffect(() => {
    const dates = new Set(bars.map((bar) => bar.period));
    markersRef.current?.setMarkers(
      markers
        .filter((marker) => dates.has(marker.date))
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((marker) => ({
          time: marker.date as Time,
          position: marker.direction === "up" ? ("belowBar" as const) : ("aboveBar" as const),
          shape: marker.direction === "up" ? ("arrowUp" as const) : ("arrowDown" as const),
          color: marker.direction === "up" ? palette.up : palette.down,
          text: marker.text,
        })),
    );
  }, [markers, bars, palette]);

  useEffect(() => {
    seriesRef.current?.setData(data);
    chartRef.current?.timeScale().fitContent();
  }, [data]);

  return (
    <div
      ref={containerRef}
      role="img"
      className="price-chart-canvas"
      aria-label="Futures daily price chart"
    />
  );
}
