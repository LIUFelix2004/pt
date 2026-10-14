/**
 * Reward / incentive Merkle trees for PortusDistributor.
 *
 * Leaf = keccak256(bytes.concat(keccak256(abi.encode(account, token, asset, epoch, amount))))
 * — OpenZeppelin StandardMerkleTree encoding, matching PortusDistributor._claim.
 * One tree per (token, asset, epoch). The calculator publishes the full entry
 * list next to the root so anyone can recompute it during the challenge period.
 */
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import type { Address, Hex } from "./types.js";

const ENCODING = ["address", "address", "address", "uint256", "uint256"] as const;

export interface RewardEntry {
  account: Address;
  amount: bigint;
}

export interface RewardTree {
  root: Hex;
  total: bigint;
  entries: Array<{ account: Address; amount: bigint; proof: Hex[] }>;
  dump: unknown;
}

export function buildRewardTree(token: Address, asset: Address, epoch: bigint | number, list: readonly RewardEntry[]): RewardTree {
  const seen = new Set<string>();
  const rows = list.filter((e) => e.amount > 0n);
  if (rows.length === 0) throw new Error("reward list is empty");
  for (const e of rows) {
    const k = e.account.toLowerCase();
    if (seen.has(k)) throw new Error(`duplicate reward account ${e.account}`);
    seen.add(k);
  }
  const ep = BigInt(epoch).toString();
  const tree = StandardMerkleTree.of(
    rows.map((e) => [e.account, token, asset, ep, e.amount.toString()]),
    [...ENCODING],
  );
  const entries: RewardTree["entries"] = [];
  for (const [i, v] of tree.entries()) {
    entries.push({ account: v[0] as Address, amount: BigInt(v[4] as string), proof: tree.getProof(i) as Hex[] });
  }
  return { root: tree.root as Hex, total: rows.reduce((s, e) => s + e.amount, 0n), entries, dump: tree.dump() };
}

export function verifyRewardProof(
  root: Hex,
  account: Address,
  token: Address,
  asset: Address,
  epoch: bigint | number,
  amount: bigint,
  proof: readonly Hex[],
): boolean {
  try {
    return StandardMerkleTree.verify(root, [...ENCODING], [account, token, asset, BigInt(epoch).toString(), amount.toString()], [...proof]);
  } catch {
    return false;
  }
}

/**
 * Split `total` across weights pro rata, rounding down; the remainder stays
 * unallocated (never over-allocates). Weights are arbitrary non-negative bigints.
 */
export function proRata(total: bigint, weights: ReadonlyMap<string, bigint>): Map<string, bigint> {
  let sum = 0n;
  for (const w of weights.values()) sum += w;
  const out = new Map<string, bigint>();
  if (sum === 0n || total === 0n) return out;
  for (const [k, w] of weights) {
    const v = (total * w) / sum;
    if (v > 0n) out.set(k, v);
  }
  return out;
}
