import type { Address } from "./types.js";

export interface ChainConfig {
  id: number;
  /** Hardhat network name — must match a key in contracts/hardhat.config.ts. */
  networkName: string;
  displayName: string;
  isLocal: boolean;
  kind: "local" | "l1" | "arbitrum-l2";
  explorerUrl: string | null;
  /**
   * Public RPC published by the chain. Rate-limited and NOT for production;
   * deployments and long-running services set their own RPC_URL.
   */
  publicRpcUrl: string | null;
  /** Approximate seconds per block. */
  blockTime: number;
  faucetUrl: string | null;
  /**
   * Canonical WETH. Null until confirmed from an official source (N9) — never
   * filled in from memory.
   */
  wethAddress: Address | null;
  /** Date after which this network stops receiving client support. */
  endOfLife: string | null;
  /**
   * Mainnet: real funds behind immutable contracts. deploy.ts refuses until an
   * external audit is done (PORTUS_MAINNET_AUDITED=yes).
   */
  requiresAudit: boolean;
}

/**
 * Supported chains.
 *
 * Adding a network is a change to this file plus one entry in
 * contracts/hardhat.config.ts. Nothing else in the codebase hardcodes a chain.
 *
 * Robinhood Chain values: docs.robinhood.com/chain/connecting/ and
 * /chain/add-network-to-wallet/, fetched 2026-10-09; chain ids cross-checked
 * with eth_chainId on the public RPCs (0x1237 = 4663, 0xb626 = 46630). It is an
 * Arbitrum-based L2 with ETH as gas.
 *
 * Ethereum: chain id 1 per chainlist.org (ethereum-lists) and a third-party
 * node. No public RPC is built in; set your provider in .env.
 *
 * Ethereum testnet: Sepolia stopped receiving support on 2026-09-30 but its
 * public RPCs still answer; it is kept for test deployments (re-added
 * 2026-10-10 at the user's request). The successor testnet is still to be
 * confirmed (N8).
 */
export const CHAINS: Readonly<Record<number, ChainConfig>> = Object.freeze({
  31337: {
    id: 31337,
    networkName: "localhost",
    displayName: "Hardhat (local)",
    isLocal: true,
    kind: "local",
    explorerUrl: null,
    publicRpcUrl: "http://127.0.0.1:8545",
    blockTime: 1,
    faucetUrl: null,
    wethAddress: null,
    endOfLife: null,
    requiresAudit: false,
  },
  46630: {
    id: 46630,
    networkName: "robinhood-testnet",
    displayName: "Robinhood Chain Testnet",
    isLocal: false,
    kind: "arbitrum-l2",
    explorerUrl: "https://explorer.testnet.chain.robinhood.com",
    publicRpcUrl: "https://rpc.testnet.chain.robinhood.com",
    blockTime: 1,
    faucetUrl: null, // to be confirmed
    wethAddress: null, // to be confirmed (N9)
    endOfLife: null,
    requiresAudit: false,
  },
  11155111: {
    id: 11155111,
    networkName: "sepolia",
    displayName: "Sepolia",
    isLocal: false,
    kind: "l1",
    explorerUrl: "https://sepolia.etherscan.io",
    publicRpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
    blockTime: 12,
    faucetUrl: null,
    wethAddress: null, // tests use the deployed TestWETH instead
    endOfLife: "2026-09-30",
    requiresAudit: false,
  },
  4663: {
    id: 4663,
    networkName: "robinhood",
    displayName: "Robinhood Chain",
    isLocal: false,
    kind: "arbitrum-l2",
    explorerUrl: "https://robinhoodchain.blockscout.com",
    publicRpcUrl: "https://rpc.mainnet.chain.robinhood.com",
    blockTime: 1,
    faucetUrl: null,
    wethAddress: null, // to be confirmed (N9)
    endOfLife: null,
    requiresAudit: true,
  },
  1: {
    id: 1,
    networkName: "ethereum",
    displayName: "Ethereum",
    isLocal: false,
    kind: "l1",
    explorerUrl: "https://etherscan.io",
    publicRpcUrl: null,
    blockTime: 12,
    faucetUrl: null,
    wethAddress: null, // to be confirmed (N9)
    endOfLife: null,
    requiresAudit: true,
  },
});

