import { createPublicClient, defineChain, encodeAbiParameters, erc20Abi, http, keccak256, type Address } from "viem";
import {
  getChain,
  loadDeployment,
  portusDistributorAbi,
  portusFeeSplitterAbi,
  portusFlywheelAbi,
  portusEmissionAbi,
  portusMintTokenAbi,
  portusPoolAbi,
  portusSaleAbi,
  portusTreasuryAbi,
  readDeploymentFile,
} from "@portus/shared";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export const CHAIN_ID = Number(process.env.CHAIN_ID ?? 31337);
export const CHAIN = getChain(CHAIN_ID);
export const DEPLOYMENT = loadDeployment(process.env);
export const FACTORY = DEPLOYMENT.factory;
const DEPLOYMENT_FILE = readDeploymentFile(REPO_ROOT, CHAIN_ID);
export const START_BLOCK = BigInt(DEPLOYMENT_FILE?.startBlock ?? 0);

/** Platform singletons (env first, then deployments/<chainId>.json). */
function singleton(env: Address | null, file: string | undefined): Address | null {
  if (env) return env;
  return file && /^0x[0-9a-fA-F]{40}$/.test(file) && DEPLOYMENT_FILE?.factory.toLowerCase() === FACTORY.toLowerCase()
    ? (file.toLowerCase() as Address)
    : null;
}
const feeSplitter = singleton(DEPLOYMENT.feeSplitter, DEPLOYMENT_FILE?.feeSplitter);
const distributor = singleton(DEPLOYMENT.distributor, DEPLOYMENT_FILE?.distributor);
const flywheel = singleton(DEPLOYMENT.flywheel, DEPLOYMENT_FILE?.flywheel);
export const SINGLETONS = feeSplitter && distributor && flywheel ? { feeSplitter, distributor, flywheel } : undefined;
if (!SINGLETONS) console.warn("[portus] FeeSplitter / Distributor / Flywheel addresses unknown: economy data will be empty. Run sync-env.");

const RPC_URL = process.env.RPC_URL ?? (CHAIN.isLocal ? "http://127.0.0.1:8545" : "");
if (!RPC_URL) throw new Error(`RPC_URL must be set for ${CHAIN.displayName} (chain ${CHAIN_ID}).`);

const chain = defineChain({
  id: CHAIN_ID,
  name: CHAIN.displayName,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});

export const client = createPublicClient({ chain, transport: http(RPC_URL) });

/**
 * Latest block timestamp observed on chain.
 *
 * Sale phase is a function of `block.timestamp`, never of this server's clock.
 * On a local chain that time-travels the two disagree outright, and on a public
 * chain they drift by seconds — enough to advertise OPEN after the contract has
 * started rejecting subscriptions.
 */
let observedChainTime = 0;

export function chainNowSeconds(): number {
  return observedChainTime || Math.floor(Date.now() / 1000);
}

export async function refreshChainTime(): Promise<number> {
  const block = await client.getBlock();
  const seconds = Number(block.timestamp);
  if (seconds > observedChainTime) observedChainTime = seconds;
  return observedChainTime;
}

export async function readSymbol(asset: Address): Promise<string | null> {
  return client.readContract({ address: asset, abi: erc20Abi, functionName: "symbol" }).catch(() => null);
}

/** ERC-20 balances for many accounts (invite / zone UI). Missing reads become 0. */
export async function readBalances(token: Address, accounts: Address[]): Promise<Map<string, bigint>> {
  const out = new Map<string, bigint>();
  if (accounts.length === 0) return out;
  const chunk = 40;
  for (let i = 0; i < accounts.length; i += chunk) {
    const slice = accounts.slice(i, i + chunk);
    const results = await Promise.all(
      slice.map((account) =>
        client
          .readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [account] })
          .then((v) => [account.toLowerCase(), v as bigint] as const)
          .catch(() => [account.toLowerCase(), 0n] as const),
      ),
    );
    for (const [k, v] of results) out.set(k, v);
  }
  return out;
}

export async function readTokenMeta(token: Address): Promise<{ name: string; symbol: string } | null> {
  const [name, symbol] = await Promise.all([
    client.readContract({ address: token, abi: erc20Abi, functionName: "name" }),
    client.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }),
  ]).catch(() => [null, null] as const);
  return name && symbol ? { name, symbol } : null;
}

/** A subscriber's own position, read live from the sale (authoritative). */
export async function readSubscription(sale: Address, account: Address) {
  const read = <T>(functionName: string, args: unknown[] = []) =>
    client.readContract({ address: sale, abi: portusSaleAbi, functionName: functionName as never, args: args as never }) as Promise<T>;
  const [committed, whitelistCommitted, publicCommitted, claimed, preview] = await Promise.all([
    read<bigint>("committed", [account]),
    read<bigint>("whitelistCommitted", [account]),
    read<bigint>("publicCommitted", [account]),
    read<boolean>("claimed", [account]),
    read<readonly [bigint, bigint]>("previewClaim", [account]),
  ]);
  return {
    committed: committed.toString(),
    whitelistCommitted: whitelistCommitted.toString(),
    publicCommitted: publicCommitted.toString(),
    claimed,
    previewTokens: preview[0].toString(),
    previewRefund: preview[1].toString(),
  };
}

const ZERO = "0x0000000000000000000000000000000000000000";

