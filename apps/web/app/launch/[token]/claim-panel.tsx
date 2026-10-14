"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useAccount, useWriteContract } from "wagmi";
import type { Address } from "viem";
import { portusSaleAbi } from "@portus/shared/browser";
import { formatQuote, formatTokens, getSubscription, type Launch, type SubscriptionView } from "@/lib/api";
import { useTx } from "@/lib/use-tx";
import { useOnRightChain } from "@/components/portus/wallet-bar";

const BTN =
  "rounded-md bg-cyan px-4 py-2 font-mono text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40";

/** finalize() for anyone once the window closes; claim() afterwards. */
export function ClaimPanel({ launch, onChange }: { launch: Launch; onChange: () => void }) {
  const t = useTranslations("launch");
  const { address } = useAccount();
  const rightChain = useOnRightChain();
  const { writeContractAsync } = useWriteContract();
  const sale = launch.sale as Address;
  const [mine, setMine] = useState<SubscriptionView | null>(null);

  const load = () => {
    if (address) getSubscription(launch.token, address, launch.sale).then(setMine).catch(() => setMine(null));
  };
  const tx = useTx(() => {
    load();
    onChange();
  });
  useEffect(load, [address, launch.token, launch.phase]);

  if (launch.phase === "AWAITING_FINALIZE") {
    return (
      <div className="grid gap-3">
        <p className="text-sm text-fg-muted">{t("finalizePending")}</p>
        <button
          className={BTN}
          disabled={!rightChain || tx.busy}
          onClick={() => void tx.run([() => writeContractAsync({ address: sale, abi: portusSaleAbi, functionName: "finalize" })])}
        >
          {t("finalizeAnyone")}
        </button>
        {tx.message ? <p className="font-mono text-xs break-all text-fg-muted">{tx.message}</p> : null}
      </div>
    );
  }

  if (!address) return <p className="text-sm text-fg-muted">{t("connectToClaim")}</p>;
  const committed = BigInt(mine?.committed ?? "0");
  if (committed === 0n) return <p className="text-sm text-fg-muted">{t("nothingToClaim")}</p>;

  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-4 font-mono text-[12.5px]">
        <div>
          <div className="text-fg-muted">{t("claimTokens")}</div>
          <div className="text-fg">{mine?.claimed ? t("claimed") : formatTokens(mine?.previewTokens ?? "0")}</div>
        </div>
        <div>
          <div className="text-fg-muted">{t("claimRefund")}</div>
          <div className="text-fg">{mine?.claimed ? t("claimed") : formatQuote(launch, mine?.previewRefund ?? "0")}</div>
        </div>
      </div>
      {!mine?.claimed ? (
        <button
          className={BTN}
          disabled={!rightChain || tx.busy}
          onClick={() => void tx.run([() => writeContractAsync({ address: sale, abi: portusSaleAbi, functionName: "claim" })])}
        >
          {t("claim")}
        </button>
      ) : null}
      {tx.message ? <p className="font-mono text-xs break-all text-fg-muted">{tx.message}</p> : null}
    </div>
  );
}
