"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { zeroAddress, type Address } from "viem";
import { portusDistributorAbi, portusFactoryAbi } from "@portus/shared/browser";
import { FACTORY } from "@/lib/chain";
import { useTx } from "@/lib/use-tx";
import { useOnRightChain } from "@/components/portus/wallet-bar";
import { REF_KEY } from "@/components/portus/ref-capture";
import { shortAddress } from "@/lib/api";

const DISMISS_KEY = "portus-ref-dismiss";

/**
 * Soft guide after connect: if `?ref=` was captured and the wallet has no
 * on-chain referrer yet, offer bindReferrer. Not forced — user can dismiss.
 */
export function BindReferrerPrompt() {
  const t = useTranslations("me");
  const { address, isConnected } = useAccount();
  const rightChain = useOnRightChain();
  const { writeContractAsync } = useWriteContract();
  const [candidate, setCandidate] = useState<Address | null>(null);
  const [open, setOpen] = useState(false);

  const { data: distributor } = useReadContract({
    address: FACTORY,
    abi: portusFactoryAbi,
    functionName: "distributor",
  });
  const { data: referrer, refetch } = useReadContract({
    address: distributor as Address,
    abi: portusDistributorAbi,
    functionName: "referrerOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!distributor },
  });

  const tx = useTx(() => {
    void refetch();
    setOpen(false);
  });

  useEffect(() => {
    if (!isConnected || !address) {
      setOpen(false);
      return;
    }
    try {
      if (sessionStorage.getItem(DISMISS_KEY) === "1") return;
      const stored = localStorage.getItem(REF_KEY);
      if (!stored || !/^0x[0-9a-fA-F]{40}$/.test(stored)) return;
      if (stored.toLowerCase() === address.toLowerCase()) return;
      if (referrer && referrer !== zeroAddress) return;
      // Still loading referrerOf
      if (distributor && referrer === undefined) return;
      setCandidate(stored as Address);
      setOpen(true);
    } catch {
      /* storage unavailable */
    }
  }, [isConnected, address, referrer, distributor]);

  if (!open || !candidate || !address) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-lg border border-line bg-surface p-5 shadow-xl">
        <h3 className="text-sm font-semibold tracking-wide text-fg">{t("bindPromptTitle")}</h3>
        <p className="mt-2 text-[13px] leading-relaxed text-fg-muted">{t("bindPromptBody")}</p>
        <p className="mt-3 font-mono text-[12.5px] text-fg">
          {t("referrerFromLink")}: <span className="text-cyan">{shortAddress(candidate)}</span>
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded border border-cyan/50 px-3 py-1.5 font-mono text-xs text-cyan hover:bg-cyan/10 disabled:opacity-40"
            disabled={!rightChain || tx.busy || !distributor}
            onClick={() =>
              void tx.run([
                () =>
                  writeContractAsync({
                    address: distributor as Address,
                    abi: portusDistributorAbi,
                    functionName: "bindReferrer",
                    args: [candidate],
                  }),
              ])
            }
          >
            {t("bindReferrer")}
          </button>
          <button
            type="button"
            className="rounded border border-line px-3 py-1.5 font-mono text-xs text-fg-muted hover:bg-surface-2"
            onClick={() => {
              try {
                sessionStorage.setItem(DISMISS_KEY, "1");
              } catch {
                /* ignore */
              }
              setOpen(false);
            }}
          >
            {t("bindLater")}
          </button>
        </div>
        {tx.message ? <p className="mt-2 font-mono text-[11px] break-all text-fg-muted">{tx.message}</p> : null}
      </div>
    </div>
  );
}