export function getChain(chainId: number): ChainConfig {
  const chain = CHAINS[chainId];
  if (!chain) {
    throw new Error(
      `Unsupported CHAIN_ID ${chainId}. Known chains: ` +
        Object.values(CHAINS)
          .map((c) => `${c.id} (${c.displayName})`)
          .join(", ") +
        ". Add new networks in packages/shared/src/chains.ts.",
    );
  }
  return chain;
}

export function explorerAddressUrl(chainId: number, address: string): string | null {
  const { explorerUrl } = getChain(chainId);
  return explorerUrl ? `${explorerUrl}/address/${address}` : null;
}

export function explorerTxUrl(chainId: number, txHash: string): string | null {
  const { explorerUrl } = getChain(chainId);
  return explorerUrl ? `${explorerUrl}/tx/${txHash}` : null;
}

/**
 * Addresses derived from the Hardhat/Anvil default mnemonic
 * ("test test test ... junk"). These keys are published in documentation, so
 * anyone can spend from them the instant they hold value on a public network.
 *
 * Signing with one of these off a local chain is never intentional. See
 * assertKeyIsSafeForChain().
 */
const WELL_KNOWN_DEV_ADDRESSES: ReadonlySet<string> = new Set(
  [
    "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
    "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
    "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc",
    "0x90f79bf6eb2c4f870365e785982e1f101e93b906",
    "0x15d34aaf54267db7d7c367839aaf71a00a2c6a65",
    "0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc",
    "0x976ea74026e726554db657fa54763abd0c3a0aa9",
    "0x14dc79964da2c08b23698b3d3cc7ca32193d9955",
    "0x23618e81e3f5cdf7f54c3d65f7fbc0abf5b21e8f",
    "0xa0ee7a142d267c1f36714e4a8f75612f20a79720",
    "0xbcd4042de499d14e55001ccbb24a551f3b954096",
    "0x71be63f3384f5fb98995898a86b02fb2426c5788",
    "0xfabb0ac9d68b0b445fb7357272ff202c5651694a",
    "0x1cbd3b2770909d4e10f157cabc84c7264073c9ec",
    "0xdf3e18d64bc6a983f673ab319ccae4f1a57c7097",
    "0xcd3b766ccdd6ae721141f452c550ca635964ce71",
    "0x2546bcd3c84621e976d8185a91a922ae77ecec30",
    "0xbda5747bfd65f08deb54cb465eb87d40e51b197e",
    "0xdd2fd4581271e230360230f9337d5c0430bf44c0",
    "0x8626f6940e2eb28930efb4cef49b2d1f2c9c1199",
  ].map((a) => a.toLowerCase()),
);

export function isWellKnownDevAddress(address: Address | string): boolean {
  return WELL_KNOWN_DEV_ADDRESSES.has(address.toLowerCase());
}

/**
 * Hard stop before any signing happens on a public network with a key whose
 * private half is in public documentation.
 *
 * On a testnet the failure mode is losing test ETH; the same mistake carried to
 * mainnet loses real funds. The check is cheap, so it runs unconditionally.
 */
export function assertKeyIsSafeForChain(address: Address | string, chainId: number): void {
  const chain = getChain(chainId);
  if (chain.isLocal) return;
  if (!isWellKnownDevAddress(address)) return;

  throw new Error(
    `REFUSING TO SIGN.\n\n` +
      `  address: ${address}\n` +
      `  network: ${chain.displayName} (chain ${chainId})\n\n` +
      `That key comes from the Hardhat/Anvil default mnemonic. Its private key is\n` +
      `published in documentation, so any balance it holds on a public network is\n` +
      `swept within seconds.\n\n` +
      `Generate a fresh key for this network and set it in your .env:\n` +
      `  npm run newkey\n`,
  );
}
