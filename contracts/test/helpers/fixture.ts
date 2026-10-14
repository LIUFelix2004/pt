import assert from "node:assert/strict";
import { network } from "hardhat";
import { maxUint128, zeroAddress, zeroHash, type Address, type Hex } from "viem";
import { buildWhitelist, type WhitelistEntry, type WhitelistTree } from "@portus/shared";

export const WAD = 10n ** 18n;
export const S = 10n ** 27n;
export const BPS = 10_000n;
export const HOUR = 3_600n;
export const DAY = 86_400n;

export enum Rule {
  REFUND = 0,
  SHRINK = 1,
}
export enum Phase {
  PENDING = 0,
  OPEN = 1,
  AWAITING_FINALIZE = 2,
  SUCCEEDED = 3,
  REFUNDING = 4,
}
export enum Outcome {
  NONE = 0,
  FILLED = 1,
  SHRUNK = 2,
  REFUNDED = 3,
}

export type Connection = Awaited<ReturnType<typeof network.create>>;
export type Viem = Connection["viem"];

export interface LaunchInput {
  name: string;
  symbol: string;
  quoteAsset: Address;
  raiseTarget: bigint;
  feeBps: number;
  creatorShareBps: number;
  incentiveBps: number;
  startTime: bigint;
  duration: bigint;
  merkleRoot: Hex;
  publicOpenAt: bigint;
  publicCap: bigint;
  underRule: number;
  minFillBps: number;
  treasuryMode: number;
  metadataHash: Hex;
  creatorRecipient: Address;
  releaseMode: number;
  releaseRateBps: number;
}

export interface MintTaxInput {
  buyBurnBps: number;
  buyCommunityBps: number;
  buyFoundationBps: number;
  sellBurnBps: number;
  sellCommunityBps: number;
  sellTechBps: number;
  dumpThresholdBps: number;
  dumpBurnShareBps: number;
  community: Address;
  foundation: Address;
  tech: Address;
  market: Address;
}

export interface MintLaunchInput {
  name: string;
  symbol: string;
  quoteAsset: Address;
  raiseTarget: bigint;
  initialSupply: bigint;
  maxSupply: bigint;
  startTime: bigint;
  duration: bigint;
  merkleRoot: Hex;
  publicOpenAt: bigint;
  publicCap: bigint;
  underRule: number;
  minFillBps: number;
  metadataHash: Hex;
  staticBps: number;
  schedule: { months: number[]; growthBps: number[] };
  tax: MintTaxInput;
}

