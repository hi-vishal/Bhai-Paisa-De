import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { join } from 'node:path'
import type { ClaimMethod } from '../shared/claims'
import type { SettlementMethod } from '../shared/ledger'
import type { Asset } from '../shared/money'
import { DATA_DIR } from './config'

export const db = new DatabaseSync(process.env.BPD_DB ?? join(DATA_DIR, 'bhai.sqlite'))
// WAL lets every worker process read while one writes. synchronous=NORMAL is the WAL-safe fast setting:
// a power cut can lose the last commit, never corrupt the file.
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA temp_store = MEMORY;
PRAGMA cache_size = -16000;
PRAGMA mmap_size = 134217728;
`)

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  wallet_kind TEXT,            -- unused since v3 (was: Lightning wallet connection)
  wallet_secret TEXT,
  wallet_alias TEXT,
  wallet_methods TEXT,         -- JSON array the wallet says this connection may call
  wallet_connected_at INTEGER
);
CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  emoji TEXT NOT NULL,
  currency TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,
  group_key TEXT NOT NULL,     -- NIP-44 ledger key; the "backup key"
  simplify INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id),
  name TEXT NOT NULL,
  user_id TEXT REFERENCES users(id),
  position INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (group_id, user_id)
);
CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id),
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  amount INTEGER NOT NULL,
  paid_by TEXT NOT NULL REFERENCES members(id),
  split_mode TEXT NOT NULL,
  split_json TEXT NOT NULL,
  shares_json TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES members(id),
  created_at INTEGER NOT NULL,
  voided_at INTEGER,
  voided_by TEXT
);
CREATE TABLE IF NOT EXISTS settlements (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id),
  from_member TEXT NOT NULL REFERENCES members(id),
  to_member TEXT NOT NULL REFERENCES members(id),
  amount INTEGER NOT NULL,
  method TEXT NOT NULL,        -- upi | manual | kitty (the payee's word) | solana (on-chain proof) | lightning (older)
  note TEXT,
  sats INTEGER,
  payment_hash TEXT,
  preimage TEXT,
  demo INTEGER NOT NULL DEFAULT 0,
  recorded_by TEXT REFERENCES members(id),
  quote_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS paylinks (
  token TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id),
  from_member TEXT NOT NULL REFERENCES members(id),
  to_member TEXT NOT NULL REFERENCES members(id),
  created_by TEXT NOT NULL REFERENCES members(id),
  created_at INTEGER NOT NULL,
  UNIQUE (group_id, from_member, to_member)
);
CREATE TABLE IF NOT EXISTS quotes (
  id TEXT PRIMARY KEY,
  paylink TEXT NOT NULL REFERENCES paylinks(token),
  group_id TEXT NOT NULL,
  from_member TEXT NOT NULL,
  to_member TEXT NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL,
  rate REAL NOT NULL,
  rate_source TEXT NOT NULL,
  sats INTEGER NOT NULL,
  invoice TEXT NOT NULL,
  payment_hash TEXT NOT NULL,
  demo_preimage TEXT,
  status TEXT NOT NULL,        -- pending | paid | expired | rejected
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  checked_at INTEGER,
  settlement_id TEXT,
  note TEXT
);
CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL REFERENCES groups(id),
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  ref_id TEXT,
  event_id TEXT NOT NULL,
  event_json TEXT NOT NULL,
  relays_ok TEXT NOT NULL DEFAULT '[]',
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE (group_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_members_group ON members(group_id);
CREATE INDEX IF NOT EXISTS idx_members_user ON members(user_id);
CREATE INDEX IF NOT EXISTS idx_expenses_group ON expenses(group_id);
CREATE INDEX IF NOT EXISTS idx_settlements_group ON settlements(group_id);
CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status);
CREATE INDEX IF NOT EXISTS idx_ledger_group ON ledger(group_id);
`)

