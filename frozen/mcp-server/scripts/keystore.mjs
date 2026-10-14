#!/usr/bin/env node
/**
 * Keystore tooling for OBSCURA_SIGNER=keystore.
 *
 *   create   writes a scrypt+AES-256-GCM keystore from OBSCURA_PRIVATE_KEY
 *   verify   decrypts OBSCURA_KEYSTORE_PATH with OBSCURA_KEYSTORE_PASS and
 *            prints the derived address (never the key)
 *
 * Legacy LAUNCHPAD_* names are also accepted.
 *
 * Run from packages/mcp-server after `npm run build` (imports ../dist/signer.js).
 */
import { createKeystoreFile, decryptKeystoreFile } from "../dist/signer.js";
import { privateKeyToAccount } from "viem/accounts";

const legacy = (fresh, old) => process.env[fresh] ?? process.env[old];

const command = process.argv[2];
const path = legacy("OBSCURA_KEYSTORE_PATH", "LAUNCHPAD_KEYSTORE_PATH");
const password = legacy("OBSCURA_KEYSTORE_PASS", "LAUNCHPAD_KEYSTORE_PASS");
const privateKey = legacy("OBSCURA_PRIVATE_KEY", "LAUNCHPAD_PRIVATE_KEY");

if (command === "create") {
  if (!path || !password || !privateKey) {
    console.error("create requires OBSCURA_KEYSTORE_PATH, OBSCURA_KEYSTORE_PASS, OBSCURA_PRIVATE_KEY");
    process.exit(1);
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    console.error("OBSCURA_PRIVATE_KEY must be 0x-prefixed 32-byte hex");
    process.exit(1);
  }
  const payload = createKeystoreFile(privateKey, password, path);
  console.log(`wrote ${path}`);
  console.log(`address ${payload.address}`);
} else if (command === "verify") {
  if (!path || !password) {
    console.error("verify requires OBSCURA_KEYSTORE_PATH and OBSCURA_KEYSTORE_PASS");
    process.exit(1);
  }
  const key = decryptKeystoreFile(path, password);
  console.log(`address ${privateKeyToAccount(key).address}`);
} else {
  console.error("usage: keystore.mjs create|verify");
  process.exit(1);
}
