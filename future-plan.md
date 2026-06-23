# Future plan

## Postgres / cache configuration

### Notes
- Postgres storage is currently parked for future releases.
- SQLite remains the current default storage path.
- Cache is optional; L1 in-process memory cache is enabled by default.
- Redis/L2 cache is also parked for future releases and is not required for current runs.

### Configuration notes
```env
# Current default behavior
HELIX_STORAGE_ADAPTER=sqlite
HELIX_CACHE_ADAPTER=memory

# Cache is optional; L1 in-process memory cache is enabled by default.
CACHE_ENABLED=true

# Only the L1 cache TTLs currently matter.
DID_CACHE_L1_TTL_SECONDS=300
STATUS_LIST_CACHE_L1_TTL_SECONDS=60
```

### Follow-up ideas
- Revisit Postgres support once storage and migration requirements are finalized.
- Revisit Redis-backed L2 cache once shared-cache requirements are clearer.
- Document any production-specific cache tuning decisions later.