/** Deploy linked deployer libraries + factory + an allowed 18-decimal quote asset. */
export async function deployPortus() {
  const conn = await network.create();
  const { viem, provider } = conn;
  const publicClient = await viem.getPublicClient();
  const wallets = await viem.getWalletClients();
  const [admin, creator, a, b, c, d, outsider] = wallets;
  assert(admin && creator && a && b && c && d && outsider);
  // Fixed platform roles: ecosystem fee recipient and Merkle root publisher.
  const ecosystem = wallets[8]!;
  const publisher = wallets[9]!;

  const tokenDeployer = await viem.deployContract("TokenDeployer");
  const poolDeployer = await viem.deployContract("PoolDeployer");
  const saleDeployer = await viem.deployContract("SaleDeployer");
  const treasuryDeployer = await viem.deployContract("TreasuryDeployer");
  const mintTokenDeployer = await viem.deployContract("MintTokenDeployer");
  const taxPoolDeployer = await viem.deployContract("TaxPoolDeployer");
  const emissionDeployer = await viem.deployContract("EmissionDeployer");
  const libraries = {
    TokenDeployer: tokenDeployer.address,
    PoolDeployer: poolDeployer.address,
    SaleDeployer: saleDeployer.address,
    TreasuryDeployer: treasuryDeployer.address,
    MintTokenDeployer: mintTokenDeployer.address,
    TaxPoolDeployer: taxPoolDeployer.address,
    EmissionDeployer: emissionDeployer.address,
  };
  const factory = await viem.deployContract(
    "PortusFactory",
    [admin.account.address, ecosystem.account.address, publisher.account.address],
    { libraries },
  );
  const locker = await viem.getContractAt("PortusLocker", await factory.read.locker());
  const splitter = await viem.getContractAt("PortusFeeSplitter", await factory.read.feeSplitter());
  const distributor = await viem.getContractAt("PortusDistributor", await factory.read.distributor());
  const flywheel = await viem.getContractAt("PortusFlywheel", await factory.read.flywheel());

  const weth = await viem.deployContract("MockERC20", ["Wrapped Ether", "WETH", 18]);
  await factory.write.setQuoteAsset([weth.address, true, false, 1n, maxUint128, zeroAddress, 0n]);

  const now = async () => (await publicClient.getBlock()).timestamp;
  const jumpTo = async (timestamp: bigint) => {
    await provider.request({ method: "evm_setNextBlockTimestamp", params: [Number(timestamp)] });
    await provider.request({ method: "evm_mine", params: [] });
  };

  async function defaults(over: Partial<LaunchInput> = {}): Promise<LaunchInput> {
    const t = await now();
    const startTime = over.startTime ?? t + 60n;
    return {
      name: "Test Token",
      symbol: "TST",
      quoteAsset: weth.address,
      raiseTarget: 10n * WAD,
      feeBps: 100,
      creatorShareBps: 0,
      incentiveBps: 3000,
      startTime,
      duration: HOUR,
      merkleRoot: zeroHash,
      publicOpenAt: startTime,
      publicCap: 1000n * WAD,
      underRule: Rule.REFUND,
      minFillBps: 0,
      treasuryMode: 0,
      metadataHash: zeroHash,
      creatorRecipient: zeroAddress,
      releaseMode: 0,
      releaseRateBps: (over.incentiveBps ?? 3000) > 0 ? 30 : 0,
      ...over,
    };
  }

  /**
   * Create a launch and return typed handles. Pass `whitelist` to build a tree
   * and use its root (public phase then defaults to off unless overridden).
   */
  async function launch(over: Partial<LaunchInput> = {}, whitelist?: WhitelistEntry[]) {
    let tree: WhitelistTree | null = null;
    if (whitelist) {
      tree = buildWhitelist(whitelist);
      over = { publicOpenAt: 0n, publicCap: 0n, ...over, merkleRoot: tree.root };
    }
    const params = await defaults(over);
    const hash = await factory.write.createLaunch([params], { account: creator!.account });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const id = (await factory.read.launchCount()) - 1n;
    const info = await factory.read.launchAt([id]);
    const quote = await viem.getContractAt("MockERC20", params.quoteAsset);
    return {
      id,
      params,
      receipt,
      tree,
      info,
      token: await viem.getContractAt("LaunchToken", info.token),
      sale: await viem.getContractAt("PortusSale", info.sale),
      pool: await viem.getContractAt("PortusPool", info.pool),
      treasury: await viem.getContractAt("PortusTreasury", info.treasury),
      quote,
    };
  }

  type Wallet = typeof a;

  // ─── mint mode ──────────────────────────────────────────────────────────────

  async function mintDefaults(over: Partial<MintLaunchInput> = {}): Promise<MintLaunchInput> {
    const t = await now();
    const startTime = over.startTime ?? t + 60n;
    // Accounts 10..13: clear of the platform roles at 8 and 9.
    const [community, foundation, tech, market] = wallets.slice(10, 14).map((w) => w.account.address);
    return {
      name: "Radar Token",
      symbol: "RADR",
      quoteAsset: weth.address,
      raiseTarget: 1_000_000n * WAD,
      initialSupply: 10_000_000n * WAD,
      maxSupply: 1_000_000_000n * WAD,
      startTime,
      duration: HOUR,
      merkleRoot: zeroHash,
      publicOpenAt: startTime,
      publicCap: 2_000_000n * WAD,
      underRule: Rule.REFUND,
      minFillBps: 0,
      metadataHash: zeroHash,
      staticBps: 5000,
      schedule: { months: [6, 36, 36, 162], growthBps: [1000, 500, 300, 100] },
      tax: {
        buyBurnBps: 100,
        buyCommunityBps: 100,
        buyFoundationBps: 100,
        sellBurnBps: 100,
        sellCommunityBps: 100,
        sellTechBps: 100,
        dumpThresholdBps: 300,
        dumpBurnShareBps: 5000,
        community: community!,
        foundation: foundation!,
        tech: tech!,
        market: market!,
      },
      ...over,
    };
  }

  async function mintLaunch(over: Partial<MintLaunchInput> = {}) {
    const params = await mintDefaults(over);
    const hash = await factory.write.createMintLaunch([params as never], { account: creator!.account });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const id = (await factory.read.launchCount()) - 1n;
    const info = await factory.read.launchAt([id]);
    return {
      id,
      params,
      receipt,
      info,
      token: await viem.getContractAt("PortusMintToken", info.token),
      sale: await viem.getContractAt("PortusSale", info.sale),
      pool: await viem.getContractAt("PortusTaxPool", info.pool),
      emission: await viem.getContractAt("PortusEmission", info.treasury),
      quote: await viem.getContractAt("MockERC20", params.quoteAsset),
    };
  }

  /** Mint quote to `wallet` and approve `spender`. */
  async function fund(quote: Address, wallet: Wallet, spender: Address, amount: bigint) {
    const q = await viem.getContractAt("MockERC20", quote);
    await q.write.mint([wallet.account.address, amount]);
    await q.write.approve([spender, amount], { account: wallet.account });
  }

  return {
    conn,
    viem,
    provider,
    publicClient,
    admin,
    creator,
    a,
    b,
    c,
    d,
    outsider,
    wallets,
    factory,
    locker,
    splitter,
    distributor,
    flywheel,
    ecosystem,
    publisher,
    weth,
    libraries,
    now,
    jumpTo,
    defaults,
    launch,
    mintDefaults,
    mintLaunch,
    fund,
  };
}

