import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * Event index plus creator-signed off-chain data (copy, whitelist proofs).
 *
 * The chain stays the source of truth: every launch fact here is rebuilt from
 * events, replay is idempotent (indexed_events), and nothing stored here can
 * move funds. Amounts are decimal strings — never JS numbers.
 */

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db) return db;
  const path = resolve(process.env.DATABASE_PATH ?? "./data/portus.sqlite");
  mkdirSync(dirname(path), { recursive: true });
  db = new DatabaseSync(path);
  db.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS quote_assets (
      chain_id INTEGER NOT NULL, address TEXT NOT NULL,
      allowed INTEGER NOT NULL, freezable INTEGER NOT NULL, decimals INTEGER NOT NULL,
      min_fdv TEXT NOT NULL, max_fdv TEXT NOT NULL, symbol TEXT,
      PRIMARY KEY (chain_id, address));

    CREATE TABLE IF NOT EXISTS launches (
      chain_id INTEGER NOT NULL, token TEXT NOT NULL, launch_id INTEGER NOT NULL,
      creator TEXT NOT NULL, sale TEXT NOT NULL, pool TEXT NOT NULL, quote_asset TEXT NOT NULL,
      raise_target TEXT NOT NULL, q_sale TEXT NOT NULL, q_lp TEXT NOT NULL, q_inc TEXT NOT NULL,
      price_num TEXT NOT NULL, price_den TEXT NOT NULL,
      fee_bps INTEGER NOT NULL DEFAULT 0, creator_share_bps INTEGER NOT NULL DEFAULT 0,
      incentive_bps INTEGER NOT NULL DEFAULT 0,
      start_time INTEGER NOT NULL DEFAULT 0, end_time INTEGER NOT NULL DEFAULT 0,
      public_open_at INTEGER NOT NULL DEFAULT 0, public_cap TEXT NOT NULL DEFAULT '0',
      merkle_root TEXT NOT NULL DEFAULT '0x0000000000000000000000000000000000000000000000000000000000000000',
      under_rule INTEGER NOT NULL DEFAULT 0, min_fill_bps INTEGER NOT NULL DEFAULT 0,
      treasury_mode INTEGER NOT NULL DEFAULT 0,
      metadata_hash TEXT NOT NULL DEFAULT '0x0000000000000000000000000000000000000000000000000000000000000000',
      total_committed TEXT NOT NULL DEFAULT '0', subscriber_count INTEGER NOT NULL DEFAULT 0,
      claimed_count INTEGER NOT NULL DEFAULT 0,
      outcome INTEGER NOT NULL DEFAULT 0,
      pool_quote TEXT, pool_tokens TEXT, tokens_burned TEXT, quote_dust TEXT, incentive_funded TEXT,
      reserve_quote TEXT, reserve_token TEXT, last_swap_block TEXT,
      fees_quote TEXT NOT NULL DEFAULT '0', dust_swept INTEGER NOT NULL DEFAULT 0,
      token_name TEXT, token_symbol TEXT,
      created_block TEXT NOT NULL, created_tx TEXT NOT NULL,
      PRIMARY KEY (chain_id, token));
    CREATE UNIQUE INDEX IF NOT EXISTS launches_sale ON launches(chain_id, sale);
    CREATE UNIQUE INDEX IF NOT EXISTS launches_pool ON launches(chain_id, pool);
    CREATE INDEX IF NOT EXISTS launches_id ON launches(chain_id, launch_id);

    CREATE TABLE IF NOT EXISTS subscriptions (
      chain_id INTEGER NOT NULL, token TEXT NOT NULL, account TEXT NOT NULL,
      committed TEXT NOT NULL, whitelist_committed TEXT NOT NULL, public_committed TEXT NOT NULL,
      claimed INTEGER NOT NULL DEFAULT 0, tokens_claimed TEXT, refund_claimed TEXT,
      PRIMARY KEY (chain_id, token, account));

    CREATE TABLE IF NOT EXISTS swaps (
      chain_id INTEGER NOT NULL, pool TEXT NOT NULL, block_number TEXT NOT NULL, log_index INTEGER NOT NULL,
      tx_hash TEXT NOT NULL, ts INTEGER NOT NULL, trader TEXT NOT NULL, recipient TEXT NOT NULL,
      is_buy INTEGER NOT NULL, amount_in TEXT NOT NULL, amount_out TEXT NOT NULL, fee_quote TEXT NOT NULL,
      reserve_quote TEXT NOT NULL, reserve_token TEXT NOT NULL,
      PRIMARY KEY (chain_id, pool, block_number, log_index));
    CREATE INDEX IF NOT EXISTS swaps_ts ON swaps(chain_id, pool, ts);

    CREATE TABLE IF NOT EXISTS whitelist_entries (
      chain_id INTEGER NOT NULL, token TEXT NOT NULL, account TEXT NOT NULL,
      cap TEXT NOT NULL, proof_json TEXT NOT NULL,
      PRIMARY KEY (chain_id, token, account));

    CREATE TABLE IF NOT EXISTS launch_copy (
      chain_id INTEGER NOT NULL, token TEXT NOT NULL,
      name TEXT NOT NULL, symbol TEXT NOT NULL, description TEXT NOT NULL,
      docs_url TEXT, image_url TEXT, copy_hash TEXT NOT NULL, updated_at INTEGER NOT NULL,
      PRIMARY KEY (chain_id, token));

    CREATE TABLE IF NOT EXISTS used_sig_nonces (
      chain_id INTEGER NOT NULL, factory TEXT NOT NULL, signer TEXT NOT NULL, nonce TEXT NOT NULL,
      kind TEXT NOT NULL, token TEXT NOT NULL, payload_hash TEXT NOT NULL, used_at INTEGER NOT NULL,
      PRIMARY KEY (chain_id, factory, signer, nonce));

    CREATE TABLE IF NOT EXISTS indexed_events (
      chain_id INTEGER NOT NULL, contract_address TEXT NOT NULL,
      block_number TEXT NOT NULL, log_index INTEGER NOT NULL,
      PRIMARY KEY (chain_id, contract_address, block_number, log_index));

    CREATE TABLE IF NOT EXISTS reward_epochs (
      chain_id INTEGER NOT NULL, token TEXT NOT NULL, asset TEXT NOT NULL, epoch INTEGER NOT NULL,
      root TEXT NOT NULL, total TEXT NOT NULL, claimed TEXT NOT NULL DEFAULT '0',
      claimable_at INTEGER NOT NULL, data_uri TEXT NOT NULL,
      PRIMARY KEY (chain_id, token, asset, epoch));

    CREATE TABLE IF NOT EXISTS indexer_progress (
      chain_id INTEGER NOT NULL, contract_address TEXT NOT NULL, indexed_block TEXT NOT NULL,
      PRIMARY KEY (chain_id, contract_address));

    CREATE TABLE IF NOT EXISTS referrals (
      chain_id INTEGER NOT NULL, account TEXT NOT NULL, referrer TEXT NOT NULL,
      bound_at INTEGER NOT NULL, bound_block TEXT NOT NULL, tx_hash TEXT NOT NULL,
      PRIMARY KEY (chain_id, account));
    CREATE INDEX IF NOT EXISTS referrals_referrer ON referrals(chain_id, referrer);
  `);
  migrate(db);
  return db;
}

/** Columns added after the first Portus schema; added in place on older databases. */
const LAUNCH_COLUMNS: Array<[string, string]> = [
  ["treasury", "TEXT"],
  ["creator_recipient", "TEXT"],
  ["release_mode", "INTEGER NOT NULL DEFAULT 0"],
  ["release_rate_bps", "INTEGER NOT NULL DEFAULT 0"],
  ["fees_ecosystem", "TEXT NOT NULL DEFAULT '0'"],
  ["fees_flywheel", "TEXT NOT NULL DEFAULT '0'"],
  ["fees_creator", "TEXT NOT NULL DEFAULT '0'"],
  ["fees_treasury", "TEXT NOT NULL DEFAULT '0'"],
  ["buyback_quote", "TEXT NOT NULL DEFAULT '0'"],
  ["buyback_burned", "TEXT NOT NULL DEFAULT '0'"],
  ["flywheel_quote", "TEXT NOT NULL DEFAULT '0'"],
  ["flywheel_burned", "TEXT NOT NULL DEFAULT '0'"],
  ["rewards_funded", "TEXT NOT NULL DEFAULT '0'"],
  ["incentive_start", "INTEGER NOT NULL DEFAULT 0"],
  // Mint mode: config JSON (supply, schedule, tax), running totals.
  ["mint_config", "TEXT"],
  ["minted_total", "TEXT NOT NULL DEFAULT '0'"],
  ["tax_burned", "TEXT NOT NULL DEFAULT '0'"],
  ["tax_paid", "TEXT NOT NULL DEFAULT '0'"],
];
const QUOTE_COLUMNS: Array<[string, string]> = [
  ["price_source", "TEXT"],
  ["min_pool_liquidity", "TEXT NOT NULL DEFAULT '0'"],
];

function migrate(database: DatabaseSync) {
  const add = (table: string, cols: Array<[string, string]>) => {
    const have = new Set((database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name));
    for (const [name, type] of cols) if (!have.has(name)) database.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  };
  add("launches", LAUNCH_COLUMNS);
  add("quote_assets", QUOTE_COLUMNS);
  database.exec("CREATE UNIQUE INDEX IF NOT EXISTS launches_treasury ON launches(chain_id, treasury)");
  database.exec(`CREATE TABLE IF NOT EXISTS referrals (
      chain_id INTEGER NOT NULL, account TEXT NOT NULL, referrer TEXT NOT NULL,
      bound_at INTEGER NOT NULL, bound_block TEXT NOT NULL, tx_hash TEXT NOT NULL,
      PRIMARY KEY (chain_id, account))`);
  database.exec("CREATE INDEX IF NOT EXISTS referrals_referrer ON referrals(chain_id, referrer)");
}

export function closeDb(): void {
  db?.close();
  db = null;
}

/** Run `fn` inside one IMMEDIATE transaction. */
export function transaction<T>(fn: (database: DatabaseSync) => T): T {
  const database = getDb();
  database.exec("BEGIN IMMEDIATE");
  try {
    const out = fn(database);
    database.exec("COMMIT");
    return out;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

// ─── creator-signed data ─────────────────────────────────────────────────────

export interface LaunchCopyRow {
  token: string;
  name: string;
  symbol: string;
  description: string;
  docs_url: string | null;
  image_url: string | null;
  copy_hash: string;
}

export class NonceAlreadyUsedError extends Error {
  constructor() {
    super("authorization nonce already used");
    this.name = "NonceAlreadyUsedError";
  }
}

export interface NonceUse {
  chainId: number;
  factory: string;
  signer: string;
  nonce: string;
  kind: "copy" | "whitelist";
  token: string;
  payloadHash: string;
}

function consumeNonce(database: DatabaseSync, n: NonceUse) {
  try {
    database
      .prepare(`INSERT INTO used_sig_nonces VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        n.chainId,
        n.factory.toLowerCase(),
        n.signer.toLowerCase(),
        n.nonce.toLowerCase(),
        n.kind,
        n.token.toLowerCase(),
        n.payloadHash,
        Date.now(),
      );
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) throw new NonceAlreadyUsedError();
    throw error;
  }
}

