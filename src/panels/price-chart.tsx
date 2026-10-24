import { useEffect, useMemo, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";
import type { PriceBar } from "@/lib/ipc";

type PriceChartProps = { bars: PriceBar[] };

export function PriceChart({ bars }: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
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

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#101411" },
        textColor: "#828c83",
        fontFamily: "'Geist Mono Variable', monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(167, 180, 164, 0.07)" },
        horzLines: { color: "rgba(167, 180, 164, 0.09)" },
      },
      rightPriceScale: { borderColor: "rgba(167, 180, 164, 0.14)" },
      timeScale: {
        borderColor: "rgba(167, 180, 164, 0.14)",
        timeVisible: false,
        rightOffset: 4,
      },
      crosshair: {
        vertLine: { color: "#889488" },
        horzLine: { color: "#889488" },
      },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#8aac75",
      downColor: "#d77b68",
      borderUpColor: "#8aac75",
      borderDownColor: "#d77b68",
      wickUpColor: "#8aac75",
      wickDownColor: "#d77b68",
    });

    chartRef.current = chart;
    seriesRef.current = series;
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
    };
  }, []);

  useEffect(() => {
    seriesRef.current?.setData(data);
    chartRef.current?.timeScale().fitContent();
  }, [data]);

  return (
    <div
      ref={containerRef}
      className="price-chart-canvas"
      aria-label="Corn futures daily price chart"
    />
  );
}
