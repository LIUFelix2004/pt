import { serve } from "@hono/node-server";
import { deploymentMismatchWarning } from "@portus/shared";
import { createApp } from "./app.js";
import {
  allCopy,
  consumeNonceAndReplaceWhitelist,
  consumeNonceAndUpsertCopy,
  getCopy,
  getWhitelistEntry,
  whitelistCount,
} from "./db.js";
import { verifyCopyAuthorization, verifyWhitelistAuthorization } from "./auth.js";
import { indexer, syncIndex } from "./indexer-runtime.js";
import { resolve } from "node:path";
import {
  CHAIN,
  CHAIN_ID,
  FACTORY,
  REPO_ROOT,
  chainNowSeconds,
  readClaimed,
  readEconomics,
  readMint,
  readFlywheel,
  readOwed,
  readBalances,
  readSubscription,
} from "./chain.js";

const deploymentMismatch = () => deploymentMismatchWarning({ chainId: CHAIN_ID, factory: FACTORY }, REPO_ROOT);

const app = createApp({
  chainId: CHAIN_ID,
  chainName: CHAIN.displayName,
  explorerUrl: CHAIN.explorerUrl,
  factory: FACTORY,
  indexer,
  syncIndex,
  now: chainNowSeconds,
  deploymentMismatch,
  readSubscription,
  verifyCopyAuthorization,
  verifyWhitelistAuthorization,
  getCopy,
  allCopy,
  consumeNonceAndUpsertCopy,
  consumeNonceAndReplaceWhitelist,
  getWhitelistEntry,
  whitelistCount,
  rewardsDir: resolve(REPO_ROOT, process.env.REWARDS_DIR ?? "data/rewards"),
  readEconomics,
  readMint,
  readOwed,
  readClaimed,
  readFlywheel,
  readBalances,
});

const port = Number(process.env.API_PORT ?? 8787);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Portus API on http://127.0.0.1:${info.port}`);
  console.log(`network: ${CHAIN.displayName} (chain ${CHAIN_ID})`);
  console.log(`factory: ${FACTORY}`);
  // The commonest operational mistake: redeploying without restarting this
  // process, which then serves a factory nobody uses any more.
  const mismatch = deploymentMismatch();
  if (mismatch) console.warn(`\n${mismatch}\n`);
  void syncIndex().then((ok) => console.log(ok ? `indexed to block ${indexer.getIndexedBlock()}` : "initial index sync failed"));
});
