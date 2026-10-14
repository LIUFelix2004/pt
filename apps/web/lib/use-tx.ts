"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { usePublicClient } from "wagmi";
import type { Hex } from "viem";
import { errorKey } from "./errors";

/**
 * Run a sequence of wallet transactions, waiting for each receipt before the
 * next (an approve must be mined before the subscribe that depends on it), and
 * surface contract errors in plain language.
 */
export function useTx(onDone?: () => void) {
  const te = useTranslations("errors");
  const tc = useTranslations("common");
  const publicClient = usePublicClient();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [lastHash, setLastHash] = useState<Hex | null>(null);

  async function run(steps: Array<() => Promise<Hex | null>>) {
    if (!publicClient) return;
    setBusy(true);
    setMessage(null);
    try {
      for (const step of steps) {
        const hash = await step();
        if (!hash) continue;
        setLastHash(hash);
        setMessage(tc("txSent"));
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error(`transaction ${hash} reverted`);
      }
      setMessage(tc("txConfirmed"));
      onDone?.();
    } catch (error) {
      const { key, message: detail } = errorKey(error);
      setMessage(te(key, { message: detail ?? "" }));
    } finally {
      setBusy(false);
    }
  }

  return { run, busy, message, lastHash };
}
