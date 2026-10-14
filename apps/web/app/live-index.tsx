"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { PhaseBadge } from "@/components/portus/phase-badge";
import {
  getChainOffset,
  getLaunches,
  countdown,
  formatPricePerToken,
  formatQuote,
  subscriptionRatio,
  type Launch,
} from "@/lib/api";

/** Auto-refreshing launch list: phase changes show up without a reload. */
export function LiveIndex({ initial, emptyLabel }: { initial: Launch[]; emptyLabel?: string }) {
  const t = useTranslations("liveIndex");
  const tp = useTranslations("phase");
  const [launches, setLaunches] = useState(initial);
  const [lastRefresh, setLastRefresh] = useState<number | null>(null);
  const [error, setError] = useState(false);
  // Null until mounted: a server-rendered countdown never matches the client one.
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      try {
        const offset = await getChainOffset();
        setNow(Math.floor(Date.now() / 1000) + offset);
        const list = await getLaunches();
        if (!stopped) {
          setLaunches(list);
          setLastRefresh(Math.floor(Date.now() / 1000));
          setError(false);
        }
      } catch {
        if (!stopped) setError(true);
      }
    };
    void tick();
    const timer = setInterval(tick, 10_000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-[11px] font-semibold tracking-[0.18em] text-fg-muted uppercase">{t("title")}</h2>
        <span className="font-mono text-[11px] text-fg-muted">
          {error
            ? t("apiDown")
            : lastRefresh
              ? t("refreshes", { time: new Date(lastRefresh * 1000).toISOString().slice(11, 19) + "Z" })
              : t("loading")}
        </span>
      </div>
      <div className="rule-neon mt-2 mb-4 h-px w-full opacity-70" />

      {launches.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-surface/50 p-10 text-center text-sm text-fg-muted">
          {emptyLabel ?? t("empty")}
        </div>
      ) : (
        <div className="grid gap-3">
          {launches.map((l) => {
            const ratio = subscriptionRatio(l);
            const end = l.phase === "PENDING" ? l.startTime : l.phase === "OPEN" ? l.endTime : null;
            return (
              <a
                key={l.token}
                href={`/launch/view/?token=${l.token}`}
                className="group rounded-lg border border-line bg-surface p-4 transition-all hover:border-cyan/45 hover:bg-surface-2 sm:p-5"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <h3 className="text-base font-semibold tracking-tight text-fg transition-colors group-hover:text-cyan">
                    {l.copy.name}
                  </h3>
                  <span className="font-mono text-xs text-fg-muted">${l.copy.symbol}</span>
                  <PhaseBadge phase={l.phase} label={tp(l.phase)} live={l.phase === "OPEN"} className="ml-auto" />
                </div>

                <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-5">
                  <Cell label={t("colQuote")} value={l.quote?.symbol ?? "—"} />
                  <Cell label={t("colPrice")} value={formatPricePerToken(l, l.priceNum, l.priceDen)} />
                  <Cell
                    label={t("colProgress")}
                    value={`${formatQuote(l, l.totalCommitted, 4)} / ${formatQuote(l, l.raiseTarget, 4)}`}
                  />
                  <Cell
                    label={t("colReserves")}
                    value={l.reserveQuote ? formatQuote(l, l.reserveQuote, 4) : "—"}
                  />
                  <Cell label={l.phase === "PENDING" ? t("colStarts") : t("colEnds")} value={end && now !== null ? countdown(end, now) : "—"} />
                </div>

                <div className="mt-4 h-1 w-full overflow-hidden rounded-full bg-surface-2">
                  <span
                    className="block h-full rounded-full bg-gradient-to-r from-cyan to-magenta"
                    style={{ width: `${Math.min(ratio, 100)}%` }}
                  />
                </div>
                <p className="mt-2 font-mono text-[11px] text-fg-muted">
                  {ratio.toFixed(1)}%{ratio > 100 ? ` · ${t("oversubscribed")}` : ""}
                </p>
              </a>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-medium tracking-[0.14em] text-fg-muted uppercase">{label}</div>
      <div className="mt-1 truncate font-mono text-[13px] text-fg">{value}</div>
    </div>
  );
}
