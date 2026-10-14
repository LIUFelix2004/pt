import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { toHex, type Address, type Hex } from "viem";
import {
  COPY_AUTH_TYPES,
  WHITELIST_AUTH_TYPES,
  buildWhitelist,
  hashLaunchCopy,
  portusSigningDomain,
  whitelistListHash,
} from "@portus/shared";
import { createApp } from "./app.js";
import { createIndexer, type IndexedLog } from "./indexer.js";
import { verifyCopyAuthorization, verifyWhitelistAuthorization } from "./auth.js";

const creator = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const attacker = privateKeyToAccount("0x8b3a350cf5c34c9194ca3a545d3b1af833a638219229cc0dc1bf38f00fdf3a9a");
const FACTORY = "0x00000000000000000000000000000000000000f0" as Address;
const OTHER_FACTORY = "0x00000000000000000000000000000000000000f9" as Address;
const TOKEN = "0x00000000000000000000000000000000000000a1" as Address;
const SALE = "0x00000000000000000000000000000000000000a2" as Address;
const POOL = "0x00000000000000000000000000000000000000a3" as Address;
const QUOTE = "0x00000000000000000000000000000000000000a4" as Address;
const ALICE = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
const BOB = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as Address;

const list = [
  { account: ALICE, cap: 5n * 10n ** 18n },
  { account: BOB, cap: 3n * 10n ** 18n },
];
const tree = buildWhitelist(list);
const copy = { name: "Harbor", symbol: "HBR", description: "creator copy", docsUrl: null, imageUrl: null };

const tx = `0x${"ab".repeat(32)}` as Hex;
const logs: IndexedLog[] = [
  {
    address: FACTORY, eventName: "LaunchCreated", blockNumber: 3n, logIndex: 0, transactionHash: tx,
    args: {
      launchId: 0n, creator: creator.address, token: TOKEN, sale: SALE, pool: POOL, quoteAsset: QUOTE,
      raiseTarget: 10n ** 19n, qSale: 35n * 10n ** 25n, qLp: 35n * 10n ** 25n, qInc: 3n * 10n ** 26n, priceNum: 1n, priceDen: 35_000_000n,
    },
  },
  {
    address: FACTORY, eventName: "LaunchRules", blockNumber: 3n, logIndex: 1, transactionHash: tx,
    args: {
      launchId: 0n, feeBps: 100, creatorShareBps: 0, incentiveBps: 3000, startTime: 100n, endTime: 200n, publicOpenAt: 0n,
      publicCap: 0n, merkleRoot: tree.root, underRule: 0, minFillBps: 0, treasuryMode: 0, metadataHash: `0x${"0".repeat(64)}`,
    },
  },
];

const randomNonce = () => toHex(crypto.getRandomValues(new Uint8Array(32)));

async function signedCopy(o: { account?: typeof creator; nonce?: Hex; content?: typeof copy; chainId?: number; factory?: Address } = {}) {
  const content = o.content ?? copy;
  const nonce = o.nonce ?? randomNonce();
  const signature = await (o.account ?? creator).signTypedData({
    domain: portusSigningDomain(o.chainId ?? 31337, o.factory ?? FACTORY),
    types: COPY_AUTH_TYPES,
    primaryType: "LaunchCopyAuthorization",
    message: { token: TOKEN, copyHash: hashLaunchCopy(content), nonce },
  });
  return { ...content, nonce, signature };
}

async function signedWhitelist(o: { account?: typeof creator; entries?: typeof list; root?: Hex; nonce?: Hex } = {}) {
  const entries = o.entries ?? list;
  const root = o.root ?? tree.root;
  const listHash = whitelistListHash(entries);
  const nonce = o.nonce ?? randomNonce();
  const signature = await (o.account ?? creator).signTypedData({
    domain: portusSigningDomain(31337, FACTORY),
    types: WHITELIST_AUTH_TYPES,
    primaryType: "WhitelistAuthorization",
    message: { token: TOKEN, root, listHash, nonce },
  });
  return { entries: entries.map((e) => ({ account: e.account, cap: e.cap.toString() })), root, listHash, nonce, signature };
}

