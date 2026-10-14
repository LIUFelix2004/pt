"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useAccount, useDisconnect, useSwitchChain } from "wagmi";
import { ACTIVE_CHAIN, CHAIN_ID } from "@/lib/chain";
import { shortAddress } from "@/lib/api";
import { ConnectButtons } from "./connect-buttons";

/** Connect / network guard shown above every action panel. */
export function WalletBar() {
  const tc = useTranslations("common");
  // chainId from the account is the wallet's real network (useChainId() is the app's).
  const { address, isConnected, connector, chainId } = useAccount();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  // The server always renders "disconnected"; wagmi reconnects on the client, so
  // show the connected state only after mount to keep hydration consistent.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted || !isConnected) return <ConnectButtons />;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <code className="font-mono text-xs text-cyan" title={address}>
        {connector?.id.startsWith("local-") ? `${connector.name} · ` : ""}
        {shortAddress(address!)}
      </code>
      {chainId !== CHAIN_ID ? (
        <button onClick={() => switchChain({ chainId: CHAIN_ID })} className="font-mono text-xs text-rose underline">
          {tc("switchNetwork", { chain: ACTIVE_CHAIN.name })}
        </button>
      ) : null}
      <button onClick={() => disconnect()} className="font-mono text-xs text-fg-muted hover:text-rose">
        {tc("disconnect")}
      </button>
    </div>
  );
}

export function useOnRightChain(): boolean {
  const { isConnected, chainId } = useAccount();
  return isConnected && chainId === CHAIN_ID;
}
