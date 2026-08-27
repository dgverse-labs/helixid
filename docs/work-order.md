# Work order — where things stand

1. **Item #2 — API base URL** ✅ Done (PR #28, merged).
2. **Item #1 — Enterprise hosted instance** — Design done, build pending.
3. **SDK/API dependency refactor** — Decided (`proposal-sdk-api-only.md`),
   build pending. Sits between #1 and #4 since #4 needs the stabilized API
   surface this produces.
4. **Item #4 — Python SDK** — Approach agreed, not started. Comes after #1
   and the SDK refactor land, so it's built against a settled API shape.
5. **Item #3 — Monorepo split** — Parked. Revisit after 1–4 settle.
