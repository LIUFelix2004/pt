"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import type { Address } from "viem";
import { portusFactoryAbi, portusDistributorAbi, verifyRewardProof } from "@portus/shared/browser";
import { formatQuote, formatTokens, getRewards, when, type Launch, type RewardEntry } from "@/lib/api";
import { FACTORY } from "@/lib/chain";
import { useTx } from "@/lib/use-tx";
import { useOnRightChain } from "@/components/portus/wallet-bar";

/** Radar incentive and treasury reward epochs paying the connected account. */
export function RewardsPanel({ launch, now }: { launch: Launch; now: number }) {
  const t = useTranslations("launch");
  const { address } = useAccount();
  const rightChain = useOnRightChain();
  const { writeContractAsync } = useWriteContract();
  const [rewards, setRewards] = useState<RewardEntry[] | null>(null);
  const { data: distributor } = useReadContract({ address: FACTORY, abi: portusFactoryAbi, functionName: "distributor" });
  const load = () => {
    if (address) getRewards(launch.token, address).then((r) => setRewards(r.rewards)).catch(() => setRewards([]));
  };
  const tx = useTx(load);
  useEffect(load, [address, launch.token]);

  if (!address) return null;
  if (!rewards || rewards.length === 0) return <p className="text-sm text-fg-muted">{t("rewardsEmpty")}</p>;

  const epochRoot = (asset: string, epoch: number) =>
    launch.economics?.epochs.find((e) => e.asset === asset.toLowerCase() && e.epoch === epoch)?.root as `0x${string}` | undefined;

  const amt = (r: RewardEntry, key: string) => {
    const v = r.components?.[key];
    if (!v || v === "0") return null;
    const isToken = r.asset.toLowerCase() === launch.token.toLowerCase();
    return isToken ? `${formatTokens(v)} ${launch.copy.symbol}` : formatQuote(launch, v, 6);
  };

  return (
    <div className="grid gap-3">
      <p className="text-[12.5px] leading-relaxed text-fg-muted">{t("rewardsHint")}</p>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full font-mono text-[12px]">
          <tbody>
            {rewards.map((r) => {
              const isToken = r.asset.toLowerCase() === launch.token.toLowerCase();
              const root = epochRoot(r.asset, r.epoch);
              const verified = root
                ? verifyRewardProof(root, address, launch.token as Address, r.asset, r.epoch, BigInt(r.amount), r.proof)
                : false;
              const open = now >= r.claimableAt;
              const staticAmt = amt(r, "static");
              const dynamicAmt = amt(r, "dynamic");
              return (
                <tr key={`${r.asset}-${r.epoch}`} className="border-b border-line last:border-0">
                  <td className="px-3 py-2 text-fg-muted">
                    {r.kind === "mint" ? t("kindMint") : r.kind === "incentive" ? t("kindIncentive") : t("kindTreasury")}
                  </td>
                  <td className="px-3 py-2 text-fg">{t("epoch", { epoch: r.epoch })}</td>
                  <td className="px-3 py-2 text-fg">
                    <div>{isToken ? `${formatTokens(r.amount)} ${launch.copy.symbol}` : formatQuote(launch, r.amount, 6)}</div>
                    {staticAmt || dynamicAmt ? (
                      <div className="mt-0.5 text-[11px] text-fg-muted">
                        {staticAmt ? <span>{t("rewardStatic")}: {staticAmt}</span> : null}
                        {staticAmt && dynamicAmt ? <span> · </span> : null}
                        {dynamicAmt ? <span>{t("rewardDynamic")}: {dynamicAmt}</span> : null}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-fg-muted">{open ? "" : `${t("challengePending")} · ${when(r.claimableAt)}`}</td>
                  <td className="px-3 py-2 text-right">
                    {r.claimed ? (
                      <span className="text-lime">{t("rewardClaimed")}</span>
                    ) : (
                      <button
                        disabled={!rightChain || tx.busy || !open || !verified || !distributor}
                        onClick={() =>
                          void tx.run([
                            () =>
                              writeContractAsync({
                                address: distributor as Address,
                                abi: portusDistributorAbi,
                                functionName: "claim",
                                args: [launch.token as Address, r.asset, BigInt(r.epoch), BigInt(r.amount), r.proof],
                              }),
                          ])
                        }
                        className="rounded border border-cyan/50 px-2 py-1 text-cyan hover:bg-cyan/10 disabled:opacity-40"
                      >
                        {t("claimReward")}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {tx.message ? <p className="px-3 py-2 font-mono text-[11px] break-all text-fg-muted">{tx.message}</p> : null}
      </div>
    </div>
  );
}
