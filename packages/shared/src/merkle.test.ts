import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { concat, encodeAbiParameters, keccak256 } from "viem";
import {
  buildWhitelist,
  parseWhitelistCsv,
  verifyWhitelistProof,
  whitelistLeaf,
  whitelistListHash,
} from "./merkle.js";

const A = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const B = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const;
const C = "0x90F79bf6EB2c4f870365E785982E1f101E93b906" as const;

describe("merkle", () => {
  it("leaf is keccak256(keccak256(abi.encode(account, cap))) — the PortusSale encoding", () => {
    const inner = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [A, 5n]));
    assert.equal(whitelistLeaf(A, 5n), keccak256(inner));
  });

  it("a two-leaf root is the sorted-pair hash of the leaves", () => {
    const la = whitelistLeaf(A, 1n);
    const lb = whitelistLeaf(B, 2n);
    const [x, y] = BigInt(la) < BigInt(lb) ? [la, lb] : [lb, la];
    assert.equal(buildWhitelist([{ account: A, cap: 1n }, { account: B, cap: 2n }]).root, keccak256(concat([x, y])));
  });

  it("every proof verifies; wrong cap or account fails", () => {
    const list = [
      { account: A, cap: 10n },
      { account: B, cap: 20n },
      { account: C, cap: 30n },
    ];
    const tree = buildWhitelist(list);
    for (const e of list) {
      const entry = tree.entries.get(e.account.toLowerCase())!;
      assert.ok(verifyWhitelistProof(tree.root, e.account, e.cap, entry.proof));
      assert.ok(!verifyWhitelistProof(tree.root, e.account, e.cap + 1n, entry.proof));
    }
    const pa = tree.entries.get(A.toLowerCase())!.proof;
    assert.ok(!verifyWhitelistProof(tree.root, B, 10n, pa));
  });

  it("rejects duplicates and non-positive caps", () => {
    assert.throws(() => buildWhitelist([{ account: A, cap: 1n }, { account: A.toLowerCase() as typeof A, cap: 2n }]));
    assert.throws(() => buildWhitelist([{ account: A, cap: 0n }]));
    assert.throws(() => buildWhitelist([]));
  });

  it("parses CSV with header and comments; list hash is order-independent", () => {
    const list = parseWhitelistCsv(`address,cap\n# team\n${A},10\n\n${B};20\n`);
    assert.equal(list.length, 2);
    assert.equal(list[1]!.cap, 20n);
    assert.throws(() => parseWhitelistCsv(`${A},1.5`));
    assert.equal(whitelistListHash(list), whitelistListHash([...list].reverse()));
  });
});
