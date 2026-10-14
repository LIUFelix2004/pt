import type { HardhatUserConfig } from "hardhat/config";
import hardhatToolboxViem from "@nomicfoundation/hardhat-toolbox-viem";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Hardhat does not read .env on its own, and we deliberately avoid a dotenv
// dependency. Parse the repo-root .env here so `npx hardhat` and the npm
// scripts see the same configuration.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = resolve(ROOT, ".env");
if (existsSync(ENV_PATH)) {
  for (const line of readFileSync(ENV_PATH, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match?.[1] && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2]!.trim();
    }
  }
}

/** Only pass a key to Hardhat when it looks like one, so `compile` works without secrets. */
function deployerAccounts(): string[] {
  const raw = process.env.DEPLOYER_PRIVATE_KEY?.trim();
  // Accept keys pasted with or without the 0x prefix.
  const key = raw && /^[0-9a-fA-F]{64}$/.test(raw) ? `0x${raw}` : raw;
  return key && /^0x[0-9a-fA-F]{64}$/.test(key) ? [key] : [];
}

const config: HardhatUserConfig = {
  plugins: [hardhatToolboxViem],
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    localhost: {
      type: "http",
      url: "http://127.0.0.1:8545",
    },
    // Robinhood Chain is Arbitrum-based (not OP Stack), so chainType stays
    // "generic". Its public RPCs are rate-limited and not meant for production
    // — set ROBINHOOD_*_RPC_URL to your own provider. See packages/shared/src/chains.ts.
    "robinhood-testnet": {
      type: "http",
      chainType: "generic",
      url: process.env.ROBINHOOD_TESTNET_RPC_URL ?? "https://rpc.testnet.chain.robinhood.com",
      accounts: deployerAccounts(),
    },
    sepolia: {
      type: "http",
      chainType: "l1",
      url: process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com",
      accounts: deployerAccounts(),
    },
    robinhood: {
      type: "http",
      chainType: "generic",
      url: process.env.ROBINHOOD_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com",
      accounts: deployerAccounts(),
    },
    // No built-in public RPC for mainnet: bring your own provider.
    ethereum: {
      type: "http",
      chainType: "l1",
      url: process.env.ETHEREUM_RPC_URL ?? "http://127.0.0.1:0/set-ETHEREUM_RPC_URL",
      accounts: deployerAccounts(),
    },
  },
  verify: {
    // Ethereum verifies on Etherscan (V2 API, one key for all chains) with
    // Sourcify as a keyless fallback. Robinhood Chain's explorers are Blockscout;
    // whether Hardhat 3's verify plugin can target them without extra config is
    // still to be confirmed (N10) — until then verify there through Sourcify or
    // the explorer UI.
    etherscan: {
      apiKey: process.env.ETHERSCAN_API_KEY ?? "",
      enabled: Boolean(process.env.ETHERSCAN_API_KEY),
    },
    sourcify: { enabled: true },
  },
};

export default config;
