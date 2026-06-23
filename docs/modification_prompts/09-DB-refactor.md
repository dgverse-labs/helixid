
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
2. Audit log
3. Revocation index
Fast lookup: given a vcId, what is its statusListIndex? The bitstring is the authoritative state but you need the index mapping to flip the right bit on revocation.
vcId → statusListIndex
So if DB is not chosen, then have all these details in JSON files.
