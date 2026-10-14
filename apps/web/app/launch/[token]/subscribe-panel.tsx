"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { erc20Abi, parseUnits, zeroHash, type Address, type Hex } from "viem";
import { portusSaleAbi, verifyWhitelistProof } from "@portus/shared/browser";
import { formatQuote, formatTokens, getSubscription, getWhitelistEntry, quoteDecimals, type Launch, type SubscriptionView } from "@/lib/api";
import { useTx } from "@/lib/use-tx";
import { useOnRightChain } from "@/components/portus/wallet-bar";
import { cn } from "@/lib/utils";

const BTN =
  "rounded-md bg-cyan px-4 py-2 font-mono text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40";

export function SubscribePanel({ launch, now, onChange }: { launch: Launch; now: number; onChange: () => void }) {
  const t = useTranslations("launch");
  const { address } = useAccount();
  const rightChain = useOnRightChain();
  const { writeContractAsync } = useWriteContract();
  const sale = launch.sale as Address;
  const decimals = quoteDecimals(launch);

  const [entry, setEntry] = useState<{ cap: bigint; proof: Hex[] } | null | "invalid">(null);
  const [mine, setMine] = useState<SubscriptionView | null>(null);
  const [amount, setAmount] = useState("");

  // The whitelist root is read from the sale contract itself, never from the API.
  const { data: onchainRoot } = useReadContract({ address: sale, abi: portusSaleAbi, functionName: "merkleRoot" });
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: launch.quoteAsset as Address,
    abi: erc20Abi,
    functionName: "allowance",
    args: address ? [address, sale] : undefined,
    query: { enabled: !!address },
  });

  const refresh = () => {
    if (!address) return;
    getSubscription(launch.token, address, launch.sale).then(setMine).catch(() => setMine(null));
    void refetchAllowance();
    onChange();
  };
  const tx = useTx(refresh);

  useEffect(() => {
    if (!address) return;
    getSubscription(launch.token, address, launch.sale).then(setMine).catch(() => setMine(null));
    if (!onchainRoot || onchainRoot === zeroHash) {
      setEntry(null);
      return;
    }
    getWhitelistEntry(launch.token, address)
      .then((e) => {
        if (!e) return setEntry(null);
        const cap = BigInt(e.cap);
        // Re-verify locally: a proof that does not reproduce the on-chain root is discarded.
        setEntry(verifyWhitelistProof(onchainRoot as Hex, address, cap, e.proof) ? { cap, proof: e.proof } : "invalid");
      })
      .catch(() => setEntry(null));
  }, [address, launch.token, onchainRoot]);

  const hasWhitelist = launch.merkleRoot !== zeroHash;
  const publicOpen = launch.publicOpenAt !== 0 && now >= launch.publicOpenAt;
  const wlUsed = BigInt(mine?.whitelistCommitted ?? "0");
  const pubUsed = BigInt(mine?.publicCommitted ?? "0");
  const wlLeft = entry && entry !== "invalid" ? entry.cap - wlUsed : 0n;
  const pubLeft = launch.publicOpenAt !== 0 ? BigInt(launch.publicCap) - pubUsed : 0n;
  const viaWhitelist = wlLeft > 0n;

  let base: bigint | null = null;
  try {
    base = amount ? parseUnits(amount, decimals) : null;
  } catch {
    base = null;
  }
  const limit = viaWhitelist ? wlLeft : publicOpen ? pubLeft : 0n;
  const valid = base !== null && base > 0n && base <= limit;

  async function subscribe() {
    if (!valid || base === null) return;
    const amt = base;
    await tx.run([
      async () =>
        (allowance ?? 0n) >= amt
          ? null
          : writeContractAsync({ address: launch.quoteAsset as Address, abi: erc20Abi, functionName: "approve", args: [sale, amt] }),
      async () =>
        viaWhitelist && entry && entry !== "invalid"
          ? writeContractAsync({ address: sale, abi: portusSaleAbi, functionName: "subscribe", args: [amt, entry.cap, entry.proof] })
          : writeContractAsync({ address: sale, abi: portusSaleAbi, functionName: "subscribePublic", args: [amt] }),
    ]);
    setAmount("");
  }

  return (
    <div className="grid gap-4">
      {address ? (
        <div className="grid grid-cols-2 gap-4 font-mono text-[12.5px] sm:grid-cols-3">
          {hasWhitelist ? (
            <div>
              <div className="text-fg-muted">{t("yourCap")}</div>
              <div className="text-fg">{entry && entry !== "invalid" ? formatQuote(launch, entry.cap) : "—"}</div>
            </div>
          ) : null}
          <div>
            <div className="text-fg-muted">{t("yourCommitted")}</div>
            <div className="text-fg">{formatQuote(launch, mine?.committed ?? "0")}</div>
          </div>
          <div>
            <div className="text-fg-muted">{t("remaining")}</div>
            <div className="text-fg">{formatQuote(launch, limit > 0n ? limit : 0n)}</div>
          </div>
        </div>
      ) : null}

      {address && hasWhitelist && entry === null && launch.whitelistUploaded === 0 ? (
        <p className="text-[13px] text-fg-muted">{t("whitelistNotUploaded")}</p>
      ) : null}
      {address && hasWhitelist && entry === null && (launch.whitelistUploaded ?? 0) > 0 ? (
        <p className="text-[13px] text-fg-muted">{t("notWhitelisted")}</p>
      ) : null}
      {entry === "invalid" ? <p className="text-[13px] text-rose">{t("proofInvalid")}</p> : null}
      {launch.publicOpenAt !== 0 && !publicOpen ? (
        <p className="text-[13px] text-fg-muted">
          {t("publicOpensAt")}: {new Date(launch.publicOpenAt * 1000).toISOString().replace("T", " ").slice(0, 16)}Z
        </p>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <label className="grow text-[11px] font-medium tracking-[0.12em] text-fg-muted uppercase">
          {t("amount")} ({launch.quote?.symbol ?? "QUOTE"})
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            className="mt-1.5 w-full rounded-md border border-line bg-bg px-3 py-2 font-mono text-sm text-fg outline-none focus:border-cyan/60"
          />
        </label>
        <button disabled={!valid || !rightChain || tx.busy} onClick={() => void subscribe()} className={cn(BTN)}>
          {viaWhitelist ? t("subscribeViaWhitelist") : t("subscribeViaPublic")}
        </button>
      </div>
      <p className="text-[12px] leading-relaxed text-fg-muted">{t("noWithdrawNote")}</p>
      {tx.message ? <p className="font-mono text-xs break-all text-fg-muted">{tx.message}</p> : null}

      {mine?.scenarios ? (
        <div className="rounded-md border border-line bg-surface-2/60 p-3">
          <div className="text-[11px] font-medium tracking-[0.12em] text-fg-muted uppercase">{t("previewOutcome")}</div>
          <ul className="mt-2 grid gap-1 font-mono text-[12px] text-fg">
            {(["FILLED", "SHRUNK", "REFUNDED"] as const)
              .filter((o) => o !== "SHRUNK" || launch.underRule === "SHRINK")
              .map((o) => (
                <li key={o}>
                  <span className="text-fg-muted">
                    {t(o === "FILLED" ? "outcomeFilled" : o === "SHRUNK" ? "outcomeShrunk" : "outcomeRefunded")}:
                  </span>{" "}
                  {t("youGet", {
                    tokens: formatTokens(mine.scenarios![o].tokens),
                    refund: formatQuote(launch, mine.scenarios![o].refund),
                  })}
                </li>
              ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
