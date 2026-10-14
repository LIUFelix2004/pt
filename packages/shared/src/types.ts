export type Hex = `0x${string}`;
export type Address = `0x${string}`;

/** Mirrors PortusSale.Phase exactly (same order as the Solidity enum). */
export type SalePhase =
  | "PENDING" // created, window not open yet
  | "OPEN" // subscriptions accepted
  | "AWAITING_FINALIZE" // window closed, anyone may call finalize()
  | "SUCCEEDED" // pool live, claims open
  | "REFUNDING"; // below target: full refunds, supply burned

export const SALE_PHASES: readonly SalePhase[] = ["PENDING", "OPEN", "AWAITING_FINALIZE", "SUCCEEDED", "REFUNDING"];

/**
 * Fields written by the launch creator are ATTACKER-CONTROLLED. Anything
 * carrying this marker is displayed fenced as untrusted content.
 */
export interface UntrustedLaunchCopy {
  name: string;
  symbol: string;
  description: string;
  docsUrl: string | null;
  imageUrl: string | null;
}

export interface QuoteAssetInfo {
  address: Address;
  symbol: string | null;
  decimals: number;
  allowed: boolean;
  /** The issuer can freeze addresses (e.g. stablecoin blacklists). */
  freezable: boolean;
  minFdv: string;
  maxFdv: string;
}

/** Parameters fixed by the creator at createLaunch. All amounts are base-unit strings. */
export interface LaunchParams {
  launchId: number;
  creator: Address;
  token: Address;
  sale: Address;
  pool: Address;
  quoteAsset: Address;
  raiseTarget: string;
  qSale: string;
  qLp: string;
  qInc: string;
  /** Subscription price p = priceNum / priceDen (quote base units per token base unit). */
  priceNum: string;
  priceDen: string;
  feeBps: number;
  creatorShareBps: number;
  incentiveBps: number;
  startTime: number;
  endTime: number;
  /** 0 = no public phase. */
  publicOpenAt: number;
  publicCap: string;
  merkleRoot: Hex;
  underRule: "REFUND" | "SHRINK";
  minFillBps: number;
  treasuryMode: number;
  metadataHash: Hex;
}

/** Facts read from chain state or reconstructed from events — never creator-written. */
export interface LaunchOnchainFacts extends LaunchParams {
  phase: SalePhase;
  totalCommitted: string;
  subscriberCount: number;
  claimedCount: number;
  outcome: "NONE" | "FILLED" | "SHRUNK" | "REFUNDED";
  /** Settlement results; null until finalize(). */
  poolQuote: string | null;
  poolTokens: string | null;
  tokensBurned: string | null;
  quoteDust: string | null;
  incentiveFunded: string | null;
  /** Live reserves; null until the pool is initialised. */
  reserveQuote: string | null;
  reserveToken: string | null;
  /** Highest block fully reflected by the API event index. */
  indexedAtBlock: number;
}

/** STANDARD: fixed supply + incentive pool. MINT: initial supply + scheduled minting, taxed pool. */
export type LaunchKind = "STANDARD" | "MINT";

export interface Launch extends LaunchOnchainFacts {
  kind: LaunchKind;
  quote: Pick<QuoteAssetInfo, "symbol" | "decimals" | "freezable"> | null;
  copy: UntrustedLaunchCopy;
}

export interface SubscriptionRecord {
  token: Address;
  account: Address;
  committed: string;
  whitelistCommitted: string;
  publicCommitted: string;
  claimed: boolean;
  tokensClaimed: string | null;
  refundClaimed: string | null;
}

export interface SwapRecord {
  pool: Address;
  blockNumber: number;
  logIndex: number;
  txHash: Hex;
  timestamp: number;
  trader: Address;
  recipient: Address;
  isBuy: boolean;
  amountIn: string;
  amountOut: string;
  feeQuote: string;
  reserveQuote: string;
  reserveToken: string;
}

export interface Candle {
  /** Bucket start, unix seconds. */
  t: number;
  /** Prices as quote base units per 1e18 token base units, decimal strings. */
  o: string;
  h: string;
  l: string;
  c: string;
  /** Quote volume in base units. */
  v: string;
}
