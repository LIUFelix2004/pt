import { defineChain } from "viem";
import { hardhat, mainnet, sepolia } from "wagmi/chains";
import { getChain } from "@portus/shared/browser";

export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337);
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL;
export const FACTORY = (process.env.NEXT_PUBLIC_PORTUS_FACTORY_ADDRESS ?? "") as `0x${string}`;
export const DOCS_URL = process.env.NEXT_PUBLIC_DOCS_URL || null;
/** No factory configured: contracts are not deployed on a public network yet. */
export const IS_DEMO = !FACTORY;
export const IS_STATIC = process.env.NEXT_PUBLIC_STATIC_EXPORT === "1";
export const CHAIN_INFO = getChain(CHAIN_ID);

/** Robinhood Chain (Arbitrum-based L2, ETH gas). Values: packages/shared/src/chains.ts. */
export const robinhoodTestnet = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Explorer", url: "https://explorer.testnet.chain.robinhood.com" } },
  testnet: true,
});

export const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" } },
});

export const SUPPORTED = { 31337: hardhat, 46630: robinhoodTestnet, 4663: robinhood, 11155111: sepolia, 1: mainnet } as const;
export const ACTIVE_CHAIN = SUPPORTED[CHAIN_ID as keyof typeof SUPPORTED] ?? hardhat;

export function explorerAddress(address: string): string | null {
  return CHAIN_INFO.explorerUrl ? `${CHAIN_INFO.explorerUrl}/address/${address}` : null;
}

export function explorerTx(hash: string): string | null {
  return CHAIN_INFO.explorerUrl ? `${CHAIN_INFO.explorerUrl}/tx/${hash}` : null;
}
