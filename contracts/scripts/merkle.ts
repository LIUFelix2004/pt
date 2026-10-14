// Build a whitelist tree from a CSV of "address,cap" (cap in quote base units).
//
//   npm run merkle -w @portus/contracts -- whitelist.csv [out.json]
//
// Prints the root to pass as `merkleRoot` at createLaunch, and writes every
// account's proof. The creator later uploads the same list to the API, which
// rebuilds the tree and refuses it unless the root matches the chain.
import { readFileSync, writeFileSync } from "node:fs";
import { buildWhitelist, parseWhitelistCsv, whitelistListHash } from "@portus/shared";

const [input, output] = process.argv.slice(2);
if (!input) {
  console.error("usage: merkle <whitelist.csv> [out.json]");
  process.exit(1);
}

const entries = parseWhitelistCsv(readFileSync(input, "utf8"));
const tree = buildWhitelist(entries);
const out = {
  root: tree.root,
  listHash: whitelistListHash(entries),
  count: entries.length,
  entries: [...tree.entries.values()].map((e) => ({ account: e.account, cap: e.cap.toString(), proof: e.proof })),
};
console.log(`accounts: ${out.count}`);
console.log(`root:     ${out.root}`);
if (output) {
  writeFileSync(output, JSON.stringify(out, null, 2) + "\n");
  console.log(`wrote ${output}`);
}