// Schema changes, in order. user_version records how many have run. Never edit one that shipped.
const MIGRATIONS: string[] = [
  // 1: identity keys and sessions, Solana payments, member-signed entries, rate limits shared by workers
  `
  ALTER TABLE users ADD COLUMN pubkey TEXT;
  ALTER TABLE users ADD COLUMN sol_address TEXT;
  ALTER TABLE users ADD COLUMN sol_verified_at INTEGER;
  CREATE UNIQUE INDEX idx_users_pubkey ON users(pubkey) WHERE pubkey IS NOT NULL;
  ALTER TABLE members ADD COLUMN pubkey TEXT;
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label TEXT,
    created_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX idx_sessions_user ON sessions(user_id);
  CREATE TABLE used_challenges (hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
  ALTER TABLE quotes ADD COLUMN asset TEXT NOT NULL DEFAULT 'BTC';
  ALTER TABLE quotes ADD COLUMN base_amount TEXT;
  ALTER TABLE quotes ADD COLUMN recipient TEXT;
  ALTER TABLE quotes ADD COLUMN tx_sig TEXT;
  CREATE INDEX idx_quotes_open ON quotes(status, asset, created_at);
  CREATE INDEX idx_quotes_paylink ON quotes(paylink, status);
  ALTER TABLE settlements ADD COLUMN asset TEXT;
  ALTER TABLE settlements ADD COLUMN base_amount TEXT;
  ALTER TABLE settlements ADD COLUMN tx_sig TEXT;
  CREATE UNIQUE INDEX idx_settlements_tx ON settlements(tx_sig) WHERE tx_sig IS NOT NULL;
  CREATE UNIQUE INDEX idx_settlements_quote ON settlements(quote_id) WHERE quote_id IS NOT NULL;
  ALTER TABLE ledger ADD COLUMN signer TEXT;
  CREATE INDEX idx_ledger_unpublished ON ledger(id) WHERE relays_ok = '[]';
  CREATE TABLE rate_limits (key TEXT PRIMARY KEY, n INTEGER NOT NULL, reset INTEGER NOT NULL);
  `,
  // 2: web push subscriptions ("Om paid you")
  `
  CREATE TABLE push_subs (
    endpoint TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_push_user ON push_subs(user_id);
  `,
  // 3: UPI, "I've paid" claims, group chat, kitty, photos, receipts, phone linking, invites, repeating bills
  `
  UPDATE users SET wallet_kind = NULL, wallet_secret = NULL, wallet_alias = NULL, wallet_methods = NULL, wallet_connected_at = NULL;
  ALTER TABLE users ADD COLUMN upi_id TEXT;
  ALTER TABLE users ADD COLUMN avatar_v INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE members ADD COLUMN invited_user TEXT REFERENCES users(id);
  CREATE INDEX idx_members_invited ON members(invited_user) WHERE invited_user IS NOT NULL;
  ALTER TABLE groups ADD COLUMN kitty_holder TEXT;
  ALTER TABLE groups ADD COLUMN kitty_target INTEGER;
  ALTER TABLE expenses ADD COLUMN from_kitty INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE expenses ADD COLUMN has_receipt INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE settlements ADD COLUMN ref TEXT;
  CREATE TABLE avatars (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    data BLOB NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE receipts (
    expense_id TEXT PRIMARY KEY REFERENCES expenses(id),
    group_id TEXT NOT NULL,
    data BLOB NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE claims (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES groups(id),
    from_member TEXT NOT NULL REFERENCES members(id),
    to_member TEXT NOT NULL REFERENCES members(id),
    amount INTEGER NOT NULL,
    method TEXT NOT NULL,        -- upi | cash | bank | other | kitty
    ref TEXT,
    status TEXT NOT NULL,        -- pending | confirmed | rejected | cancelled
    via TEXT NOT NULL,           -- app | link
    created_at INTEGER NOT NULL,
    decided_at INTEGER,
    settlement_id TEXT
  );
  CREATE INDEX idx_claims_group ON claims(group_id, status);
  CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id TEXT NOT NULL REFERENCES groups(id),
    member_id TEXT,              -- NULL: written by the app (a bill, a payment, someone joining)
    kind TEXT NOT NULL,          -- text | event
    body TEXT NOT NULL,
    meta TEXT,
    client_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,   -- bumps on a reaction or a delete, so phones can refresh what they show
    deleted_at INTEGER
  );
  CREATE INDEX idx_messages_group ON messages(group_id, id);
  CREATE INDEX idx_messages_updated ON messages(group_id, updated_at);
  CREATE UNIQUE INDEX idx_messages_client ON messages(group_id, member_id, client_id) WHERE client_id IS NOT NULL;
  CREATE TABLE reactions (
    message_id INTEGER NOT NULL REFERENCES messages(id),
    member_id TEXT NOT NULL,
    emoji TEXT NOT NULL,
    PRIMARY KEY (message_id, member_id)
  );
  CREATE TABLE chat_reads (member_id TEXT PRIMARY KEY REFERENCES members(id), last_read INTEGER NOT NULL);
  CREATE TABLE device_links (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blob TEXT NOT NULL,          -- encrypted on the old phone; the key is only in the QR
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER
  );
  CREATE TABLE recurring (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES groups(id),
    member_id TEXT NOT NULL REFERENCES members(id),
    template TEXT NOT NULL,
    every TEXT NOT NULL,         -- week | month
    next_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    stopped_at INTEGER
  );
  CREATE INDEX idx_recurring_member ON recurring(member_id);
  CREATE TABLE nudges (from_member TEXT NOT NULL, to_member TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (from_member, to_member));
  CREATE TABLE push_log (user_id TEXT NOT NULL, topic TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (user_id, topic));
  `,
]

