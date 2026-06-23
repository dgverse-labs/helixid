import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function sqliteLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (value instanceof Date) return shellQuote(value.toISOString());
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  return shellQuote(String(value));
}

export class SqliteStore {
  private readonly db: Database.Database;

  constructor(public readonly dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.init();
  }

  private init(): void {
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');

    this.db.exec(
      `
CREATE TABLE IF NOT EXISTS dids (
  id TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL,
  controller TEXT NOT NULL,
  public_key TEXT NOT NULL,
  public_key_multibase TEXT,
  hedera_topic_id TEXT,
  hedera_sequence_number INTEGER,
  hedera_transaction_id TEXT NOT NULL,
  did_document TEXT NOT NULL,
  deactivated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dids_public_key ON dids(public_key);
CREATE INDEX IF NOT EXISTS idx_dids_public_key_multibase ON dids(public_key_multibase);

CREATE TABLE IF NOT EXISTS did_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  did_id TEXT NOT NULL,
  update_type TEXT NOT NULL,
  hedera_transaction_id TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vcs (
  vc_id TEXT PRIMARY KEY,
  subject_did TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  vc_json TEXT NOT NULL,
  privilege_scopes TEXT,
  status_list_index INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  renewed_by_vc_id TEXT,
  delegated_from TEXT,
  delegation_depth INTEGER,
  max_delegation_depth INTEGER,
  parent_vc_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vcs_subject_did ON vcs(subject_did);

CREATE TABLE IF NOT EXISTS status_list_entries (
  list_id TEXT PRIMARY KEY,
  encoded_list TEXT NOT NULL,
  next_index INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vp_ids (
  vp_id TEXT PRIMARY KEY,
  agent_did TEXT NOT NULL,
  user_did TEXT NOT NULL,
  target_service TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE TABLE IF NOT EXISTS enrollment_tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  agent_name TEXT NOT NULL,
  requested_scopes TEXT NOT NULL,
  requested_domains TEXT NOT NULL,
  max_delegation_depth INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS challenges (
  id TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL UNIQUE,
  nonce TEXT NOT NULL,
  did TEXT NOT NULL,
  purpose TEXT NOT NULL,
  pending_public_key_hex TEXT,
  pending_domains TEXT,
  pending_did_create_state_json TEXT,
  pending_did_create_payload_hex TEXT,
  expires_at TEXT NOT NULL,
  verified_at TEXT,
  created_at TEXT NOT NULL,
  enrollment_token_id TEXT
);

CREATE TABLE IF NOT EXISTS service_registry (
  id TEXT PRIMARY KEY,
  service_name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  verified_domain TEXT NOT NULL,
  public_key_multibase TEXT NOT NULL,
  api_endpoint TEXT NOT NULL,
  metadata TEXT NOT NULL,
  active INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  event_type TEXT NOT NULL,
  request_id TEXT,
  payload_json TEXT NOT NULL
);
      `.trim(),
    );
  }

  execute(sql: string): void {
    this.db.exec(sql);
  }

  query<T = Record<string, unknown>>(sql: string): T[] {
    return this.db.prepare(sql).all() as T[];
  }
}