export type Portus = Awaited<ReturnType<typeof deployPortus>>;
export type LaunchHandle = Awaited<ReturnType<Portus["launch"]>>;
export type MintHandle = Awaited<ReturnType<Portus["mintLaunch"]>>;

export async function expectCustom(viem: Viem, promise: Promise<unknown>, contract: any, error: string) {
  await viem.assertions.revertWithCustomError(promise as Promise<Hex>, contract, error as never);
}

/** Subscribe through the public phase (funds + approves first). */
export async function subPublic(f: Portus, l: LaunchHandle, wallet: Portus["a"], amount: bigint) {
  await f.fund(l.params.quoteAsset, wallet, l.sale.address, amount);
  return l.sale.write.subscribePublic([amount], { account: wallet.account });
}

/** Subscribe through the whitelist using the proof from the launch's tree. */
export async function subWhitelist(f: Portus, l: LaunchHandle, wallet: Portus["a"], amount: bigint) {
  assert(l.tree, "launch has no whitelist");
  const entry = l.tree.entries.get(wallet.account.address.toLowerCase());
  assert(entry, "wallet not on whitelist");
  await f.fund(l.params.quoteAsset, wallet, l.sale.address, amount);
  return l.sale.write.subscribe([amount, entry.cap, entry.proof], { account: wallet.account });
}

/** Advance chain time by `seconds` and mine. */
export async function advance(f: Portus, seconds: bigint) {
  await f.jumpTo((await f.now()) + seconds);
}

/** Jump into the window, run `body`, then jump past the end. */
export async function openWindow(f: Portus, l: LaunchHandle) {
  await f.jumpTo(l.params.startTime);
}

export async function closeWindow(f: Portus, l: LaunchHandle) {
  await f.jumpTo(l.params.startTime + l.params.duration);
}
