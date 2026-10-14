"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useAccount, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { erc20Abi, parseUnits, type Address } from "viem";
import { portusPoolAbi } from "@portus/shared/browser";
import { formatTokens, quoteDecimals, type Launch } from "@/lib/api";
import { CHAIN_INFO } from "@/lib/chain";
import { useTx } from "@/lib/use-tx";
import { useOnRightChain } from "@/components/portus/wallet-bar";

/** Third-party liquidity: add at the current ratio, remove your own shares. */
export function LiquidityPanel({ launch, onChange }: { launch: Launch; onChange: () => void }) {
  const t = useTranslations("launch");
  const { address } = useAccount();
  const rightChain = useOnRightChain();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const pool = launch.pool as Address;
  const [amount, setAmount] = useState("");
  const { data: reserves, refetch: refetchReserves } = useReadContract({ address: pool, abi: portusPoolAbi, functionName: "getReserves" });
  const { data: mine, refetch: refetchMine } = useReadContract({
    address: pool,
    abi: portusPoolAbi,
    functionName: "sharesOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });
  const tx = useTx(() => {
    void refetchReserves();
    void refetchMine();
    setAmount("");
    onChange();
  });

  let quoteIn: bigint | null = null;
  try {
    quoteIn = amount ? parseUnits(amount, quoteDecimals(launch)) : null;
  } catch {
    quoteIn = null;
  }
  const q = reserves ? BigInt(reserves[0]) : 0n;
  const tk = reserves ? BigInt(reserves[1]) : 0n;
  const tokensNeeded = quoteIn && q > 0n ? (quoteIn * tk + q - 1n) / q : 0n;

  async function deadline() {
    if (!publicClient) return 0n;
    if (CHAIN_INFO.isLocal) await publicClient.request({ method: "evm_mine" as never, params: [] as never });
    return (await publicClient.getBlock()).timestamp + 600n;
  }

  async function add() {
    if (!quoteIn || !address) return;
    const qi = quoteIn;
    const need = tokensNeeded;
    await tx.run([
      () => writeContractAsync({ address: launch.quoteAsset as Address, abi: erc20Abi, functionName: "approve", args: [pool, qi] }),
      () => writeContractAsync({ address: launch.token as Address, abi: erc20Abi, functionName: "approve", args: [pool, need] }),
      async () =>
        writeContractAsync({ address: pool, abi: portusPoolAbi, functionName: "addLiquidity", args: [qi, need, 1n, address, await deadline()] }),
    ]);
  }

  async function removeAll() {
    if (!address || !mine) return;
    const sh = mine;
    await tx.run([
      async () => writeContractAsync({ address: pool, abi: portusPoolAbi, functionName: "removeLiquidity", args: [sh, 1n, 1n, address, await deadline()] }),
    ]);
  }

  return (
    <div className="grid gap-3">
      <p className="text-[12px] leading-relaxed text-fg-muted">{t("lpNote")}</p>
      <div className="font-mono text-[12.5px] text-fg">
        {t("yourShares")}: {mine !== undefined ? mine.toString() : "—"}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grow text-[11px] font-medium tracking-[0.12em] text-fg-muted uppercase">
          {launch.quote?.symbol ?? "QUOTE"}
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            className="mt-1.5 w-full rounded-md border border-line bg-bg px-3 py-2 font-mono text-sm text-fg outline-none focus:border-cyan/60"
          />
        </label>
        <button
          disabled={!rightChain || !quoteIn || tx.busy}
          onClick={() => void add()}
          className="rounded-md bg-cyan px-4 py-2 font-mono text-sm font-semibold text-primary-foreground disabled:opacity-40"
        >
          {t("addLiquidity")}
        </button>
        <button
          disabled={!rightChain || !mine || mine === 0n || tx.busy}
          onClick={() => void removeAll()}
          className="rounded-md border border-line px-4 py-2 font-mono text-sm text-fg-muted hover:text-fg disabled:opacity-40"
        >
          {t("removeLiquidity")}
        </button>
      </div>
      {quoteIn ? <p className="font-mono text-[11.5px] text-fg-muted">{t("needTokens", { amount: formatTokens(tokensNeeded) })}</p> : null}
      {tx.message ? <p className="font-mono text-[11px] break-all text-fg-muted">{tx.message}</p> : null}
    </div>
  );
}
