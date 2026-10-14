"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, createConfig, http, type Transport } from "wagmi";
import type { Chain } from "viem";
import { injected } from "wagmi/connectors";
import { useState } from "react";
import { ACTIVE_CHAIN, CHAIN_INFO, RPC_URL } from "@/lib/chain";
import { localWalletConnectors } from "@/lib/local-wallet";

// One chain per deployment, chosen by NEXT_PUBLIC_CHAIN_ID: hardhat, Robinhood
// Chain Testnet, Robinhood Chain or Ethereum (see lib/chain.ts).
// Typed as a single generic Chain: ACTIVE_CHAIN is a union of four literals,
// and a computed key over that union would demand a transport for all four.
const chains: [Chain] = [ACTIVE_CHAIN];
const transports: Record<number, Transport> = { [ACTIVE_CHAIN.id]: http(RPC_URL) };
// Unlocked Hardhat test wallets are registered on the local chain only.
const connectors = CHAIN_INFO.isLocal ? [injected(), ...localWalletConnectors()] : [injected()];
const config = createConfig({ chains, connectors, transports });

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
