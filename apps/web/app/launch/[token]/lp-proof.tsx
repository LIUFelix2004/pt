"use client";

import { useTranslations } from "next-intl";
import { useReadContract } from "wagmi";
import type { Address } from "viem";
import { portusPoolAbi } from "@portus/shared/browser";

/**
 * LP lock proof read straight from the pool: the Locker holds exactly the
 * genesis shares minted at opening (invariant I-09), which nothing can redeem.
 * Third-party liquidity on top is shown separately. Not taken from the API.
 */
export function LpProof({ pool }: { pool: Address }) {
  const t = useTranslations("launch");
  const { data: locker } = useReadContract({ address: pool, abi: portusPoolAbi, functionName: "locker" });
  const { data: total } = useReadContract({ address: pool, abi: portusPoolAbi, functionName: "lockedShares" });
  const { data: locked } = useReadContract({
    address: pool,
    abi: portusPoolAbi,
    functionName: "sharesOf",
    args: locker ? [locker] : undefined,
    query: { enabled: !!locker },
  });
  if (total === undefined || locked === undefined) return null;
  const ok = total > 0n && locked === total; // locker balance == genesis (locked) shares
  return (
    <p className="text-[13px] leading-relaxed text-fg-muted">
      <span className={ok ? "text-lime" : "text-rose"}>{t("lpLocked")}:</span>{" "}
      {t("lpLockedBody", { shares: locked.toString() })} {ok ? "✓" : `(total ${total.toString()})`}
    </p>
  );
}
