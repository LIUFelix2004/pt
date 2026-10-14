import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from "node:crypto";
import { privateKeyToAccount, toAccount, type Account, type CustomSource } from "viem/accounts";
import type { Hex } from "viem";
import { assertKeyIsSafeForChain, legacyEnv, type Address } from "@obscura/shared";
import { loadConfig } from "./config.js";

/**
 * Signer abstraction. `walletClient()` and `accountAddress()` depend on this
 * interface, not on any concrete key storage. Three implementations:
 *
 * - `env`: plaintext LAUNCHPAD_PRIVATE_KEY (dev only, warns at boot)
 * - `keystore`: scrypt+AES-256-GCM encrypted keystore file; decrypted key lives
 *   only in memory for the lifetime of the process
 * - `external`: signing requests are written as JSON files and an external
 *   signer (hardware wallet / offline machine) fills them back in
 *
 * See docs/key-management.md for the tradeoffs and the EIP-7702 analysis.
 */
export interface Signer {
  readonly kind: "env" | "keystore" | "external";
  /** viem account usable inside createWalletClient({ account }) */
  readonly account: Account | Address;
  /** Human description of where the signing key material lives. */
  readonly description: string;
  address(): Address;
}

export type SignerKind = Signer["kind"];

function deriveKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, 32) as Buffer;
}

export interface KeystorePayload {
  version: 1;
  kind: "keystore";
  kdf: { name: "scrypt"; salt: string; N: number; r: number; p: number };
  cipher: { name: "aes-256-gcm"; iv: string; tag: string };
  address: string;
  ciphertext: string;
}

export function createKeystoreFile(privateKey: Hex, password: string, path: string): KeystorePayload {
  const account = privateKeyToAccount(privateKey);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(password, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(privateKey.slice(2), "hex")), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload: KeystorePayload = {
    version: 1,
    kind: "keystore",
    kdf: { name: "scrypt", salt: salt.toString("hex"), N: 32768, r: 8, p: 1 },
    cipher: { name: "aes-256-gcm", iv: iv.toString("hex"), tag: tag.toString("hex") },
    address: account.address,
    ciphertext: ciphertext.toString("hex"),
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(payload, null, 2) + "\n", { mode: 0o600 });
  return payload;
}

export function decryptKeystoreFile(path: string, password: string): Hex {
  const payload = JSON.parse(readFileSync(path, "utf8")) as KeystorePayload;
  if (payload.kind !== "keystore") throw new Error("not a launchpad keystore");
  const key = deriveKey(password, Buffer.from(payload.kdf.salt, "hex"));
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(payload.cipher.iv, "hex"));
  decipher.setAuthTag(Buffer.from(payload.cipher.tag, "hex"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, "hex")), decipher.final()]);
  return `0x${plaintext.toString("hex")}` as Hex;
}

function safeChain(address: Address): void {
  assertKeyIsSafeForChain(address, loadConfig().deployment.chainId);
}

function envSigner(): Signer {
  const privateKey = legacyEnv("OBSCURA_PRIVATE_KEY", "LAUNCHPAD_PRIVATE_KEY");
  if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error(
      "OBSCURA_SIGNER=env requires OBSCURA_PRIVATE_KEY (0x-prefixed 32-byte hex). " +
        "For production prefer OBSCURA_SIGNER=keystore or OBSCURA_SIGNER=external.",
    );
  }
  console.warn(
    "[obscura-mcp] WARNING: signing with a plaintext OBSCURA_PRIVATE_KEY (dev only). " +
      "Use OBSCURA_SIGNER=keystore or OBSCURA_SIGNER=external for production.",
  );
  const account = privateKeyToAccount(privateKey as Hex);
  safeChain(account.address);
  return { kind: "env", account, description: `env key ${account.address}`, address: () => account.address };
}