/** Atomically consume the authorization nonce and write the copy. */
export function consumeNonceAndUpsertCopy(chainId: number, row: LaunchCopyRow, nonce: NonceUse): void {
  transaction((database) => {
    consumeNonce(database, nonce);
    database
      .prepare(
        `INSERT INTO launch_copy (chain_id, token, name, symbol, description, docs_url, image_url, copy_hash, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(chain_id, token) DO UPDATE SET
           name = excluded.name, symbol = excluded.symbol, description = excluded.description,
           docs_url = excluded.docs_url, image_url = excluded.image_url,
           copy_hash = excluded.copy_hash, updated_at = excluded.updated_at`,
      )
      .run(chainId, row.token.toLowerCase(), row.name, row.symbol, row.description, row.docs_url, row.image_url, row.copy_hash, Date.now());
  });
}

/** Unsigned write, for local seeding only. */
export function upsertCopyUnsigned(chainId: number, row: LaunchCopyRow): void {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO launch_copy (chain_id, token, name, symbol, description, docs_url, image_url, copy_hash, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(chainId, row.token.toLowerCase(), row.name, row.symbol, row.description, row.docs_url, row.image_url, row.copy_hash, Date.now());
}

export function getCopy(chainId: number, token: string): LaunchCopyRow | null {
  const row = getDb()
    .prepare("SELECT token, name, symbol, description, docs_url, image_url, copy_hash FROM launch_copy WHERE chain_id = ? AND token = ?")
    .get(chainId, token.toLowerCase()) as unknown as LaunchCopyRow | undefined;
  return row ?? null;
}

export function allCopy(chainId: number): Map<string, LaunchCopyRow> {
  const rows = getDb()
    .prepare("SELECT token, name, symbol, description, docs_url, image_url, copy_hash FROM launch_copy WHERE chain_id = ?")
    .all(chainId) as unknown as LaunchCopyRow[];
  return new Map(rows.map((r) => [r.token, r]));
}

export interface WhitelistRow {
  account: string;
  cap: string;
  proof: string[];
}

/** Replace a launch's whitelist atomically, consuming the upload nonce. */
export function consumeNonceAndReplaceWhitelist(
  chainId: number,
  token: string,
  entries: WhitelistRow[],
  nonce: NonceUse,
): void {
  transaction((database) => {
    consumeNonce(database, nonce);
    database.prepare("DELETE FROM whitelist_entries WHERE chain_id = ? AND token = ?").run(chainId, token.toLowerCase());
    const insert = database.prepare("INSERT INTO whitelist_entries VALUES (?, ?, ?, ?, ?)");
    for (const e of entries) {
      insert.run(chainId, token.toLowerCase(), e.account.toLowerCase(), e.cap, JSON.stringify(e.proof));
    }
  });
}

export function getWhitelistEntry(chainId: number, token: string, account: string): WhitelistRow | null {
  const row = getDb()
    .prepare("SELECT account, cap, proof_json FROM whitelist_entries WHERE chain_id = ? AND token = ? AND account = ?")
    .get(chainId, token.toLowerCase(), account.toLowerCase()) as { account: string; cap: string; proof_json: string } | undefined;
  return row ? { account: row.account, cap: row.cap, proof: JSON.parse(row.proof_json) as string[] } : null;
}

export function whitelistCount(chainId: number, token: string): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM whitelist_entries WHERE chain_id = ? AND token = ?")
    .get(chainId, token.toLowerCase()) as { n: number };
  return Number(row.n);
}