describe("creator-signed uploads", () => {
  const directory = mkdtempSync(join(tmpdir(), "portus-auth-"));
  let app: ReturnType<typeof createApp>;

  before(async () => {
    process.env.DATABASE_PATH = join(directory, "test.db");
    const db = await import("./db.js");
    const indexer = createIndexer({
      chainId: 31337,
      factory: FACTORY,
      startBlock: 1n,
      getBlockNumber: async () => 3n,
      getBlockTimestamp: async () => 0,
      getLogs: async (addresses) => logs.filter((l) => addresses.map((a) => a.toLowerCase()).includes(l.address.toLowerCase())),
    });
    app = createApp({
      chainId: 31337,
      chainName: "Hardhat",
      explorerUrl: null,
      factory: FACTORY,
      indexer,
      syncIndex: async () => {
        await indexer.sync();
        return true;
      },
      now: () => 150,
      deploymentMismatch: () => null,
      readSubscription: async () => ({ committed: "0", whitelistCommitted: "0", publicCommitted: "0", claimed: false, previewTokens: "0", previewRefund: "0" }),
      verifyCopyAuthorization,
      verifyWhitelistAuthorization,
      ...db,
    });
  });

  after(async () => {
    const { closeDb } = await import("./db.js");
    closeDb();
    rmSync(directory, { recursive: true, force: true });
  });

  const put = (path: string, body: unknown) =>
    app.request(path, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("serves the indexed launch with fallback copy and OPEN phase", async () => {
    const res = await app.request(`/launches/${TOKEN}`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.phase, "OPEN");
    assert.equal(body.copy.name, "Launch #0");
    assert.equal(body.merkleRoot, tree.root);
  });

  it("copy: accepts the creator, rejects others, tampering, replays and other domains", async () => {
    assert.equal((await put(`/launches/${TOKEN}/copy`, await signedCopy())).status, 200);
    const body = (await (await app.request(`/launches/${TOKEN}`)).json()) as any;
    assert.equal(body.copy.description, "creator copy");

    assert.equal((await put(`/launches/${TOKEN}/copy`, await signedCopy({ account: attacker }))).status, 403);
    const original = await signedCopy();
    assert.equal((await put(`/launches/${TOKEN}/copy`, { ...original, description: "tampered" })).status, 403);
    assert.equal((await put(`/launches/${TOKEN}/copy`, await signedCopy({ chainId: 1 }))).status, 403);
    assert.equal((await put(`/launches/${TOKEN}/copy`, await signedCopy({ factory: OTHER_FACTORY }))).status, 403);

    const nonce = toHex(7n, { size: 32 });
    assert.equal((await put(`/launches/${TOKEN}/copy`, await signedCopy({ nonce }))).status, 200);
    assert.equal((await put(`/launches/${TOKEN}/copy`, await signedCopy({ nonce, content: { ...copy, description: "x" } }))).status, 409);
  });

  it("whitelist: accepts a signed list matching the on-chain root and serves proofs", async () => {
    const res = await put(`/launches/${TOKEN}/whitelist`, await signedWhitelist());
    assert.equal(res.status, 200, await res.text());
    const proof = (await (await app.request(`/launches/${TOKEN}/whitelist/${ALICE}`)).json()) as any;
    assert.equal(proof.cap, (5n * 10n ** 18n).toString());
    assert.deepEqual(proof.proof, tree.entries.get(ALICE.toLowerCase())!.proof);
    assert.equal((await app.request(`/launches/${TOKEN}/whitelist/${attacker.address}`)).status, 404);
  });

  it("whitelist: rejects a list that does not reproduce the on-chain root", async () => {
    const altered = [{ account: ALICE, cap: 50n * 10n ** 18n }, list[1]!];
    const body = await signedWhitelist({ entries: altered });
    assert.equal((await put(`/launches/${TOKEN}/whitelist`, body)).status, 422);
  });

  it("whitelist: rejects a non-creator signature and a mismatched listHash", async () => {
    assert.equal((await put(`/launches/${TOKEN}/whitelist`, await signedWhitelist({ account: attacker }))).status, 403);
    const body = await signedWhitelist();
    assert.equal((await put(`/launches/${TOKEN}/whitelist`, { ...body, listHash: `0x${"22".repeat(32)}` })).status, 422);
  });

  it("read routes: health, quote assets, filtered list, subscription, swaps, candles", async () => {
    const health = (await (await app.request("/health")).json()) as any;
    assert.equal(health.factory, FACTORY);
    assert.equal(health.indexedBlock, 3);
    assert.equal((await app.request("/quote-assets")).status, 200);

    const open = (await (await app.request("/launches?phase=OPEN")).json()) as any;
    assert.equal(open.launches.length, 1);
    assert.equal(open.launches[0].copy.name, copy.name);
    const none = (await (await app.request("/launches?phase=SUCCEEDED")).json()) as any;
    assert.equal(none.launches.length, 0);
    const other = (await (await app.request(`/launches?quote=${FACTORY}`)).json()) as any;
    assert.equal(other.launches.length, 0);

    const sub = (await (await app.request(`/launches/${TOKEN}/subscription/${ALICE}`)).json()) as any;
    assert.equal(sub.phase, "OPEN");
    assert.equal(sub.scenarios, null);
    assert.equal((await app.request(`/launches/${TOKEN}/subscription/0x123`)).status, 400);

    assert.deepEqual(((await (await app.request(`/launches/${TOKEN}/swaps`)).json()) as any).swaps, []);
    assert.deepEqual(((await (await app.request(`/launches/${TOKEN}/candles?interval=1h`)).json()) as any).candles, []);
    assert.equal((await app.request(`/launches/${TOKEN}/candles?interval=7m`)).status, 400);
    assert.equal((await app.request(`/launches/0x00000000000000000000000000000000000000ee/swaps`)).status, 404);
    assert.equal((await app.request(`/launches/not-an-address`)).status, 400);
  });

  it("rejects malformed upload bodies", async () => {
    const bad = await app.request(`/launches/${TOKEN}/copy`, { method: "PUT", headers: { "content-type": "application/json" }, body: "{" });
    assert.equal(bad.status, 400);
    assert.equal((await put(`/launches/${TOKEN}/copy`, { name: "" })).status, 400);
    assert.equal((await put(`/launches/${TOKEN}/whitelist`, { entries: [] })).status, 400);
  });

  it("returns 404 for launches that are not on chain", async () => {
    const other = "0x00000000000000000000000000000000000000ee";
    assert.equal((await put(`/launches/${other}/copy`, await signedCopy())).status, 404);
  });
});
