"use client";

import { useTranslations } from "next-intl";
import { useWriteContract } from "wagmi";
import { maxUint256, type Address } from "viem";
import { portusTreasuryAbi } from "@portus/shared/browser";
import { formatQuote, formatTokens, type Launch } from "@/lib/api";
import { useTx } from "@/lib/use-tx";
import { useOnRightChain } from "@/components/portus/wallet-bar";

const BTN =
  "rounded-md border border-cyan/50 px-3 py-1.5 font-mono text-xs text-cyan transition-colors hover:bg-cyan/10 disabled:cursor-not-allowed disabled:opacity-40";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-1.5 font-mono text-[12.5px] last:border-0">
      <span className="text-fg-muted">{label}</span>
      <span className="text-right text-fg">{value}</span>
    </div>
  );
}

/** Four-way split, treasury, incentive pool and flywheel figures for one launch. */
export function EconomyPanel({ launch, onChange }: { launch: Launch; onChange: () => void }) {
  const t = useTranslations("launch");
  const tc = useTranslations("create");
  const rightChain = useOnRightChain();
  const { writeContractAsync } = useWriteContract();
  const tx = useTx(onChange);
  const e = launch.economics;
  if (!e) return null;
  const live = e.live;
  const treasury = e.treasury as Address | null;
  const shares = live?.sharesBps;
  const pct = (bps: number | undefined) => (bps === undefined ? "—" : `${bps / 100}%`);

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="rounded-lg border border-line bg-surface p-4">
        <div className="mb-2 text-[11px] font-medium tracking-[0.12em] text-fg-muted uppercase">{t("feeSplit")}</div>
        <Row label={tc("splitEcosystem")} value={`${pct(shares?.ecosystem)} · ${formatQuote(launch, e.feesSplit.ecosystem, 6)}`} />
        <Row label={tc("splitFlywheel")} value={`${pct(shares?.flywheel)} · ${formatQuote(launch, e.feesSplit.flywheel, 6)}`} />
        <Row label={tc("splitCreator")} value={`${pct(shares?.creator)} · ${formatQuote(launch, e.feesSplit.creator, 6)}`} />
        <Row label={tc("splitTreasury")} value={`${pct(shares?.treasury)} · ${formatQuote(launch, e.feesSplit.treasury, 6)}`} />
      </div>

      <div className="rounded-lg border border-line bg-surface p-4">
        <div className="mb-2 text-[11px] font-medium tracking-[0.12em] text-fg-muted uppercase">{t("treasury")}</div>
        <Row label={t("treasuryRule")} value={e.treasuryMode === "BUYBACK" ? t("treasuryModeBuyback") : t("treasuryModeRewards")} />
        <Row label={t("treasuryBalance")} value={live ? formatQuote(launch, live.treasuryBalance, 6) : "—"} />
        {e.treasuryMode === "BUYBACK" ? (
          <Row label={t("buybackTotal")} value={`${formatQuote(launch, e.buyback.quoteSpent, 6)} → 🔥 ${formatTokens(e.buyback.tokensBurned, 0)}`} />
        ) : (
          <Row label={t("rewardsFunded")} value={formatQuote(launch, e.rewardsFunded, 6)} />
        )}
        {treasury ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {e.treasuryMode === "BUYBACK" && live && !live.treasuryObservationStarted ? (
              <button
                className={BTN}
                disabled={!rightChain || tx.busy}
                onClick={() => void tx.run([() => writeContractAsync({ address: treasury, abi: portusTreasuryAbi, functionName: "startObservation" })])}
              >
                {t("startObservation")}
              </button>
            ) : null}
            {e.treasuryMode === "BUYBACK" ? (
              <button
                className={BTN}
                disabled={!rightChain || tx.busy || !live?.treasuryObservationStarted}
                onClick={() =>
                  void tx.run([
                    () => writeContractAsync({ address: treasury, abi: portusTreasuryAbi, functionName: "executeBuyback", args: [maxUint256, 0n] }),
                  ])
                }
              >
                {t("executeBuyback")}
              </button>
            ) : (
              <button
                className={BTN}
                disabled={!rightChain || tx.busy}
                onClick={() => void tx.run([() => writeContractAsync({ address: treasury, abi: portusTreasuryAbi, functionName: "fundRewards" })])}
              >
                {t("fundRewards")}
              </button>
            )}
          </div>
        ) : null}
        <p className="mt-2 text-[11.5px] leading-relaxed text-fg-muted">{t("treasuryActionsNote")}</p>
        {tx.message ? <p className="mt-1 font-mono text-[11px] break-all text-fg-muted">{tx.message}</p> : null}
      </div>

      <div className="rounded-lg border border-line bg-surface p-4">
        <div className="mb-2 text-[11px] font-medium tracking-[0.12em] text-fg-muted uppercase">{t("incentivePool")}</div>
        <Row
          label={t("releaseSchedule")}
          value={
            launch.incentiveBps === 0
              ? "—"
              : e.releaseMode === "LINEAR"
                ? t("releaseLinear", { rate: (e.releaseRateBps / 100).toString() })
                : t("releaseDecaying", { rate: (e.releaseRateBps / 100).toString() })
          }
        />
        <Row label={t("released")} value={live ? `${formatTokens(live.incentiveReleased, 0)} / ${formatTokens(launch.qInc, 0)}` : "—"} />
        <Row label={t("unallocated")} value={live ? formatTokens(live.incentiveAvailable, 0) : "—"} />
        <Row label={t("epochs")} value={String(e.epochs.length)} />
        <Row label={t("flywheelBought")} value={`${formatQuote(launch, e.flywheel.quoteSpent, 6)} → 🔥 ${formatTokens(e.flywheel.tokensBurned, 0)}`} />
      </div>
    </div>
  );
}
