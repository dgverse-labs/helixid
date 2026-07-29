# HelixID — Claude Code operating rules

## Repo
TypeScript monorepo, pnpm workspaces. Always `pnpm build` and confirm `dist/`
before importing across packages.

## Git — non-negotiable
- Never commit or push to `main`.
- All epics land on the single branch already checked out. Do not create branches.
- Do not commit. The engineer reviews the diff and commits at each epic boundary.
- Do not push. The engineer opens the PR.

## Spec precedence — read in this order
1. `specs/decisions-resolved.md` — AUTHORITATIVE. Overrides everything below.
2. `specs/epics/<assigned epic>.md` — the spec of record for this epic.
3. `specs/context.md` — shared background.

The epic docs were written before the decisions register existed and were not
retro-edited. Where they conflict, the register wins. If you find a conflict the
register does not cover, STOP and report it — do not pick a side silently.

## Scope
- Work only on the epic named in the current prompt. Earlier epics are already
  committed on this branch — read their handoffs, do not revise their code unless
  the current epic's spec explicitly says to.
- Read the assigned epic spec in full before writing any code.
- If a spec references a file, function, or export that does not exist in the
  current codebase, STOP and report the mismatch. Do not invent it.
- If the assigned spec file is missing or unreadable, STOP immediately.

## Implementation
- Read the actual source before designing. Do not infer shipped status from the
  README or from a spec doc's description of current code.
- No mocked endpoints, no stubbed happy paths presented as complete.
- Do not refactor surrounding code, add abstractions, or design for hypothetical
  future requirements beyond what the spec states.
- Items marked open in a spec or in the register are NOT to be solved. Flag them.
- Epic 4 (audit routing) is parked. Do not refactor existing audit call sites
  toward a routing module, and do not stub one.

## Checkpoints
Pause only for destructive/irreversible actions, a real scope change, or input
only the engineer can provide. Otherwise proceed without asking.

## Progress reporting
Before claiming anything works, point to a tool result from this session. If a
test fails, say so with the output. If a step was skipped, say that.
