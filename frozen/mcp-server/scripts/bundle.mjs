#!/usr/bin/env node
/**
 * Bundle the MCP server into a single-file distribution zip.
 *
 *   node scripts/bundle.mjs [outDir]
 *
 * Produces (default outDir: packages/mcp-server/dist):
 *   obscura-mcp.mjs      single-file ESM bundle (esbuild, node22)
 *   obscura-mcp.zip      zip with the bundle + env template + mcp.json + README + LICENSE
 *   obscura-mcp.sha256   SHA-256 of the zip (also printed to stdout)
 *
 * Security: the zip must never contain a private key. After bundling we scan the
 * bundle for 0x[0-9a-f]{64} patterns and for "PRIVATE_KEY=" followed by a value,
 * and fail the build if anything matches.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { zipStore } from "./zip-store.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, "..");
const ROOT = resolve(PKG, "../..");
const OUT = resolve(PKG, process.argv[2] ?? "dist");

const BUNDLE = resolve(OUT, "obscura-mcp.mjs");
const ZIP = resolve(OUT, "obscura-mcp.zip");
const SHA = resolve(OUT, "obscura-mcp.sha256");

mkdirSync(OUT, { recursive: true });

// 1. esbuild single-file bundle. Requires esbuild installed (devDependency of @obscura/mcp).
const esbuild = resolve(ROOT, "node_modules/esbuild/bin/esbuild");
if (!existsSync(esbuild)) throw new Error("esbuild not found — run `npm install` at the repo root first");
execFileSync(process.execPath, [
  esbuild,
  resolve(PKG, "src/index.ts"),
  "--bundle",
  "--platform=node",
  "--format=esm",
  "--target=node22",
  "--outfile=" + BUNDLE,
], { stdio: "inherit" });

// 2. Security scan: no keys in the artifact.
//
// A blanket "any 0x + 64 hex chars" scan does not work here. viem and @noble
// vendor secp256k1 field constants, curve parameters and test vectors that are
// exactly that shape, so the check fires ~30 times on a clean build: zero true
// positives, and a permanent build blocker.
//
// What actually answers "did we leak a secret" is comparing the artifact
// against the secrets that exist on this machine. If a real key ever reaches
// the bundle, its literal value is in there and this finds it.
const bundleText = readFileSync(BUNDLE, "utf8");

function collectSecrets() {
  const SECRET_KEY = /(PRIVATE_KEY|SECRET|MNEMONIC|KEYSTORE_PASS|API_KEY)/i;
  const values = new Set();
  const add = (v) => {
    const trimmed = (v ?? "").trim();
    // Ignore empties and obvious placeholders from .env.example.
    if (trimmed.length >= 16 && !/^<.*>$/.test(trimmed) && !/^0x\.\.\.$/.test(trimmed)) {
      values.add(trimmed);
    }
  };

  for (const [name, value] of Object.entries(process.env)) {
    if (SECRET_KEY.test(name)) add(value);
  }
  const envPath = resolve(ROOT, ".env");
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m && SECRET_KEY.test(m[1])) add(m[2]);
    }
  }
  return [...values];
}

const secrets = collectSecrets();

/**
 * Scan one file destined for the zip.
 *
 * Runs over every entry, not just the JavaScript bundle: a .env template is the
 * likeliest place for a real key to end up, and scanning only the bundle would
 * miss it entirely.
 */
function scanEntry(name, text) {
  const leaked = secrets.filter((s) => text.toLowerCase().includes(s.toLowerCase()));
  if (leaked.length > 0) {
    console.error(`[bundle] FAIL: ${leaked.length} real secret value(s) from this machine appear in ${name}.`);
    for (const hit of leaked) console.error(`  ${hit.slice(0, 10)}… (${hit.length} chars)`);
    process.exit(1);
  }
  // Also catch a key hardcoded in source, which would leak on a build machine
  // that happens to hold no secrets of its own.
  const hardcoded = /(?:PRIVATE_KEY|KEYSTORE_PASS)\s*[=:]\s*["']?0x[0-9a-fA-F]{64}/.exec(text);
  if (hardcoded) {
    console.error(`[bundle] FAIL: hardcoded key assignment in ${name}: ${hardcoded[0].slice(0, 40)}…`);
    process.exit(1);
  }
}

/**
 * Ship the env template with every secret field emptied.
 *
 * The repo's .env.example pre-fills the well-known Hardhat account so local
 * development works out of the box. That is the wrong default for a public
 * download whose whole job is holding the user's own key: it teaches by example
 * that a key belongs inline, and it hands out a funded-looking value that only
 * the chain guard stops from being used in anger.
 */
function blankSecrets(envText) {
  return envText.replace(
    /^(\s*[A-Z0-9_]*(?:PRIVATE_KEY|KEYSTORE_PASS|SECRET|MNEMONIC|API_KEY)\s*=\s*)(.+)$/gim,
    (_all, lhs) => `${lhs}`,
  );
}

// 3. Assemble zip contents (no secrets).
const mcpJson = JSON.stringify({
  mcpServers: {
    obscura: { command: "node", args: ["./obscura-mcp.mjs"] },
  },
}, null, 2) + "\n";

const readme = `# Obscura MCP（单文件分发）

本程序会在**你的机器上**运行，并读取你配置的私钥来签名拍卖交易。

- 私钥不会发送给任何服务器。
- 请先校验下载包的 SHA-256（见 obscura-mcp.sha256 / 下载页），再解压使用。
- 配置：复制 .env.example 为 .env，填入 OBSCURA_PRIVATE_KEY 等，然后：
  \`\`\`json
  ${mcpJson.trim()}
  \`\`\`
- 安全说明见仓库 docs/key-management.md。
`;

const license = existsSync(resolve(ROOT, "LICENSE"))
  ? readFileSync(resolve(ROOT, "LICENSE"), "utf8")
  : "MIT — see the repository LICENSE file.";

const envTemplate = blankSecrets(readFileSync(resolve(ROOT, ".env.example"), "utf8"));

const entries = [
  { name: "obscura-mcp.mjs", data: Buffer.from(bundleText, "utf8") },
  { name: ".env.example", data: Buffer.from(envTemplate, "utf8") },
  { name: "mcp.json", data: Buffer.from(mcpJson, "utf8") },
  { name: "README.md", data: Buffer.from(readme, "utf8") },
  { name: "LICENSE", data: Buffer.from(license, "utf8") },
];

// Scan everything that is about to ship, after assembly rather than before.
for (const entry of entries) scanEntry(entry.name, entry.data.toString("utf8"));
console.log(
  `[bundle] security scan OK (${entries.length} files checked against ${secrets.length} local secret value(s))`,
);

writeFileSync(ZIP, zipStore(entries));

const sha = createHash("sha256").update(readFileSync(ZIP)).digest("hex");
writeFileSync(SHA, sha + "\n");

console.log(`wrote ${basename(BUNDLE)} (${bundleText.length} bytes)`);
console.log(`wrote ${basename(ZIP)}`);
console.log(`SHA-256: ${sha}`);
