import type { network } from "hardhat";
import { parseEther, zeroAddress, zeroHash, type Address, type Hex } from "viem";
import { alignRaiseTarget, DEFAULT_DURATION_SECONDS, DEFAULT_RELEASE_RATE_BPS } from "@portus/shared";

type Viem = Awaited<ReturnType<typeof network.create>>["viem"];

export interface LaunchSpec {
  name: string;
  symbol: string;
  quoteAsset: Address;
  /** Base units; snapped to the factory's granularity rule. */
  raiseTarget: bigint;
  feeBps?: number;
  creatorShareBps?: number;
  incentiveBps?: number;
  /** Seconds from the current chain time. */
  startIn?: number;
  durationSeconds?: number;
  merkleRoot?: Hex;
  /** Seconds after start; null = no public phase. Defaults to "public from the start" when there is no whitelist. */
  publicOpensAfter?: number | null;
  publicCap?: bigint;
  underRule?: "REFUND" | "SHRINK";
  minFillBps?: number;
  treasuryMode?: number;
  metadataHash?: Hex;
  creatorRecipient?: Address;
  releaseMode?: "LINEAR" | "DECAYING";
  /** Daily release rate in bps (10–100); ignored when incentiveBps is 0. */
  releaseRateBps?: number;
}

export interface CreatedLaunch {
  launchId: bigint;
  token: Address;
  sale: Address;
  pool: Address;
  treasury: Address;
  startTime: bigint;
  endTime: bigint;
  hash: Hex;
}

/**
 * Build LaunchParams anchored to chain time (never wall-clock: block timestamps
 * drift, and a window that starts "now" is already past when it is mined).
 */
export async function buildParams(viem: Viem, spec: LaunchSpec) {
  const publicClient = await viem.getPublicClient();
  // An idle local chain's latest block can be stale, and its clock may run
  // ahead of wall time after a fast-forward: mine one block to read the real
  // "now". On public chains blocks are frequent, so take the later of the two.
  const chainId = await publicClient.getChainId();
  if (chainId === 31337) await publicClient.request({ method: "evm_mine" as never, params: [] as never });
  const latest = (await publicClient.getBlock()).timestamp;
  const wall = BigInt(Math.floor(Date.now() / 1000));
  const now = latest > wall ? latest : wall;
  const startTime = now + BigInt(spec.startIn ?? 30);
  const incentiveBps = spec.incentiveBps ?? 3000;
  const merkleRoot = spec.merkleRoot ?? zeroHash;
  const hasWhitelist = merkleRoot !== zeroHash;
  const publicOpensAfter = spec.publicOpensAfter === undefined ? (hasWhitelist ? null : 0) : spec.publicOpensAfter;
  return {
    name: spec.name,
    symbol: spec.symbol,
    quoteAsset: spec.quoteAsset,
    raiseTarget: alignRaiseTarget(spec.raiseTarget, incentiveBps),
    feeBps: spec.feeBps ?? 100,
    creatorShareBps: spec.creatorShareBps ?? 0,
    incentiveBps,
    startTime,
    duration: BigInt(spec.durationSeconds ?? DEFAULT_DURATION_SECONDS),
    merkleRoot,
    publicOpenAt: publicOpensAfter === null ? 0n : startTime + BigInt(publicOpensAfter),
    publicCap: publicOpensAfter === null ? 0n : (spec.publicCap ?? 0n),
    underRule: spec.underRule === "SHRINK" ? 1 : 0,
    minFillBps: spec.minFillBps ?? 0,
    treasuryMode: spec.treasuryMode ?? 0,
    metadataHash: spec.metadataHash ?? zeroHash,
    creatorRecipient: spec.creatorRecipient ?? zeroAddress,
    releaseMode: spec.releaseMode === "DECAYING" ? 1 : 0,
    releaseRateBps: incentiveBps > 0 ? (spec.releaseRateBps ?? DEFAULT_RELEASE_RATE_BPS) : 0,
  };
}

export async function createLaunch(viem: Viem, factoryAddress: Address, spec: LaunchSpec): Promise<CreatedLaunch> {
  const publicClient = await viem.getPublicClient();
  const factory = await viem.getContractAt("PortusFactory", factoryAddress);
  const params = await buildParams(viem, spec);
  const hash = await factory.write.createLaunch([params]);
  const chainId = await publicClient.getChainId();
  await publicClient.waitForTransactionReceipt({ hash, confirmations: chainId === 31337 ? 1 : 2 });
  const launchId = (await factory.read.launchCount()) - 1n;
  const info = await factory.read.launchAt([launchId]);
  return {
    launchId,
    token: info.token,
    sale: info.sale,
    pool: info.pool,
    treasury: info.treasury,
    startTime: params.startTime,
    endTime: params.startTime + params.duration,
    hash,
  };
}

/** Small public-from-the-start launch for local demos: 10 WETH target, 5 WETH per address. */
export async function createDemoLaunch(
  viem: Viem,
  factory: Address,
  quoteAsset: Address,
  opts: { saleMinutes: number },
) {
  return createLaunch(viem, factory, {
    name: "Demo Harbor Token",
    symbol: "DEMO",
    quoteAsset,
    raiseTarget: parseEther("10"),
    durationSeconds: Math.max(3600, opts.saleMinutes * 60),
    startIn: 10,
    publicOpensAfter: 0,
    publicCap: parseEther("5"),
    underRule: "SHRINK",
    minFillBps: 2000,
  });
}