/** Bring the schema up to date. Safe to call from several processes at once. */
export function migrate() {
  const version = () => (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
  if (version() >= MIGRATIONS.length) return
  db.exec('BEGIN IMMEDIATE')
  try {
    for (let v = version(); v < MIGRATIONS.length; v++) {
      db.exec(MIGRATIONS[v])
      db.exec(`PRAGMA user_version = ${v + 1}`)
    }
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}
migrate()

const cache = new Map<string, ReturnType<DatabaseSync['prepare']>>()
const stmt = (sql: string) => {
  let s = cache.get(sql)
  if (!s) cache.set(sql, (s = db.prepare(sql)))
  return s
}

export const q = {
  get: <T = Record<string, unknown>>(sql: string, ...params: SQLInputValue[]) => stmt(sql).get(...params) as T | undefined,
  all: <T = Record<string, unknown>>(sql: string, ...params: SQLInputValue[]) => stmt(sql).all(...params) as T[],
  run: (sql: string, ...params: SQLInputValue[]) => stmt(sql).run(...params),
}

let depth = 0
/** Run fn atomically. Nested calls join the outer transaction. */
export function tx<T>(fn: () => T): T {
  if (depth > 0) return fn()
  db.exec('BEGIN IMMEDIATE')
  depth++
  try {
    const out = fn()
    db.exec('COMMIT')
    return out
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  } finally {
    depth--
  }
}

export type UserRow = {
  id: string
  name: string
  token_hash: string
  created_at: number
  pubkey: string | null
  sol_address: string | null
  sol_verified_at: number | null
  upi_id: string | null
  avatar_v: number
}
export type SessionRow = { id: string; token_hash: string; user_id: string; label: string | null; created_at: number; last_seen: number; expires_at: number }
export type GroupRow = {
  id: string
  name: string
  emoji: string
  currency: string
  created_by: string
  created_at: number
  invite_code: string
  group_key: string
  simplify: number
  kitty_holder: string | null
  kitty_target: number | null
}
export type MemberRow = { id: string; group_id: string; name: string; user_id: string | null; position: number; created_at: number; pubkey: string | null; invited_user: string | null }
export type ExpenseRow = {
  id: string
  group_id: string
  description: string
  category: string
  amount: number
  paid_by: string
  split_mode: string
  split_json: string
  shares_json: string
  created_by: string
  created_at: number
  voided_at: number | null
  voided_by: string | null
  from_kitty: number
  has_receipt: number
}
export type SettlementRow = {
  id: string
  group_id: string
  from_member: string
  to_member: string
  amount: number
  method: SettlementMethod
  note: string | null
  sats: number | null
  payment_hash: string | null
  preimage: string | null
  demo: number
  recorded_by: string | null
  quote_id: string | null
  created_at: number
  asset: Asset | null
  base_amount: string | null
  tx_sig: string | null
  ref: string | null
}
export type ClaimRow = {
  id: string
  group_id: string
  from_member: string
  to_member: string
  amount: number
  method: ClaimMethod
  ref: string | null
  status: 'pending' | 'confirmed' | 'rejected' | 'cancelled'
  via: 'app' | 'link'
  created_at: number
  decided_at: number | null
  settlement_id: string | null
}
export type MessageRow = { id: number; group_id: string; member_id: string | null; kind: 'text' | 'event'; body: string; meta: string | null; client_id: string | null; created_at: number; updated_at: number; deleted_at: number | null }
export type RecurringRow = { id: string; group_id: string; member_id: string; template: string; every: 'week' | 'month'; next_at: number; created_at: number; stopped_at: number | null }
export type QuoteRow = {
  id: string
  paylink: string
  group_id: string
  from_member: string
  to_member: string
  amount: number
  currency: string
  rate: number
  rate_source: string
  sats: number
  invoice: string
  payment_hash: string
  demo_preimage: string | null
  status: 'pending' | 'paid' | 'expired' | 'rejected'
  created_at: number
  expires_at: number
  checked_at: number | null
  settlement_id: string | null
  note: string | null
  asset: Asset
  base_amount: string | null
  recipient: string | null
  tx_sig: string | null
}
export type PaylinkRow = { token: string; group_id: string; from_member: string; to_member: string; created_by: string; created_at: number }
export type LedgerRow = {
  id: number
  group_id: string
  seq: number
  type: string
  ref_id: string | null
  event_id: string
  event_json: string
  relays_ok: string
  attempts: number
  created_at: number
  signer: string | null
}
