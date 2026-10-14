/**
 * Block-range chunking for log queries.
 *
 * `eth_getLogs` from block 0 works on a local chain with a few hundred blocks
 * and fails on every public network: Sepolia is past 11.5M blocks and providers
 * cap a single query at 50k (`exceed maximum block range: 50000`). Local tests
 * never surface this, so any code that reconstructs state from events must
 * paginate.
 *
 * Pair this with the `startBlock` recorded in deployments/<chainId>.json —
 * scanning from genesis is wasteful even where a provider tolerates it.
 */
export const DEFAULT_LOG_CHUNK = 45_000n;

export function* blockRanges(
  fromBlock: bigint,
  toBlock: bigint,
  chunk: bigint = DEFAULT_LOG_CHUNK,
): Generator<{ from: bigint; to: bigint }> {
  if (chunk <= 0n) throw new Error("chunk must be positive");
  for (let from = fromBlock; from <= toBlock; from += chunk) {
    const to = from + chunk - 1n;
    yield { from, to: to > toBlock ? toBlock : to };
  }
}

/**
 * Where to begin scanning for a deployment's events.
 *
 * Prefers the recorded deployment block. Without one, falls back to a bounded
 * look-back from the chain head rather than genesis, so an un-annotated
 * deployment degrades to "recent history" instead of "request rejected".
 */
export function resolveStartBlock(
  recorded: number | undefined,
  latest: bigint,
  lookback: bigint = 200_000n,
): bigint {
  if (typeof recorded === "number" && recorded >= 0) return BigInt(recorded);
  return latest > lookback ? latest - lookback : 0n;
}
