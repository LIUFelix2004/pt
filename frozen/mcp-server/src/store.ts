import { copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { LocalCommitRecord } from "@obscura/shared";
import { loadConfig } from "./config.js";

/**
 * Local, plaintext store for sealed bids.
 *
 * The salt lives here and nowhere else. It is deliberately not sent to the API:
 * if the operator held salts they could open every sealed bid early, which would
 * defeat the entire commit-reveal design.
 *
 * The consequence is that this file is load-bearing. Lose it between commit and
 * reveal and the bid can never be opened, so the collateral is forfeited. That
 * tradeoff is why the reveal window is generous and why `commit_bid` reports the
 * storage path back to the user.
 *
 * Records are namespaced by (chainId, auction contract). Auction ids restart at
 * #0 on every deployment, so a store keyed on the id alone silently mixes bids
 * across contracts — and the resulting "already committed" on a fresh auction
 * blocks a real bid during a live commit window.
 *
 * ## Legacy directory migration (Agent Launchpad -> Obscura)
 *
 * The state directory moved from ~/.launchpad to ~/.obscura. A user mid-way
 * between commit and reveal has the only copy of their salt in the old place,
 * so we COPY (never move) the old commits.json into the new directory when the
 * new one is missing, and print a one-time notice on stderr. The original is
 * left untouched.
 */
const LEGACY_HOME_DIR = ".launchpad";

function migrateIfNeeded(stateDir: string): void {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  if (!home) return;
  const legacyDir = resolve(home, LEGACY_HOME_DIR);
  const legacyFile = resolve(legacyDir, "commits.json");
  const newFile = resolve(stateDir, "commits.json");
  if (stateDir === legacyDir) return; // explicitly pointed at the old dir
  if (!existsSync(legacyFile) || existsSync(newFile)) return;
  try {
    mkdirSync(stateDir, { recursive: true });
    copyFileSync(legacyFile, newFile);
    console.error(
      `[obscura] migrated bid salts from ${legacyFile} to ${newFile} (copy; original kept). ` +
        `Your sealed bids remain usable.`,
    );
  } catch (error) {
    console.error(`[obscura] failed to migrate ${legacyFile} to ${newFile}:`, error);
  }
}

function storePath(): string {
  const { stateDir } = loadConfig();
  migrateIfNeeded(stateDir);
  mkdirSync(stateDir, { recursive: true });
  return resolve(stateDir, "commits.json");
}

type Db = Record<string, LocalCommitRecord>;

/** Keys written before bids were namespaced: "<auctionId>:<bidder>". */
const LEGACY_KEY = /^\d+:0x[0-9a-fA-F]{40}$/;

function scope(): string {
  const { deployment } = loadConfig();
  return `${deployment.chainId}:${deployment.launchpadAuction.toLowerCase()}`;
}

function key(auctionId: number, bidder: string): string {
  return `${scope()}:${auctionId}:${bidder.toLowerCase()}`;
}

let warnedAboutLegacy = false;

function read(): Db {
  const path = storePath();
  if (!existsSync(path)) return {};
  let db: Db;
  try {
    db = JSON.parse(readFileSync(path, "utf8")) as Db;
  } catch {
    return {};
  }

  // Legacy records are never matched — the contract they belong to is unknown,
  // and guessing wrong means revealing against the wrong auction. Surface them
  // once so a salt that still matters is not lost in silence.
  if (!warnedAboutLegacy) {
    const stale = Object.keys(db).filter((k) => LEGACY_KEY.test(k));
    if (stale.length > 0) {
      warnedAboutLegacy = true;
      console.error(
        `[launchpad-mcp] ${stale.length} bid record(s) in ${path} predate deployment ` +
          `namespacing and cannot be matched to a contract: ${stale.join(", ")}. ` +
          `They are ignored. If one is an unrevealed bid you still need, reveal it ` +
          `manually with its salt before the window closes.`,
      );
    }
  }
  return db;
}

function write(db: Db): void {
  writeFileSync(storePath(), JSON.stringify(db, null, 2) + "\n", { mode: 0o600 });
}

export function saveCommit(record: LocalCommitRecord): string {
  const db = read();
  db[key(record.auctionId, record.bidder)] = record;
  write(db);
  return storePath();
}

export function getCommit(auctionId: number, bidder: string): LocalCommitRecord | null {
  return read()[key(auctionId, bidder)] ?? null;
}

export function markRevealed(auctionId: number, bidder: string, txHash: `0x${string}`): void {
  const db = read();
  const found = db[key(auctionId, bidder)];
  if (!found) return;
  found.revealTxHash = txHash;
  write(db);
}

/** Bids by this account on the currently configured deployment only. */
export function listCommits(bidder: string): LocalCommitRecord[] {
  const prefix = `${scope()}:`;
  return Object.entries(read())
    .filter(([k]) => k.startsWith(prefix))
    .map(([, record]) => record)
    .filter((r) => r.bidder.toLowerCase() === bidder.toLowerCase());
}

export function commitsFilePath(): string {
  return storePath();
}
