"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useAccount, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { erc20Abi, parseUnits, type Address } from "viem";
import { minOut, portusPoolAbi, portusTaxPoolAbi, quoteBuy, quoteSell } from "@portus/shared/browser";
import { formatQuote, formatTokens, quoteDecimals, type Launch } from "@/lib/api";
import { useTx } from "@/lib/use-tx";
import { useOnRightChain } from "@/components/portus/wallet-bar";
import { CHAIN_INFO } from "@/lib/chain";
import { cn } from "@/lib/utils";

const SLIPPAGES = [50, 100, 300] as const;
const DEADLINE_SECONDS = 600n;

export function SwapPanel({ launch, onChange }: { launch: Launch; onChange: () => void }) {
  const t = useTranslations("launch");
  const { address } = useAccount();
  const rightChain = useOnRightChain();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const pool = launch.pool as Address;
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState<number>(100);

  // Quotes use live reserves straight from the pool, not the API's index.
  const { data: reserves, refetch } = useReadContract({ address: pool, abi: portusPoolAbi, functionName: "getReserves" });
  const inputToken = (side === "buy" ? launch.quoteAsset : launch.token) as Address;
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: inputToken,
    abi: erc20Abi,
    functionName: "allowance",
    args: address ? [address, pool] : undefined,
    query: { enabled: !!address },
  });
  const tx = useTx(() => {
    void refetch();
    void refetchAllowance();
    setAmount("");
    onChange();
  });

  let base: bigint | null = null;
  try {
    base = amount ? parseUnits(amount, side === "buy" ? quoteDecimals(launch) : 18) : null;
  } catch {
    base = null;
  }

  const q = reserves?.[0] ?? 0n;
  const tk = reserves?.[1] ?? 0n;
  // Mint-mode pools tax in tokens (and levy large sells); ask the pool itself.
  const isMint = launch.kind === "MINT";
  const { data: taxQuote } = useReadContract({
    address: pool,
    abi: portusTaxPoolAbi,
    functionName: side === "buy" ? "quoteBuy" : "quoteSell",
    args: base && base > 0n ? [base] : undefined,
    query: { enabled: isMint && !!base && base > 0n },
  });
  const quote = isMint
    ? taxQuote && base && base > 0n
      ? { out: taxQuote[0], fee: 0n, tax: taxQuote[1] }
      : null
    : base && base > 0n && q > 0n
      ? side === "buy"
        ? (() => {
            const r = quoteBuy(base, q, tk, launch.feeBps);
            return { out: r.tokensOut, fee: r.fee, tax: 0n };
          })()
        : (() => {
            const r = quoteSell(base, q, tk, launch.feeBps);
            return { out: r.quoteOut, fee: r.fee, tax: 0n };
          })()
      : null;
  const min = quote ? minOut(quote.out, slippageBps) : 0n;

  async function trade() {
    if (!base || !quote || quote.out === 0n || !address) return;
    const amt = base;
    if (!publicClient) return;
    // Deadline in chain time, not browser time: they drift, and a local demo
    // may have fast-forwarded the chain. An idle local chain's latest block is
    // stale, so mine one first there.
    if (CHAIN_INFO.isLocal) await publicClient.request({ method: "evm_mine" as never, params: [] as never });
    const deadline = (await publicClient.getBlock()).timestamp + DEADLINE_SECONDS;
    await tx.run([
      async () =>
        (allowance ?? 0n) >= amt
          ? null
          : writeContractAsync({ address: inputToken, abi: erc20Abi, functionName: "approve", args: [pool, amt] }),
      async () =>
        writeContractAsync({
          address: pool,
          abi: portusPoolAbi,
          functionName: side,
          args: [amt, min === 0n ? 1n : min, address, deadline],
        }),
    ]);
  }

  return (
    <div className="grid gap-4">
      <div className="flex gap-2">
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            onClick={() => {
              setSide(s);
              setAmount("");
            }}
            className={cn(
              "rounded-md border px-3 py-1.5 font-mono text-xs",
              side === s ? "border-cyan/60 bg-cyan/10 text-cyan" : "border-line text-fg-muted hover:text-fg",
            )}
          >
            {t(s)}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1.5 font-mono text-[11px] text-fg-muted">
          {t("slippage")}
          {SLIPPAGES.map((s) => (
            <button
              key={s}
              onClick={() => setSlippageBps(s)}
              className={cn("rounded px-1.5 py-0.5", slippageBps === s ? "bg-surface-2 text-fg" : "hover:text-fg")}
            >
              {s / 100}%
            </button>
          ))}
        </div>
      </div>

      <label className="text-[11px] font-medium tracking-[0.12em] text-fg-muted uppercase">
        {t("youPay")} ({side === "buy" ? (launch.quote?.symbol ?? "QUOTE") : launch.copy.symbol})
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          className="mt-1.5 w-full rounded-md border border-line bg-bg px-3 py-2 font-mono text-sm text-fg outline-none focus:border-cyan/60"
        />
      </label>

      {quote ? (
        <div className="grid gap-1 font-mono text-[12.5px]">
          <div className="text-fg">
            {t("youReceive", { min: side === "buy" ? formatTokens(min) : formatQuote(launch, min) })}:{" "}
            {side === "buy" ? formatTokens(quote.out) : formatQuote(launch, quote.out)}
          </div>
          <div className="text-fg-muted">
            {isMint
              ? t("taxLine", { tax: formatTokens(quote.tax), symbol: launch.copy.symbol })
              : t("feeLine", { fee: formatQuote(launch, quote.fee), bps: (launch.feeBps / 100).toString() })}
          </div>
        </div>
      ) : null}

      <button
        disabled={!rightChain || !quote || quote.out === 0n || tx.busy}
        onClick={() => void trade()}
        className="rounded-md bg-cyan px-4 py-2 font-mono text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {t(side)}
      </button>
      {tx.message ? <p className="font-mono text-xs break-all text-fg-muted">{tx.message}</p> : null}
      <p className="text-[12px] leading-relaxed text-fg-muted">
        <span className="text-fg">{t("sandwichRisk")}:</span> {t("frontrunNote")}
      </p>
    </div>
  );
}
