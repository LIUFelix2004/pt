import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pendingActions, unrevealedWarnings } from "./pending.js";
import type { LocalCommitRecord } from "@obscura/shared";

const record = { chainId: 31337, auctionAddress: "0x00000000000000000000000000000000000000aa", auctionId: 7, bidder: "0x0000000000000000000000000000000000000001", price: "1", amount: "1", salt: "0x01", commitment: "0x02", depositWei: "99", commitTxHash: "0x03", committedAt: 1, revealTxHash: null } as LocalCommitRecord;

describe("unrevealed warnings", () => {
  it("warns prominently during reveal and ignores revealed records", async () => {
    const warnings = await unrevealedWarnings([record, { ...record, auctionId: 8, revealTxHash: "0x04" }], async () => ({ phase: "REVEAL", revealEnd: 1_500n }), 1_000);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /CRITICAL.*#7.*99 wei/);
  });
  it("does not warn outside reveal", async () => {
    assert.deepEqual(await unrevealedWarnings([record], async () => ({ phase: "SETTLED", revealEnd: 1_500n }), 1_000), []);
  });
  it("sorts reveals by deadline before claims", async () => {
    const records = [record, { ...record, auctionId: 8 }, { ...record, auctionId: 9, revealTxHash: "0x04" as const }];
    const actions = await pendingActions(records, async (id) => id === 7 ? { phase: "REVEAL", revealEnd: 1_500n, claimable: false } : id === 8 ? { phase: "REVEAL", revealEnd: 1_200n, claimable: false } : { phase: "SETTLED", revealEnd: 1_100n, claimable: true }, 1_000);
    assert.deepEqual(actions.map((item) => `${item.action}:${item.auctionId}`), ["reveal:8", "reveal:7", "claim:9"]);
  });
});
