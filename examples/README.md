# Helix ID Examples

These examples are intentionally small. They use the current SDK and API names, not future aliases.

Run the real Hedera setup first:

```sh
pnpm setup:hedera
set -a; source .env; set +a
pnpm --filter @helix-id/api start
```

For the VP examples, generate a fresh fixture shortly before running them. VPs are single-use and expire in minutes.

```sh
pnpm --filter @helix-id/example-e2e-travel-concierge enroll
pnpm --filter @helix-id/example-e2e-travel-concierge fixture
```

Then run:

```sh
pnpm example:verify-vp
pnpm example:scope-check
pnpm example:self-verify
pnpm example:revocation-check
```

`verify-vp` consumes the fixture VP. Running it a second time should fail with `VP_VERIFICATION_FAILED`.

`revocation-check` revokes the fixture credential. Generate a new fixture after running it if you want `verify-vp` or `self-verify` to pass again.
