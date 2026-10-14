import { parseEventLogs, type Address } from "viem";
import {
  blockRanges,
  portusDistributorAbi,
  portusEmissionAbi,
  portusFactoryAbi,
  portusFeeSplitterAbi,
  portusFlywheelAbi,
  portusPoolAbi,
  portusSaleAbi,
  portusTaxPoolAbi,
  portusTreasuryAbi,
} from "@portus/shared";
import { CHAIN_ID, FACTORY, SINGLETONS, START_BLOCK, client, readSymbol, readTokenMeta, refreshChainTime } from "./chain.js";
import { createIndexer, type IndexedLog } from "./indexer.js";

// Event names are unique across these ABIs except `Claimed` (Sale vs Distributor)
// — both carry the same decoded shape the indexer reads by emitting address.
const ABI = [
  ...portusFactoryAbi,
  ...portusSaleAbi,
  ...portusPoolAbi,
  ...portusTreasuryAbi,
  ...portusFeeSplitterAbi,
  ...portusDistributorAbi,
  ...portusFlywheelAbi,
  // Mint mode: the tax pool repeats Initialized/Swap with identical signatures.
  ...portusTaxPoolAbi.filter((x) => x.type === "event" && x.name !== "Initialized" && x.name !== "Swap"),
  ...portusEmissionAbi.filter((x) => x.type === "event"),
];
/** Providers cap address lists per getLogs; stay well under common limits. */
const ADDRESS_BATCH = 200;

export const indexer = createIndexer({
  chainId: CHAIN_ID,
  factory: FACTORY,
  singletons: SINGLETONS,
  startBlock: START_BLOCK,
  getBlockNumber: () => client.getBlockNumber(),
  getBlockTimestamp: async (blockNumber) => Number((await client.getBlock({ blockNumber })).timestamp),
  readSymbol,
  readTokenMeta,
  getLogs: async (addresses, fromBlock, toBlock) => {
    const out: IndexedLog[] = [];
    // Public RPCs reject wide ranges; chunk by block range and by address list.
    for (const { from, to } of blockRanges(fromBlock, toBlock)) {
      for (let i = 0; i < addresses.length; i += ADDRESS_BATCH) {
        const logs = await client.getLogs({ address: addresses.slice(i, i + ADDRESS_BATCH) as Address[], fromBlock: from, toBlock: to });
        for (const log of parseEventLogs({ abi: ABI, logs, strict: false })) {
          out.push({
            eventName: log.eventName,
            address: log.address,
            blockNumber: log.blockNumber!,
            logIndex: log.logIndex!,
            transactionHash: log.transactionHash!,
            args: (log.args ?? {}) as Record<string, unknown>,
          });
        }
      }
    }
    return out;
  },
});

let inflight: Promise<boolean> | null = null;

/**
 * Sync on demand, single-flight: concurrent requests share one sync instead of
 * racing to write progress. A failure leaves the last good index in place.
 */
export function syncIndex(): Promise<boolean> {
  inflight ??= (async () => {
    try {
      // Chain time refreshes with the events it labels, so phases served from
      // the index use the contract's clock.
      await Promise.all([indexer.sync(), refreshChainTime()]);
      return true;
    } catch (error) {
      console.error("event index sync failed", error);
      return false;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
