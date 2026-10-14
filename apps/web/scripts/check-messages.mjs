/**
 * Message parity check.
 *
 * next-intl falls back to the default locale for a missing key at runtime, which
 * means a half-translated release ships silently and only shows up as stray
 * English in front of a Chinese reader. Comparing key sets here turns that into
 * a build failure instead.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../messages");

function flatten(obj, prefix = "") {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) out.push(...flatten(v, key));
    else out.push(key);
  }
  return out;
}

const locales = readdirSync(DIR).filter((f) => f.endsWith(".json"));
const keys = new Map(
  locales.map((f) => [f.replace(".json", ""), new Set(flatten(JSON.parse(readFileSync(resolve(DIR, f), "utf8"))))]),
);

const [base, ...rest] = [...keys.keys()];
let failures = 0;

for (const other of rest) {
  const missing = [...keys.get(base)].filter((k) => !keys.get(other).has(k));
  const extra = [...keys.get(other)].filter((k) => !keys.get(base).has(k));
  for (const k of missing) {
    failures++;
    console.error(`FAIL  ${other}.json is missing "${k}" (present in ${base}.json)`);
  }
  for (const k of extra) {
    failures++;
    console.error(`FAIL  ${other}.json has extra key "${k}" (absent from ${base}.json)`);
  }
}

console.log(
  failures === 0
    ? `messages OK — ${keys.get(base).size} keys, ${locales.length} locales in sync`
    : `${failures} message key problem(s)`,
);
process.exit(failures === 0 ? 0 : 1);
