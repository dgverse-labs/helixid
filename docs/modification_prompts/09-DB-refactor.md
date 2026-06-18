Refactor the HelixID codebase to make the database and Redis dependencies fully optional, using a pluggable storage adapter pattern.
Database: Define a StorageAdapter interface with methods covering the two core operations: credential registry (saveCredential, getCredential, revokeCredential, listCredentials) and audit log (appendAuditEvent, queryAuditLog). Implement three adapters: JsonFileAdapter (credentials.json + audit.log, default, zero infra), SqliteAdapter (single-file SQLite, no server needed), and PostgresAdapter (existing Prisma-based implementation, production). The adapter is selected via HELIX_STORAGE_ADAPTER=json|sqlite|postgres env var, defaulting to json. Remove Postgres as a hard dependency — it becomes one option among three.
Redis: Define a CacheAdapter interface covering get, set, delete, and exists. Implement two adapters: InMemoryAdapter (default, single-instance, no infra) and RedisAdapter (existing implementation, opt-in for multi-instance). Selected via HELIX_CACHE_ADAPTER=memory|redis env var, defaulting to memory. vpId replay protection stays as an interface the verifier implements — remove any assumption that HelixID owns that store.
Deployment matrix: After the refactor, the following should work with zero infra (no Postgres, no Redis): npm install @helix-id/sdk-js, CLI-based DID creation and VC issuance, VP verification, StatusList revocation. SQLite should work with a single HELIX_STORAGE_ADAPTER=sqlite env var and no other config. Postgres + Redis should remain the production path unchanged.
Knock-on changes: Update docker-compose.yml to make Postgres and Redis optional services. Update .env.example to reflect the new env vars with json and memory as defaults. If the README or CONSTITUTION reference Postgres or Redis as required dependencies, update those sections to reflect that they are now optional — the default path requires neither. Keep changes to README and CONSTITUTION minimal and accurate — only what the code change actually justifies.

Preferred schema, check correctness before implementation
-- who has been issued what
credentials (
  vc_id          text primary key,
  agent_did      text not null,
  issued_at      timestamp,
  expires_at     timestamp,
  status_list_id text,
  status_index   integer,
  revoked        boolean default false
)

-- append-only audit
audit_log (
  id         bigserial primary key,
  event_type text,        -- issued | revoked | verified
  vc_id      text,
  agent_did  text,
  timestamp  timestamp,
  metadata   jsonb
)

When the operator runs the self-hosted API, the database serves three real purposes:
1. Issuance registry
Operator needs to know which agents have been issued which VCs. Not for verification — verification is SDK-local. But for operator visibility:
Which agents are active?
Which VC expires next week?
Which agent do I need to revoke?
This is an operational concern, not a cryptographic one. Could be a simple Postgres table or even a JSON file at low scale.
2. Audit log
Who issued what, when, to whom. Revocation events. This is the compliance record. Needs to be append-only, tamper-evident ideally. At low scale — a log file. At production scale — Postgres with write-only append semantics.
3. Revocation index
Fast lookup: given a vcId, what is its statusListIndex? The bitstring is the authoritative state but you need the index mapping to flip the right bit on revocation.
vcId → statusListIndex
At low scale this could live in a JSON file alongside the StatusList. At production scale — Postgres.