/** Live economy state of one launch, read from its contracts. */
export async function readEconomics(l: { token: Address; pool: Address; treasury: Address | null; quoteAsset: Address }) {
  const r = <T>(address: Address, abi: any, functionName: string, args: unknown[] = []) =>
    client.readContract({ address, abi, functionName, args } as never) as Promise<T>;
  const treasury = l.treasury ?? ZERO;
  const [treasuryBalance, lastAction, obsTime, lockedShares, totalShares] = await Promise.all([
    l.treasury ? r<bigint>(l.quoteAsset, erc20Abi, "balanceOf", [treasury]) : Promise.resolve(0n),
    l.treasury ? r<bigint>(treasury as Address, portusTreasuryAbi, "lastAction") : Promise.resolve(0n),
    l.treasury ? r<number>(treasury as Address, portusTreasuryAbi, "obsTime") : Promise.resolve(0),
    r<bigint>(l.pool, portusPoolAbi, "lockedShares").catch(() => 0n),
    r<bigint>(l.pool, portusPoolAbi, "totalShares").catch(() => 0n),
  ]);
  let incentiveReleased = 0n;
  let incentiveAvailable = 0n;
  let rewardsAvailable = 0n;
  let shares: readonly [number, number, number, number] = [0, 0, 0, 0];
  if (SINGLETONS) {
    [incentiveReleased, incentiveAvailable, rewardsAvailable, shares] = await Promise.all([
      r<bigint>(SINGLETONS.distributor, portusDistributorAbi, "released", [l.token]),
      r<bigint>(SINGLETONS.distributor, portusDistributorAbi, "available", [l.token, l.token]),
      r<bigint>(SINGLETONS.distributor, portusDistributorAbi, "available", [l.token, l.quoteAsset]),
      r<readonly [number, number, number, number]>(SINGLETONS.feeSplitter, portusFeeSplitterAbi, "shares", [l.token]),
    ]);
  }
  return {
    sharesBps: { ecosystem: shares[0], flywheel: shares[1], creator: shares[2], treasury: shares[3] },
    treasuryBalance: treasuryBalance.toString(),
    treasuryLastAction: Number(lastAction),
    treasuryObservationStarted: Number(obsTime) > 0,
    incentiveReleased: incentiveReleased.toString(),
    incentiveAvailable: incentiveAvailable.toString(),
    rewardsAvailable: rewardsAvailable.toString(),
    lockedShares: lockedShares.toString(),
    totalShares: totalShares.toString(),
  };
}

/** Live mint-mode state: schedule progress and the token pot in the Distributor. */
export async function readMint(l: { token: Address; emission: Address }) {
  const r = <T>(address: Address, abi: any, functionName: string, args: unknown[] = []) =>
    client.readContract({ address, abi, functionName, args } as never) as Promise<T>;
  const [totalMinted, totalSupply, mintable, day, active] = await Promise.all([
    r<bigint>(l.token, portusMintTokenAbi, "totalMinted"),
    r<bigint>(l.token, erc20Abi, "totalSupply"),
    r<bigint>(l.emission, portusEmissionAbi, "mintable"),
    r<bigint>(l.emission, portusEmissionAbi, "currentDay"),
    r<boolean>(l.emission, portusEmissionAbi, "active"),
  ]);
  const [today, tomorrow] = await Promise.all([
    r<bigint>(l.emission, portusEmissionAbi, "targetAtDay", [day]),
    r<bigint>(l.emission, portusEmissionAbi, "targetAtDay", [day + 1n]),
  ]);
  const potAvailable = SINGLETONS
    ? await r<bigint>(SINGLETONS.distributor, portusDistributorAbi, "available", [l.token, l.token])
    : 0n;
  return {
    active,
    day: Number(day),
    totalMinted: totalMinted.toString(),
    totalSupply: totalSupply.toString(),
    burned: (totalMinted - totalSupply).toString(),
    mintable: mintable.toString(),
    nextDayMint: (tomorrow - today).toString(),
    potAvailable: potAvailable.toString(),
  };
}

export async function readOwed(account: Address, assets: Address[]) {
  if (!SINGLETONS) return [];
  return Promise.all(
    assets.map(async (asset) => ({
      asset,
      owed: (
        (await client.readContract({
          address: SINGLETONS!.feeSplitter,
          abi: portusFeeSplitterAbi,
          functionName: "owed",
          args: [asset, account],
        })) as bigint
      ).toString(),
    })),
  );
}

export async function readClaimed(token: Address, asset: Address, epoch: number, account: Address): Promise<boolean> {
  if (!SINGLETONS) return false;
  const key = keccak256(encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint256" }], [token, asset, BigInt(epoch)]));
  return (await client.readContract({
    address: SINGLETONS.distributor,
    abi: portusDistributorAbi,
    functionName: "claimed",
    args: [key, account],
  })) as boolean;
}

export async function readFlywheel(asset: Address) {
  if (!SINGLETONS) return null;
  const [round, ranked] = await Promise.all([
    client.readContract({ address: SINGLETONS.flywheel, abi: portusFlywheelAbi, functionName: "roundOf", args: [asset] }) as Promise<
      readonly [bigint, bigint, boolean, number]
    >,
    client.readContract({ address: SINGLETONS.flywheel, abi: portusFlywheelAbi, functionName: "rankedPools", args: [asset] }) as Promise<
      readonly [readonly Address[], readonly bigint[]]
    >,
  ]);
  const owed = (await client.readContract({
    address: SINGLETONS.feeSplitter,
    abi: portusFeeSplitterAbi,
    functionName: "owed",
    args: [asset, SINGLETONS.flywheel],
  })) as bigint;
  const balance = (await client.readContract({ address: asset, abi: erc20Abi, functionName: "balanceOf", args: [SINGLETONS.flywheel] })) as bigint;
  return {
    round: Number(round[0]),
    start: Number(round[1]),
    active: round[2],
    nominated: ranked[0].map((p, i) => ({ pool: p.toLowerCase(), marketCap: ranked[1][i]!.toString() })),
    budget: (owed + balance).toString(),
  };
}
