"use client";

import { useTranslations } from "next-intl";
import { useWriteContract } from "wagmi";
import type { Address } from "viem";
import { mintScheduleSummary, portusEmissionAbi } from "@portus/shared/browser";
import { formatTokens, shortAddress, type Launch } from "@/lib/api";
import { useTx } from "@/lib/use-tx";
import { useOnRightChain } from "@/components/portus/wallet-bar";

const pct = (bps: number) => `${bps / 100}%`;

/** Mint-mode launch: schedule progress, daily mint, distribution split and the trading tax. */
export function MintPanel({ launch, onChange }: { launch: Launch; onChange: () => void }) {
  const t = useTranslations("launch");
  const rightChain = useOnRightChain();
  const { writeContractAsync } = useWriteContract();
  const tx = useTx(onChange);
  const m = launch.mint;
  if (!m) return null;

  const initial = BigInt(m.initialSupply);
  const max = BigInt(m.maxSupply);
  const summary = mintScheduleSummary(initial, max, m.schedule);
  const live = m.live;
  const minted = live ? BigInt(live.totalMinted) : initial;
  const progress = max > 0n ? Number((minted * 10_000n) / max) / 100 : 0;
  const sym = launch.copy.symbol;
  const tax = m.tax;

  return (
    <div className="grid gap-4">
      <div className="rounded-lg border border-line bg-surface p-5">
        <div className="text-[10px] font-medium tracking-[0.14em] text-fg-muted uppercase">{t("mintProgress")}</div>
        <div className="mt-2 font-mono text-sm text-fg">
          {formatTokens(minted, 0)} / {formatTokens(max, 0)} {sym} · {progress.toFixed(2)}%
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded bg-surface-2">
          <div className="h-full bg-cyan" style={{ width: `${Math.min(100, progress)}%` }} />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 font-mono text-[12.5px] sm:grid-cols-4">
          <Cell label={t("mintDay")} value={live ? String(live.day) : "—"} />
          <Cell label={t("mintMintable")} value={live ? `${formatTokens(live.mintable, 0)}` : "—"} />
          <Cell label={t("mintNextDay")} value={live ? `${formatTokens(live.nextDayMint, 0)}` : "—"} />
          <Cell label={t("mintPot")} value={live ? `${formatTokens(live.potAvailable, 0)}` : "—"} />
          <Cell label={t("mintCirculating")} value={live ? formatTokens(live.totalSupply, 0) : "—"} />
          <Cell label={t("mintBurnedTotal")} value={live ? formatTokens(live.burned, 0) : "—"} />
          <Cell label={t("mintStaticShare")} value={pct(m.staticBps)} />
          <Cell label={t("mintDynamicShare")} value={pct(10_000 - m.staticBps)} />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            disabled={!rightChain || tx.busy || !live || !live.active || BigInt(live.mintable) === 0n}
            onClick={() =>
              void tx.run([
                () => writeContractAsync({ address: m.emission as Address, abi: portusEmissionAbi, functionName: "mintDaily" }),
              ])
            }
            className="rounded-md border border-cyan/50 px-3 py-1.5 font-mono text-xs text-cyan hover:bg-cyan/10 disabled:opacity-40"
          >
            {t("mintDailyButton")}
          </button>
          <span className="text-[12px] text-fg-muted">{t("mintDailyHint")}</span>
        </div>
        {tx.message ? <p className="mt-2 font-mono text-xs break-all text-fg-muted">{tx.message}</p> : null}
      </div>

      <div className="rounded-lg border border-line bg-surface p-5">
        <div className="text-[10px] font-medium tracking-[0.14em] text-fg-muted uppercase">{t("mintSchedule")}</div>
        <table className="mt-2 w-full font-mono text-[12.5px]">
          <tbody>
            {summary.phases.map((p, i) => (
              <tr key={i} className="border-b border-line last:border-0">
                <td className="py-1.5 text-fg-muted">{t("mintPhaseRow", { n: i + 1 })}</td>
                <td className="py-1.5 text-fg">{t("mintPhaseMonths", { months: p.months })}</td>
                <td className="py-1.5 text-fg">{t("mintPhaseGrowth", { growth: pct(p.growthBps) })}</td>
                <td className="py-1.5 text-right text-fg-muted">{formatTokens(p.endSupply, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-[12px] text-fg-muted">
          {summary.capMonth !== null ? t("mintCapMonth", { month: summary.capMonth }) : t("mintCapNone")}
        </p>
      </div>

      {tax ? (
        <div className="rounded-lg border border-line bg-surface p-5">
          <div className="text-[10px] font-medium tracking-[0.14em] text-fg-muted uppercase">{t("mintTax")}</div>
          <div className="mt-2 grid gap-1 font-mono text-[12.5px] text-fg">
            <div>
              {t("mintTaxBuy", { burn: pct(tax.buyBurnBps), community: pct(tax.buyCommunityBps), other: pct(tax.buyFoundationBps) })}
            </div>
            <div>{t("mintTaxSell", { burn: pct(tax.sellBurnBps), community: pct(tax.sellCommunityBps), other: pct(tax.sellTechBps) })}</div>
            <div className="text-fg-muted">
              {tax.dumpThresholdBps > 0
                ? t("mintTaxDump", { threshold: pct(tax.dumpThresholdBps), burn: pct(tax.dumpBurnShareBps) })
                : t("mintTaxDumpOff")}
            </div>
            <div className="text-fg-muted">
              {t("mintTaxTotals", { burned: formatTokens(m.taxBurned, 0), paid: formatTokens(m.taxPaid, 0), symbol: sym })}
            </div>
          </div>
          <div className="mt-3 grid gap-1 font-mono text-[11.5px] text-fg-muted sm:grid-cols-2">
            <span>
              {t("mintAddrCommunity")}: {shortAddress(tax.community)}
            </span>
            <span>
              {t("mintAddrFoundation")}: {shortAddress(tax.foundation)}
            </span>
            <span>
              {t("mintAddrTech")}: {shortAddress(tax.tech)}
            </span>
            <span>
              {t("mintAddrMarket")}: {shortAddress(tax.market)}
            </span>
          </div>
        </div>
      ) : null}

      <p className="rounded-md border border-line bg-surface-2/60 px-3 py-2 text-[12.5px] leading-relaxed text-fg-muted">
        {t("mintRewardsRule")}
      </p>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-medium tracking-[0.14em] text-fg-muted uppercase">{label}</div>
      <div className="mt-1 truncate text-fg">{value}</div>
    </div>
  );
}
