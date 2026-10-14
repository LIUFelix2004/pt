"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { PhaseBadge, type Phase } from "@/components/obscura/phase-badge";
import { cn } from "@/lib/utils";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8787";

export interface LiveLaunchData {
  phase: Phase;
  clearingPrice: string | null;
  totalRevealedDemand: string;
  bidCount: number;
  indexedAtBlock: number;
  unrevealedCount: number;
  unrevealedDepositWei: string;
}

const WAD = 10n ** 18n;

function when(ts: number): string {
  return new Date(ts * 1000).toISOString().replace("T", " ").slice(0, 19) + "Z";
}

function countdown(target: number, now: number): string {
  const seconds = Math.max(0, target - now);
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return d > 0 ? `${d}d ${h}h ${m}m ${s}s` : `${h}h ${m}m ${s}s`;
}

export function LiveLaunch({
  id,
  initial,
}: {
  id: number;
  initial: LiveLaunchData & { commitEnd: number; revealEnd: number; supplyForSale: string };
}) {
  const t = useTranslations("liveLaunch");
  const [live, setLive] = useState(initial);
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));

  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      setNow(Math.floor(Date.now() / 1000));
      try {
        const res = await fetch(`${API_URL}/launches/${id}`, { cache: "no-store" });
        if (res.ok) {
          const json = (await res.json()) as LiveLaunchData;
          setLive((prev) => ({ ...prev, ...json }));
        }
      } catch {
        /* keep last good snapshot; the page revalidates on reload */
      }
    };
    tick();
    const timer = setInterval(tick, 10_000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [id]);

  const demandRatio = (): number => {
    const supply = BigInt(initial.supplyForSale);
    if (supply === 0n) return 0;
    return Math.min(Number((BigInt(live.totalRevealedDemand) * 1000n) / supply) / 10, 100);
  };

  const activeEnd =
    live.phase === "COMMIT" ? initial.commitEnd : live.phase === "REVEAL" ? initial.revealEnd : null;

  // Under 15 minutes left to reveal is the point where inaction starts costing
  // real money, so the countdown escalates rather than staying decorative.
  const urgent = live.phase === "REVEAL" && initial.revealEnd - now <= 900;

  return (
    <div
      className={cn(
        "rounded-lg border bg-surface/80 p-4 sm:p-5",
        urgent ? "border-warn/50" : "border-line glow-cyan",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="font-mono text-[10px] tracking-[0.16em] text-fg-muted">{t("phaseLive")}</span>
        <PhaseBadge phase={live.phase} live />
        {activeEnd !== null ? (
          <strong
            className={cn(
              "font-mono text-sm tabular-nums",
              urgent ? "text-warn" : "text-fg",
            )}
          >
            {t("closesIn", { time: countdown(activeEnd, now) })}
          </strong>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 font-mono text-[11px] text-fg-muted">
        <span>
          {t("revealedDemand")} <span className="text-fg">{demandRatio().toFixed(1)}%</span>{" "}
          {t("ofSupply")}
        </span>
        <span>
          {t("revealedBids")} <span className="text-fg">{live.bidCount}</span>
        </span>
        {live.clearingPrice ? (
          <span>
            {t("clearedAt")}{" "}
            <span className="text-lime">{(BigInt(live.clearingPrice) / WAD).toString()} ETH</span>
          </span>
        ) : null}
        <span>{t("indexedThroughBlock", { block: live.indexedAtBlock })}</span>
      </div>

      {live.unrevealedCount > 0 && live.phase === "REVEAL" ? (
        // Amber: this is money about to be forfeited, which is exactly what the
        // reserved hue is for.
        <p className="mt-3 rounded-md border border-warn-line bg-warn-surface px-3 py-2 text-xs leading-relaxed text-warn">
          {t("unopenedWarning", { count: live.unrevealedCount })}
        </p>
      ) : null}

      <p className="mt-3 font-mono text-[10px] text-fg-muted">
        {t("asOf", { time: when(now) })}
      </p>
    </div>
  );
}
