"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { PhaseBadge } from "@/components/portus/phase-badge";
import { Section } from "@/components/portus/section";
import { WalletBar } from "@/components/portus/wallet-bar";
import {
  API_URL,
  getChainOffset,
  countdown,
  formatPricePerToken,
  formatQuote,
  formatTokens,
  getSwaps,
  quoteDecimals,
  shortAddress,
  subscriptionRatio,
  type Launch,
  type SwapRecord,
} from "@/lib/api";
import { explorerTx } from "@/lib/chain";
import { SubscribePanel } from "./subscribe-panel";
import { ClaimPanel } from "./claim-panel";
import { SwapPanel } from "./swap-panel";
import { PriceChart } from "./price-chart";
import { LocalDevTools } from "@/components/portus/local-dev-tools";
import { EconomyPanel } from "./economy-panel";
import { RewardsPanel } from "./rewards-panel";
import { LiquidityPanel } from "./liquidity-panel";
import { MintPanel } from "./mint-panel";
import { ZonesPanel } from "@/components/portus/zones-panel";
import { InviteLinkButton } from "@/components/portus/invite-link-button";
import { useAccount } from "wagmi";

/** Live state + every on-chain action for one launch. Refreshes every 10 s. */
export function LiveLaunch({ initial }: { initial: Launch }) {
  const t = useTranslations("launch");
  const tp = useTranslations("phase");
  const tm = useTranslations("me");
  const { address } = useAccount();
  const [launch, setLaunch] = useState(initial);
  // Null until mounted: a server-rendered countdown never matches the client one.
  const [now, setNow] = useState<number | null>(null);
  const [swaps, setSwaps] = useState<SwapRecord[]>([]);
  const [tick, setTick] = useState(0);
  const [origin, setOrigin] = useState("");

  const refresh = useCallback(async () => {
    try {
      const offset = await getChainOffset();
      setNow(Math.floor(Date.now() / 1000) + offset);
      const res = await fetch(`${API_URL}/launches/${initial.token}`, { cache: "no-store" });
      if (res.ok) setLaunch((await res.json()) as Launch);
      setSwaps((await getSwaps(initial.token)).swaps);
      setTick((n) => n + 1);
    } catch {
      /* keep the last good snapshot */
    }
  }, [initial.token]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 10_000);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const ratio = subscriptionRatio(launch);
  const live = launch.phase === "SUCCEEDED";
  const target = launch.phase === "PENDING" ? launch.startTime : launch.phase === "OPEN" ? launch.endTime : null;

  return (
    <>
      <div className="rounded-lg border border-line bg-surface/80 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <PhaseBadge phase={launch.phase} label={tp(launch.phase)} live={launch.phase === "OPEN"} />
          {target && now !== null ? <strong className="font-mono text-sm text-fg tabular-nums">{countdown(target, now)}</strong> : null}
          <div className="ml-auto">
            <WalletBar />
          </div>
        </div>
        <p className="mt-2 text-sm text-fg-muted">{tp(`${launch.phase}_hint`)}</p>

        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Cell label={t("committed")} value={formatQuote(launch, launch.totalCommitted, 4)} />
          <Cell label={t("raiseTarget")} value={formatQuote(launch, launch.raiseTarget, 4)} />
          <Cell label={t("subscribers")} value={String(launch.subscriberCount)} />
          <Cell label={t("price")} value={formatPricePerToken(launch, launch.priceNum, launch.priceDen)} />
        </div>
        <div className="mt-4 h-1 w-full overflow-hidden rounded-full bg-surface-2">
          <span
            className="block h-full rounded-full bg-gradient-to-r from-cyan to-magenta"
            style={{ width: `${Math.min(ratio, 100)}%` }}
          />
        </div>
        <p className="mt-2 font-mono text-[11px] text-fg-muted">{ratio.toFixed(1)}%</p>
      </div>

      <div className="mt-4">
        <LocalDevTools launch={launch} onChange={() => void refresh()} />
      </div>

      {launch.phase === "OPEN" ? (
        <Section title={t("subscribe")}>
          <div className="rounded-lg border border-line bg-surface p-5">
            <SubscribePanel launch={launch} now={now ?? 0} onChange={() => void refresh()} />
          </div>
        </Section>
      ) : null}

      {launch.phase === "AWAITING_FINALIZE" || launch.phase === "SUCCEEDED" || launch.phase === "REFUNDING" ? (
        <Section title={launch.phase === "AWAITING_FINALIZE" ? t("finalizeAnyone") : t("claim")}>
          <div className="rounded-lg border border-line bg-surface p-5">
            <ClaimPanel launch={launch} onChange={() => void refresh()} />
          </div>
        </Section>
      ) : null}

      {live ? (
        <>
          <Section title={t("trade")}>
            <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
              <div className="rounded-lg border border-line bg-surface p-5">
                <SwapPanel launch={launch} onChange={() => void refresh()} />
              </div>
              <div className="rounded-lg border border-line bg-surface p-5">
                <div className="mb-3 grid grid-cols-2 gap-4 sm:grid-cols-3">
                  <Cell
                    label={t("spotPrice")}
                    value={
                      launch.reserveQuote && launch.reserveToken
                        ? formatPricePerToken(launch, launch.reserveQuote, launch.reserveToken)
                        : "—"
                    }
                  />
                  <Cell label={t("openingPrice")} value={formatPricePerToken(launch, launch.priceNum, launch.priceDen)} />
                  <Cell
                    label={t("reserves")}
                    value={
                      launch.reserveQuote && launch.reserveToken
                        ? `${formatQuote(launch, launch.reserveQuote, 4)} / ${formatTokens(launch.reserveToken, 0)}`
                        : "—"
                    }
                  />
                </div>
                <PriceChart token={launch.token} quoteDecimals={quoteDecimals(launch)} refreshKey={tick} />
              </div>
            </div>
          </Section>

          <Section title={launch.kind === "MINT" ? t("mintSection") : t("economics")}>
            {launch.kind === "MINT" ? (
              <MintPanel launch={launch} onChange={() => void refresh()} />
            ) : (
              <EconomyPanel launch={launch} onChange={() => void refresh()} />
            )}
          </Section>

          <Section title={t("rewards")}>
            <RewardsPanel launch={launch} now={now ?? 0} />
          </Section>

          {launch.kind === "MINT" ? (
            <Section title={tm("zones")}>
              <div className="rounded-lg border border-line bg-surface p-5">
                {address && origin ? (
                  <div className="mb-4 flex flex-wrap items-start gap-3 rounded-md border border-line bg-surface-2/60 px-3 py-3 font-mono text-[12px]">
                    <div className="min-w-0 flex-1">
                      <div className="text-fg-muted">{tm("inviteLinkLaunch")}</div>
                      <code className="mt-1 block break-all text-cyan">{`${origin}/launch/view/?token=${launch.token}&ref=${address}`}</code>
                    </div>
                    <InviteLinkButton url={`${origin}/launch/view/?token=${launch.token}&ref=${address}`} />
                  </div>
                ) : null}
                <ZonesPanel token={launch.token} symbol={launch.copy.symbol} />
              </div>
            </Section>
          ) : null}


          {launch.kind === "MINT" ? null : (
            <Section title={t("liquidity")}>
              <div className="rounded-lg border border-line bg-surface p-5">
                <LiquidityPanel launch={launch} onChange={() => void refresh()} />
              </div>
            </Section>
          )}

          <Section title={t("recentTrades")}>
            {swaps.length === 0 ? (
              <p className="text-sm text-fg-muted">{t("noTrades")}</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-line">
                <table className="w-full font-mono text-[12px]">
                  <tbody>
                    {swaps.map((s) => {
                      const url = explorerTx(s.txHash);
                      return (
                        <tr key={`${s.blockNumber}-${s.logIndex}`} className="border-b border-line last:border-0">
                          <td className={s.isBuy ? "px-3 py-2 text-lime" : "px-3 py-2 text-rose"}>{t(s.isBuy ? "buy" : "sell")}</td>
                          <td className="px-3 py-2 text-fg">
                            {s.isBuy ? formatQuote(launch, s.amountIn, 4) : `${formatTokens(s.amountIn)} ${launch.copy.symbol}`}
                          </td>
                          <td className="px-3 py-2 text-fg">
                            {s.isBuy ? `${formatTokens(s.amountOut)} ${launch.copy.symbol}` : formatQuote(launch, s.amountOut, 4)}
                          </td>
                          <td className="px-3 py-2 text-fg-muted">{shortAddress(s.trader)}</td>
                          <td className="px-3 py-2 text-right text-fg-muted">
                            {url ? (
                              <a href={url} target="_blank" rel="noreferrer" className="hover:text-cyan">
                                #{s.blockNumber}
                              </a>
                            ) : (
                              `#${s.blockNumber}`
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </>
      ) : null}
    </>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-medium tracking-[0.14em] text-fg-muted uppercase">{label}</div>
      <div className="mt-1 truncate font-mono text-[13.5px] text-fg">{value}</div>
    </div>
  );
}
