#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { launchpadAuctionAbi } from "@obscura/shared";
import { accountAddress, publicClient, walletClient } from "./chain.js";
import { assertAllowed } from "./policy.js";
import { listCommits, markRevealed } from "./store.js";

/**
 * Optional one-shot reveal guard. Run periodically with Task Scheduler/systemd.
 * Parameters come exclusively from the local commit store; no network or caller
 * input may alter price, amount, or salt.
 */
export async function revealPendingLocalCommits(): Promise<number> {
  const me = accountAddress();
  const client = publicClient();
  let revealed = 0;
  for (const commit of listCommits(me).filter((item) => !item.revealTxHash)) {
    const to = assertAllowed({ contract: "launchpadAuction", functionName: "reveal" });
    const phase = await client.readContract({ address: to, abi: launchpadAuctionAbi, functionName: "phaseOf", args: [BigInt(commit.auctionId)] });
    if (Number(phase) !== 2) continue;
    try {
      const hash = await walletClient().writeContract({ address: to, abi: launchpadAuctionAbi, functionName: "reveal", args: [BigInt(commit.auctionId), BigInt(commit.price), BigInt(commit.amount), commit.salt] });
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        console.error(`[launchpad-daemon] reveal reverted for auction #${commit.auctionId}: ${hash}`);
        continue;
      }
      markRevealed(commit.auctionId, me, hash);
      ++revealed;
      console.error(`[launchpad-daemon] revealed auction #${commit.auctionId}: ${hash}`);
    } catch (error) {
      // One unavailable/reverted auction must not prevent other local commits from revealing.
      console.error(`[launchpad-daemon] auction #${commit.auctionId} failed; continuing`, error);
    }
  }
  return revealed;
}

/**
 * Watch mode.
 *
 * The one-shot form needs Task Scheduler or systemd behind it, and the failure
 * mode of "meant to set that up" is a forfeited deposit — which is exactly what
 * happened on the first live testnet run: a bid was committed, the session
 * ended, and 0.05 ETH was lost seventeen hours later because nothing was
 * watching.
 *
 * The loop reads only the local commit store, so no network input can influence
 * price, amount, or salt.
 */
export async function watchPendingLocalCommits(intervalMs: number): Promise<never> {
  console.error(`[obscura-daemon] watching for reveal windows every ${Math.round(intervalMs / 1000)}s`);
  for (;;) {
    try {
      const count = await revealPendingLocalCommits();
      if (count > 0) console.error(`[obscura-daemon] revealed ${count} bid(s)`);
    } catch (error) {
      // Never let a transient RPC failure kill the guard.
      console.error("[obscura-daemon] sweep failed; retrying next tick", error);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
