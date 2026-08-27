# Golden vectors

See [`docs/proposal-sdk-api-only.md`](../../docs/proposal-sdk-api-only.md)
("Decided: how payload/encoding parity is guaranteed for what stays local")
and [`docs/proposal-retire-core-package.md`](../../docs/proposal-retire-core-package.md).

These fixtures are the cross-language contract for the small set of crypto
primitives that every SDK must implement **locally** rather than call the API
for: canonical JSON, hashing, Ed25519 signing, and `VPBuilder.sign()`. They
are generated once from `helix-core`'s own implementation — never
hand-written or re-derived from a spec — and every SDK asserts byte-for-byte
equality against them.

## Files

| File                 | Covers                                                          |
| -------------------- | ---------------------------------------------------------------- |
| `canonical-json.json`| `toCanonicalJson` / `hashCanonicalPayload` over representative and edge-case payloads (nested objects, arrays, unicode, numeric edge cases). |
| `signing.json`       | `signData` / `verifySignature` over the same payload set, using a fixed (non-secret, test-only) keypair. |
| `vp-builder.json`    | Full `VPBuilder.sign()` output — the actual wire shape of a signed VP — using injected `id`/`nonce`/`expiresAt`/`proofCreatedAt` overrides so the output is deterministic. |

## Regenerating

```bash
pnpm generate:golden-vectors
```

Regenerate whenever `helix-core/src/crypto/vp.ts`, `crypto/keys.ts`,
`proof.ts`, or `vp-builder.ts` change, and commit the resulting diff in the
same PR as the source change. Do not hand-edit these files — they're
generated output.

## Who enforces this

- **`helix-core`**: `tests/unit/golden-vectors.test.ts` re-derives every
  vector from current source and fails if it drifts from what's committed
  here — this is what catches "changed the crypto, forgot to regenerate."
- **`helix-sdk-js`**: `tests/unit/golden-vectors.test.ts` does the same
  using this package's own import of `VPBuilder`. Today that's a re-export
  of `@helixid/core`; once `proposal-retire-core-package.md` lands and this
  file becomes a verbatim local copy, this test is what catches a missed
  copy-paste sync.
- **`helix-sdk-py`** (once it exists): same pattern, its own
  implementation, same fixture files.

Every consumer loads these files directly rather than hand-copying values
into its own test source, so there is exactly one place these numbers live.
