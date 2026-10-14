/**
 * Whitelist Merkle tree — a thin wrapper over OpenZeppelin's
 * @openzeppelin/merkle-tree (StandardMerkleTree), whose leaf encoding matches
 * PortusSale.subscribe byte for byte:
 *
 *   leaf = keccak256(bytes.concat(keccak256(abi.encode(account, cap))))
 *
 * Interior nodes use sorted-pair hashing, which is what MerkleProof.verify expects.
 *
 * The contract only trusts the root fixed at createLaunch. A proof served by
 * the API that does not reproduce that root simply fails to subscribe, so the
 * front end re-verifies every proof locally against the on-chain root.
 */
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { encodeAbiParameters, keccak256, type Hex } from "viem";
import type { Address } from "./types.js";

const LEAF_ENCODING = ["address", "uint256"] as const;

export interface WhitelistEntry {
  account: Address;
  /** Max quote-asset base units this account may commit through the whitelist. */
  cap: bigint;
}

export interface WhitelistTree {
  root: Hex;
  /** Lower-cased account -> { account, cap, proof } */
  entries: Map<string, { account: Address; cap: bigint; proof: Hex[] }>;
  /** OZ's JSON dump; can be stored and reloaded with StandardMerkleTree.load. */
  dump: unknown;
}

/**
 * Build the tree. Accounts must be unique (case-insensitive): two caps for one
 * address would make which one applies depend on which proof is served.
 */
export function buildWhitelist(list: readonly WhitelistEntry[]): WhitelistTree {
  if (list.length === 0) throw new Error("whitelist is empty");
  const seen = new Set<string>();
  for (const e of list) {
    const key = e.account.toLowerCase();
    if (seen.has(key)) throw new Error(`duplicate whitelist account ${e.account}`);
    if (e.cap <= 0n) throw new Error(`cap for ${e.account} must be positive`);
    seen.add(key);
  }

  const tree = StandardMerkleTree.of(
    list.map((e) => [e.account, e.cap.toString()]),
    [...LEAF_ENCODING],
  );

  const entries: WhitelistTree["entries"] = new Map();
  for (const [i, [account, cap]] of tree.entries()) {
    entries.set(String(account).toLowerCase(), {
      account: account as Address,
      cap: BigInt(cap as string),
      proof: tree.getProof(i) as Hex[],
    });
  }
  return { root: tree.root as Hex, entries, dump: tree.dump() };
}

export function whitelistLeaf(account: Address, cap: bigint): Hex {
  return StandardMerkleTree.of([[account, cap.toString()]], [...LEAF_ENCODING]).root as Hex;
}

/** Same check as OpenZeppelin MerkleProof.verify. */
export function verifyWhitelistProof(root: Hex, account: Address, cap: bigint, proof: readonly Hex[]): boolean {
  try {
    return StandardMerkleTree.verify(root, [...LEAF_ENCODING], [account, cap.toString()], [...proof]);
  } catch {
    return false;
  }
}

/**
 * Parse "address,cap" lines (header row, comments and blank lines tolerated).
 * Caps are base-unit integers; no decimals are interpreted here.
 */
export function parseWhitelistCsv(text: string): WhitelistEntry[] {
  const out: WhitelistEntry[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [addr, cap] = line.split(/[,;\t]/).map((s) => s.trim());
    if (!addr || !/^0x[0-9a-fA-F]{40}$/.test(addr)) {
      if (out.length === 0 && /address/i.test(line)) continue; // header
      throw new Error(`bad whitelist line: ${line}`);
    }
    if (!cap || !/^\d+$/.test(cap)) throw new Error(`bad cap on line: ${line}`);
    out.push({ account: addr as Address, cap: BigInt(cap) });
  }
  return out;
}

/** Order-independent hash of a list, signed by the creator when uploading it. */
export function whitelistListHash(list: readonly WhitelistEntry[]): Hex {
  const sorted = [...list].sort((a, b) => a.account.toLowerCase().localeCompare(b.account.toLowerCase()));
  return keccak256(
    encodeAbiParameters(
      [{ type: "address[]" }, { type: "uint256[]" }],
      [sorted.map((e) => e.account), sorted.map((e) => e.cap)],
    ),
  );
}
