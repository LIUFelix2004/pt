import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { createKeystoreFile, decryptKeystoreFile } from "./signer.js";

const PRIVATE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;

describe("keystore signer", () => {
  const directory = mkdtempSync(join(tmpdir(), "launchpad-keystore-"));
  const path = join(directory, "signer.keystore");

  it("round-trips the private key with the correct password", () => {
    createKeystoreFile(PRIVATE_KEY, "correct horse", path);
    const decrypted = decryptKeystoreFile(path, "correct horse");
    assert.equal(decrypted.toLowerCase(), PRIVATE_KEY.toLowerCase());
    assert.equal(privateKeyToAccount(decrypted).address, privateKeyToAccount(PRIVATE_KEY).address);
  });

  it("rejects a wrong password", () => {
    assert.throws(() => decryptKeystoreFile(path, "wrong password"));
  });

  it("never stores the plaintext key in the file", () => {
    const raw = readFileSync(path, "utf8");
    assert.equal(raw.includes(PRIVATE_KEY.slice(2).toLowerCase()), false);
  });

  after(() => rmSync(directory, { recursive: true, force: true }));
});
