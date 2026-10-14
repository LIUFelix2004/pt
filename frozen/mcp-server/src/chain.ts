import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import { loadConfig } from "./config.js";
import { signer } from "./signer.js";

function chain() {
  const { deployment, rpcUrl } = loadConfig();
  return defineChain({
    id: deployment.chainId,
    name: deployment.chain.displayName,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
}

export function publicClient() {
  const { rpcUrl } = loadConfig();
  return createPublicClient({ chain: chain(), transport: http(rpcUrl) });
}

/**
 * The signer. Whatever the configured Signer implementation (env key, encrypted
 * keystore, or external hardware-wallet round trip), the account is derived
 * in-process and never transmitted to the launchpad API. The safety check runs
 * inside the signer right before any signature can be produced.
 */
export function walletClient() {
  const { rpcUrl } = loadConfig();
  return createWalletClient({
    account: signer().account,
    chain: chain(),
    transport: http(rpcUrl),
  });
}

export { accountAddress } from "./signer.js";
