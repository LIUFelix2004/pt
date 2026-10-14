/**
 * Attach demo copy to every local launch that has none (local chains only).
 * Production copy always arrives through the creator-signed PUT /copy route.
 */
import { hashLaunchCopy } from "@portus/shared";
import { getCopy, upsertCopyUnsigned } from "./db.js";
import { CHAIN, CHAIN_ID } from "./chain.js";
import { indexer, syncIndex } from "./indexer-runtime.js";

if (!CHAIN.isLocal) {
  console.error("seed writes unsigned copy and only runs against a local chain.");
  process.exit(1);
}
if (!(await syncIndex())) {
  console.error("Could not index the chain. Run `npm run chain` and `npm run contracts:deploy` first.");
  process.exit(1);
}

let n = 0;
for (const row of indexer.listLaunches()) {
  if (getCopy(CHAIN_ID, row.token)) continue;
  const copy = {
    name: "Demo Harbor Token",
    symbol: "DEMO",
    description: [
      "A local development launch for exercising the Portus main line.",
      "",
      "Subscribe at a fixed price during the window. When it closes, anyone can",
      "finalize: the pool opens at exactly the subscription price with its",
      "liquidity locked for good, and oversubscribed funds are refunded pro rata.",
    ].join("\n"),
    docsUrl: null,
    imageUrl: null,
  };
  upsertCopyUnsigned(CHAIN_ID, {
    token: row.token,
    name: copy.name,
    symbol: copy.symbol,
    description: copy.description,
    docs_url: null,
    image_url: null,
    copy_hash: hashLaunchCopy(copy),
  });
  n++;
}
console.log(`seeded copy for ${n} launch(es)`);
