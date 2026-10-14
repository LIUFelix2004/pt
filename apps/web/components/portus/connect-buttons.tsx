"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useConnect } from "wagmi";
import { CHAIN_INFO } from "@/lib/chain";
import { LOCAL_ACCOUNTS } from "@/lib/local-wallet";
import { shortAddress } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Connect options. On the local chain this lists the unlocked Hardhat demo
 * accounts; a browser wallet is offered whenever one is installed.
 */
export function ConnectButtons({ className }: { className?: string }) {
  const t = useTranslations("devTools");
  const tc = useTranslations("common");
  const { connect, connectors } = useConnect();
  const [hasInjected, setHasInjected] = useState(false);
  useEffect(() => setHasInjected(typeof window !== "undefined" && "ethereum" in window), []);

  const injectedConnector = connectors.find((c) => c.id === "injected");
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {hasInjected && injectedConnector ? (
        <button
          onClick={() => connect({ connector: injectedConnector })}
          className="glow-cyan rounded-md bg-cyan px-4 py-2 font-mono text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          {tc("connectWallet")}
        </button>
      ) : null}
      {CHAIN_INFO.isLocal ? (
        <>
          <span className="font-mono text-[11px] text-fg-muted">{t("localWallets")}</span>
          {LOCAL_ACCOUNTS.map(({ index, address }) => {
            const c = connectors.find((x) => x.id === `local-${index}`);
            if (!c) return null;
            return (
              <button
                key={index}
                onClick={() => connect({ connector: c })}
                title={address}
                className="rounded-md border border-cyan/50 px-2.5 py-1.5 font-mono text-xs text-cyan transition-colors hover:bg-cyan/10"
              >
                #{index} {shortAddress(address)}
              </button>
            );
          })}
        </>
      ) : null}
    </div>
  );
}
