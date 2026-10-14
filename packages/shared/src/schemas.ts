import { z } from "zod";
import { SALE_PHASES } from "./types.js";

export const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x-prefixed 20-byte address")
  .transform((v) => v.toLowerCase() as `0x${string}`);

export const hex32Schema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "must be a 0x-prefixed 32-byte hex string");

/** Decimal integer string. Token amounts never go through JS numbers. */
export const uintStringSchema = z
  .string()
  .regex(/^\d+$/, "must be a decimal integer string (base units, no decimal point)");

/** Launches are keyed by their token address. */
export const launchKeySchema = addressSchema;

export const salePhaseSchema = z.enum(SALE_PHASES as [string, ...string[]]);

export const untrustedLaunchCopySchema = z.object({
  name: z.string().max(120),
  symbol: z.string().max(32),
  description: z.string().max(8000),
  docsUrl: z.url().nullable(),
  imageUrl: z.url().nullable().default(null),
});

export const whitelistEntrySchema = z.object({
  account: addressSchema,
  cap: uintStringSchema.refine((v) => BigInt(v) > 0n, "cap must be positive"),
});

/** Body of PUT /launches/:token/whitelist. */
export const whitelistUploadSchema = z.object({
  entries: z.array(whitelistEntrySchema).min(1).max(50_000),
  root: hex32Schema,
  listHash: hex32Schema,
  nonce: hex32Schema,
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
});

/** Body of PUT /launches/:token/copy. */
export const copyUploadSchema = z.object({
  name: z.string().min(1).max(120),
  symbol: z.string().min(1).max(32),
  description: z.string().max(8000),
  docsUrl: z.url().nullable().optional(),
  imageUrl: z.url().nullable().optional(),
  nonce: hex32Schema,
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
});

export const launchSchema = z.object({
  launchId: z.number().int().nonnegative(),
  creator: addressSchema,
  token: addressSchema,
  sale: addressSchema,
  pool: addressSchema,
  quoteAsset: addressSchema,
  raiseTarget: uintStringSchema,
  qSale: uintStringSchema,
  qLp: uintStringSchema,
  qInc: uintStringSchema,
  priceNum: uintStringSchema,
  priceDen: uintStringSchema,
  feeBps: z.number().int(),
  creatorShareBps: z.number().int(),
  incentiveBps: z.number().int(),
  startTime: z.number().int(),
  endTime: z.number().int(),
  publicOpenAt: z.number().int(),
  publicCap: uintStringSchema,
  merkleRoot: hex32Schema,
  underRule: z.enum(["REFUND", "SHRINK"]),
  minFillBps: z.number().int(),
  treasuryMode: z.number().int(),
  metadataHash: hex32Schema,
  phase: salePhaseSchema,
  totalCommitted: uintStringSchema,
  subscriberCount: z.number().int().nonnegative(),
  claimedCount: z.number().int().nonnegative(),
  outcome: z.enum(["NONE", "FILLED", "SHRUNK", "REFUNDED"]),
  poolQuote: uintStringSchema.nullable(),
  poolTokens: uintStringSchema.nullable(),
  tokensBurned: uintStringSchema.nullable(),
  quoteDust: uintStringSchema.nullable(),
  incentiveFunded: uintStringSchema.nullable(),
  reserveQuote: uintStringSchema.nullable(),
  reserveToken: uintStringSchema.nullable(),
  indexedAtBlock: z.number().int().nonnegative(),
  copy: untrustedLaunchCopySchema,
});