function keystoreSigner(keystorePath: string, password: string): Signer {
  const account = privateKeyToAccount(decryptKeystoreFile(keystorePath, password));
  safeChain(account.address);
  return { kind: "keystore", account, description: `keystore ${keystorePath}`, address: () => account.address };
}

/** Offline signing: requests are dropped as JSON files for an external signer to fill and return. */
function externalSigner(requestsDir: string): Signer {
  const address = (legacyEnv("OBSCURA_EXTERNAL_ADDRESS", "LAUNCHPAD_EXTERNAL_ADDRESS") ?? "").toLowerCase() as Address;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new Error("OBSCURA_SIGNER=external requires OBSCURA_EXTERNAL_ADDRESS (the hardware-wallet address)");
  }
  safeChain(address);
  mkdirSync(requestsDir, { recursive: true });
  const roundTrip = (operation: string, payload: Record<string, unknown>): Promise<Hex> => {
    const id = randomBytes(8).toString("hex");
    const requestPath = resolve(requestsDir, `${id}.request.json`);
    const responsePath = resolve(requestsDir, `${id}.response.json`);
    writeFileSync(requestPath, JSON.stringify({ operation, ...payload }, null, 2) + "\n", { mode: 0o600 });
    return new Promise((resolved, rejected) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (!existsSync(responsePath)) {
          if (Date.now() - started > 120_000) {
            clearInterval(timer);
            rejected(new Error(`external signing timed out for ${requestPath}`));
          }
          return;
        }
        clearInterval(timer);
        try {
          const signed = JSON.parse(readFileSync(responsePath, "utf8")) as { signature: Hex };
          resolved(signed.signature);
        } catch (error) {
          rejected(error);
        }
      }, 1000);
    });
  };
  const source: CustomSource = {
    address,
    signMessage: ({ message }) => roundTrip("signMessage", { message }),
    signTransaction: (transaction) => roundTrip("signTransaction", { transaction }),
    signTypedData: (typedData) => roundTrip("signTypedData", { typedData }),
  };
  return { kind: "external", account: toAccount(source), description: `external signer ${address}`, address: () => address };
}

let cachedSigner: Signer | null = null;

export function signer(): Signer {
  if (cachedSigner) return cachedSigner;
  // Ensure the repo .env fallback has been applied before any key is read —
  // signer settings may live there rather than in the MCP host's config.
  loadConfig();
  const kind = (legacyEnv("OBSCURA_SIGNER", "LAUNCHPAD_SIGNER") ?? "env") as SignerKind;
  switch (kind) {
    case "env": cachedSigner = envSigner(); break;
    case "keystore": {
      const path = legacyEnv("OBSCURA_KEYSTORE_PATH", "LAUNCHPAD_KEYSTORE_PATH");
      const password = legacyEnv("OBSCURA_KEYSTORE_PASS", "LAUNCHPAD_KEYSTORE_PASS");
      if (!path) throw new Error("OBSCURA_SIGNER=keystore requires OBSCURA_KEYSTORE_PATH");
      if (!password) throw new Error("OBSCURA_SIGNER=keystore requires OBSCURA_KEYSTORE_PASS");
      cachedSigner = keystoreSigner(path, password);
      break;
    }
    case "external": {
      const dir = legacyEnv("OBSCURA_EXTERNAL_DIR", "LAUNCHPAD_EXTERNAL_DIR") ?? resolve(process.cwd(), ".sign-requests");
      cachedSigner = externalSigner(dir);
      break;
    }
    default: {
      const exhaustive: never = kind;
      throw new Error(`unknown signer kind ${String(exhaustive)}`);
    }
  }
  return cachedSigner;
}

export function accountAddress(): Address {
  return signer().address();
}

export function signerDescription(): string {
  return signer().description;
}

export function signerKind(): SignerKind {
  return signer().kind;
}

/** A keystore is the only place the plaintext key survives; expose a generator for ops tooling. */
export { createKeystoreFile as generateKeystore };
