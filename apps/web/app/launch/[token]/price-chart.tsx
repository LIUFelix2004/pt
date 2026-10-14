"use client";

import { useEffect, useRef, useState } from "react";
import { CandlestickSeries, ColorType, createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { getCandles, type Candle } from "@/lib/api";
import { cn } from "@/lib/utils";

const INTERVALS = ["1m", "5m", "1h", "1d"] as const;

/**
 * Candles from the API's swap index, drawn with TradingView's open-source
 * lightweight-charts (Apache-2.0). Prices are quote per whole token.
 */
export function PriceChart({ token, quoteDecimals, refreshKey }: { token: string; quoteDecimals: number; refreshKey: number }) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const [interval, setInterval_] = useState<(typeof INTERVALS)[number]>("5m");
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    if (!box.current) return;
    const styles = getComputedStyle(document.documentElement);
    const c = createChart(box.current, {
      height: 260,
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: styles.getPropertyValue("--fg-muted").trim() || "#9ba9c2" },
      grid: { vertLines: { color: "rgba(38,49,74,0.5)" }, horzLines: { color: "rgba(38,49,74,0.5)" } },
      timeScale: { timeVisible: true, borderColor: "#26314a" },
      rightPriceScale: { borderColor: "#26314a" },
    });
    // Lime / rose rather than green / red: amber stays reserved for warnings.
    series.current = c.addSeries(CandlestickSeries, {
      upColor: "#b4f04a",
      downColor: "#ff8fa3",
      borderVisible: false,
      wickUpColor: "#b4f04a",
      wickDownColor: "#ff8fa3",
      priceFormat: { type: "price", precision: 10, minMove: 1e-10 },
    });
    chart.current = c;
    return () => {
      c.remove();
      chart.current = null;
      series.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getCandles(token, interval)
      .then(({ candles }) => {
        if (cancelled || !series.current) return;
        const scale = 10 ** quoteDecimals;
        const toNum = (v: string) => Number(v) / scale;
        series.current.setData(
          candles.map((k: Candle) => ({
            time: k.t as UTCTimestamp,
            open: toNum(k.o),
            high: toNum(k.h),
            low: toNum(k.l),
            close: toNum(k.c),
          })),
        );
        chart.current?.timeScale().fitContent();
        setEmpty(candles.length === 0);
      })
      .catch(() => setEmpty(true));
    return () => {
      cancelled = true;
    };
  }, [token, interval, quoteDecimals, refreshKey]);

  return (
    <div>
      <div className="mb-2 flex gap-1.5">
        {INTERVALS.map((i) => (
          <button
            key={i}
            onClick={() => setInterval_(i)}
            className={cn("rounded px-2 py-0.5 font-mono text-[11px]", interval === i ? "bg-surface-2 text-fg" : "text-fg-muted hover:text-fg")}
          >
            {i}
          </button>
        ))}
      </div>
      <div className="relative">
        <div ref={box} className="h-[260px] w-full" />
        {empty ? <div className="pointer-events-none absolute inset-0 grid place-items-center text-xs text-fg-muted">—</div> : null}
      </div>
    </div>
  );
}
