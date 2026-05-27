# STORY 9 — OPA Policy Engine

## Overview

Embed OPA (Open Policy Agent) as a Node.js sidecar into the VP verification path. OPA sits after all cryptographic checks pass — it is the business rules gate, not the trust gate. The cryptographic checks (signature, expiry, vpId consumption, revocation) are not delegated to OPA — they remain in `vp.service.ts`. OPA receives a structured fact object assembled from the verified credential and returns allow or deny.

OPA runs as a sidecar process (Docker container alongside the API). The Node.js API calls it via HTTP using `@styra/opa`. Policy files live in `policies/` at the workspace root — self-hosters mount this directory to customise rules.

Helix ID ships a base Rego library covering Category 1 (integrity rules) and Category 4 (delegation chain rules). Service owners write Category 2 and 3 rules in their own policy files.

---

## 9.1 — Monorepo Structure Addition

Add to workspace root:

```
policies/
├── base/
│   ├── integrity.rego          # Category 1 — always enforced
│   └── delegation.rego         # Category 4 — enforced when chain present
├── examples/
│   ├── time-bound.rego         # Category 3 example — business hours only
│   ├── resource-scope.rego     # Category 2 example — resource prefix matching
│   └── cross-org.rego          # Category 3 example — same-org write restriction
└── README.md                   # How to write and mount custom policies
```

---

## 9.2 — Dependencies

In `helix-api`:

```bash
pnpm install @styra/opa
```

Add to `decisions.md`: `@styra/opa` — OPA Node.js client. Calls OPA sidecar over HTTP. Alternative considered: embedding OPA via WASM (`@open-policy-agent/opa-wasm`) — rejected because WASM bundle is ~5MB and complicates the build; sidecar approach is simpler operationally and consistent with how OPA is used in production. OPA sidecar is not a crypto library so DP-3 does not apply; standard DP-1 checks apply.

---

## 9.3 — Environment Variables

Add to `.env.example` and config:

```
OPA_URL=http://localhost:8181     # OPA sidecar endpoint
OPA_ENABLED=true                  # Set to false to disable OPA — all requests pass policy check
OPA_POLICY_PATH=data.helixid.policy.allow  # Rego rule path to evaluate
OPA_TIMEOUT_MS=5000               # OPA call timeout — default 5 seconds
```

Config additions:
- `opaUrl: string` — default `http://localhost:8181`
- `opaEnabled: boolean` — default `true`
- `opaPolicyPath: string` — default `data.helixid.policy.allow`
- `opaTimeoutMs: number` — default 5000

**When `OPA_ENABLED=false`:** OPA call is skipped entirely, policy check always passes. Used for local development without OPA sidecar running and for gradual rollout.

---

## 9.4 — Base Rego Policy Library

### `policies/base/integrity.rego`

```rego
package helixid.policy

import future.keywords.if
import future.keywords.in

default allow = false

# Main allow rule — all conditions must pass
allow if {
    credential_verified
    not credential_expired
    not credential_revoked
    scopes_sufficient
    delegation_depth_ok
}

# Credential is cryptographically verified (set by Helix ID before OPA call)
credential_verified if {
    input.credential.verified == true
}

# Credential expiry (belt-and-suspenders — Helix ID checks this too)
credential_expired if {
    now := time.now_ns() / 1000000000
    input.credential.expiresAtUnix < now
}

# Revocation (belt-and-suspenders — Helix ID checks status list too)
credential_revoked if {
    input.credential.revoked == true
}

# At least one credential scope must match the requested action
scopes_sufficient if {
    input.credential.scopes[_] == input.request.action
}

# Delegation depth must not exceed the max set at root issuance
delegation_depth_ok if {
    not input.credential.isDelegated
}

delegation_depth_ok if {
    input.credential.isDelegated
    input.credential.delegationDepth <= input.credential.maxDelegationDepth
}
```

### `policies/base/delegation.rego`

```rego
package helixid.delegation

import future.keywords.if
import future.keywords.in

# No scope in the chain can exceed the root's granted scopes
no_scope_escalation if {
    count(input.credential.chain) > 0
    every link in input.credential.chain {
        every scope in link.scopes {
            scope in input.credential.rootScopes
        }
    }
}

# Chain must terminate at Helix ID as root issuer
chain_root_trusted if {
    count(input.credential.chain) > 0
    input.credential.chain[0].issuedBy == input.policy.helixIssuerDid
}

# All chain links must be consecutive in depth
chain_depths_sequential if {
    count(input.credential.chain) > 0
    every i in numbers.range(1, count(input.credential.chain) - 1) {
        input.credential.chain[i].delegationDepth == input.credential.chain[i-1].delegationDepth + 1
    }
}
```

### `policies/examples/time-bound.rego`

```rego
package helixid.policy.custom

# Contractor agents may only operate during business hours UTC
contractor_time_allowed if {
    input.credential.role != "contractor-agent"
}

contractor_time_allowed if {
    input.credential.role == "contractor-agent"
    hour := time.clock(time.now_ns())[0]
    hour >= 9
    hour < 17
}
```

### `policies/README.md`

Documents:
1. How OPA is structured — base policies always loaded, custom policies additive
2. The input object schema (complete field reference)
3. How to mount custom policies in Docker Compose
4. How to test policies with `opa eval` locally
5. The four categories of rules and which are Helix ID's responsibility vs the service owner's

---

## 9.5 — OPA Input Object — `helix-core/src/schemas/opa.ts`

Define the input schema that Helix ID sends to OPA on every VP verify call:

```typescript
interface OPAInput {
  credential: {
    verified: boolean;           // always true when OPA is called (crypto checks already passed)
    holderDid: string;
    issuerDid: string;
    scopes: string[];
    expiresAtUnix: number;       // unix timestamp
    revoked: boolean;            // always false when OPA is called (revocation check passed)
    isDelegated: boolean;
    delegationDepth?: number;
    maxDelegationDepth?: number;
    delegatedFrom?: string;
    chain?: ChainLink[];         // populated when isDelegated is true
    rootScopes?: string[];       // scopes of the root VC in the chain
  };
  request: {
    action: string;              // targetService from VP — e.g. 'amazon'
    vpId: string;
    requestId: string;
    timestampUnix: number;
  };
  policy: {
    helixIssuerDid: string;      // Helix ID's own DID — for chain root trust check
  };
}

interface ChainLink {
  holderDid: string;
  issuedBy: string;
  delegationDepth: number;
  scopes: string[];
}
```

Export Zod schema and TypeScript type. Used to build the input object in `vp.service.ts` before calling OPA.

---

## 9.6 — OPA Client — `helix-api/src/opa/OPAClient.ts`

```typescript
interface IOPAClient {
  evaluate(input: OPAInput): Promise<boolean>;
}

class OPAClient implements IOPAClient {
  constructor(
    private opa: OPASDKClient,   // @styra/opa client instance
    private policyPath: string,
    private timeoutMs: number,
  ) {}

  async evaluate(input: OPAInput): Promise<boolean> {
    try {
      const result = await this.opa.evaluate<boolean>(this.policyPath, input, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      return result.result ?? false;
    } catch (error) {
      // OPA sidecar unreachable or timeout — fail closed (deny)
      throw new OPAPolicyError('OPA evaluation failed: ' + String(error));
    }
  }
}

class NoOpOPAClient implements IOPAClient {
  async evaluate(_input: OPAInput): Promise<boolean> {
    return true;   // Used when OPA_ENABLED=false
  }
}
```

Add error code to helix-core:

```typescript
OPA_POLICY_DENIED: 'OPA_POLICY_DENIED',
OPA_UNAVAILABLE: 'OPA_UNAVAILABLE',
```

| Class | Code | HTTP |
|---|---|---|
| `OPAPolicyDeniedError` | `OPA_POLICY_DENIED` | 403 |
| `OPAUnavailableError` | `OPA_UNAVAILABLE` | 503 |

**Fail closed:** If OPA is unreachable or times out, the request is denied (`OPAUnavailableError`), not allowed. This is the correct behaviour for a trust infrastructure product — a misconfigured OPA is more dangerous than a temporarily unavailable one.

---

## 9.7 — VP Service Changes

### `helix-api/src/services/vp/vp.service.ts`

Add constructor parameter: `opaClient: IOPAClient`

**`verifyVP` — insert OPA evaluation after step 11 (revocation check), before step 12 (atomic consumption):**

New step 11a:

```
Build OPAInput from verified credential facts:
  - credential.verified: true
  - credential.holderDid: signedVP.holder
  - credential.issuerDid: extracted from embedded VC issuer field
  - credential.scopes: embedded VC credentialSubject.privilegeScopes
  - credential.expiresAtUnix: Date.parse(embedded VC expirationDate) / 1000
  - credential.revoked: false (passed revocation check)
  - credential.isDelegated: delegationDepth > 0
  - delegation fields if isDelegated
  - chain: array of ChainLink built from DB-fetched chain (if Story 6 is active)
  - request.action: vpId record's targetService
  - request.vpId: vpId
  - request.requestId: requestId
  - request.timestampUnix: Math.floor(Date.now() / 1000)
  - policy.helixIssuerDid: config.helixOperatorDid

Call: const allowed = await opaClient.evaluate(input)

If !allowed:
  - Log VP_REJECTED audit event with internalReason: 'opa_policy_denied'
  - Throw VPVerificationFailedError (EH-4 — opaque external response)

If OPAUnavailableError thrown:
  - Log VP_REJECTED with internalReason: 'opa_unavailable'
  - Throw VPVerificationFailedError
```

**Critical:** OPA denial maps to `VP_VERIFICATION_FAILED` externally per EH-4. The external service never learns whether the failure was cryptographic, revocation, or policy. The audit log contains `internalReason: 'opa_policy_denied'` for operator debugging.

### Audit Events — additions to `VP_REJECTED`

The existing `VP_REJECTED` audit event gains two new possible `internalReason` values: `opa_policy_denied` and `opa_unavailable`. No schema change needed — `internalReason` is already a free string field.

---

## 9.8 — Docker Compose Changes

### `docker-compose.yml` — add OPA sidecar

```yaml
services:
  opa:
    image: openpolicyagent/opa:latest-rootless
    ports:
      - "8181:8181"
    volumes:
      - ./policies:/policies:ro
    command:
      - "run"
      - "--server"
      - "--addr=0.0.0.0:8181"
      - "--log-level=info"
      - "/policies/base"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8181/health"]
      interval: 5s
      timeout: 3s
      retries: 5
```

Add `OPA_URL=http://opa:8181` to the `api` service environment.

### `docker-compose.test.yml`

Same OPA service. Test suite needs a real OPA sidecar for integration tests. Mount `./policies/base` only — no example policies in test environment.

---

## 9.9 — Wire in `server.ts`

```typescript
import { OPA as OPASDKClient } from '@styra/opa';

const opaClient = config.opaEnabled
  ? new OPAClient(new OPASDKClient({ serverUrl: config.opaUrl }), config.opaPolicyPath, config.opaTimeoutMs)
  : new NoOpOPAClient();

const vpService = new VPService(vpRepository, didService, vcService, serviceRegistry, auditLogger, opaClient);
```

---

## 9.10 — Tests

### Unit Tests — `helix-api/tests/unit/opa/`

- `OPAClient.evaluate` calls `@styra/opa` with correct policy path and input
- `OPAClient.evaluate` returns `true` when OPA returns `{ result: true }`
- `OPAClient.evaluate` returns `false` when OPA returns `{ result: false }`
- `OPAClient.evaluate` throws `OPAUnavailableError` when OPA client throws network error
- `OPAClient.evaluate` throws `OPAUnavailableError` on timeout (use `AbortSignal.timeout` mock)
- `NoOpOPAClient.evaluate` always returns `true`

All unit tests mock `@styra/opa` — no real OPA sidecar.

### Integration Tests — `helix-api/tests/integration/opa.integration.test.ts`

Setup: real PostgreSQL + real Redis + real OPA sidecar (from docker-compose.test.yml with base policies mounted).

Tests:

- Valid VP with matching scope in base policy → `POST /v1/vp/verify` returns 200
- Valid VP (crypto passes) but scope not matching `input.request.action` in base policy → 400 `VP_VERIFICATION_FAILED`; audit `internalReason: 'opa_policy_denied'`
- `OPA_ENABLED=false` env var: VP verify succeeds regardless of policy — OPA not called
- OPA sidecar stopped (simulate via wrong `OPA_URL`): VP verify returns 400 `VP_VERIFICATION_FAILED`; audit `internalReason: 'opa_unavailable'` — fail closed confirmed

### Security Tests — `helix-api/tests/security/opa.security.test.ts`

- **OPA denial is opaque externally:** Configure a base policy rule that denies a specific scope. Submit VP with that scope. Response is `VP_VERIFICATION_FAILED` — not `OPA_POLICY_DENIED`. Audit log contains `opa_policy_denied`.
- **OPA unavailable fails closed:** Stop OPA (wrong URL). Submit otherwise-valid VP → 400 `VP_VERIFICATION_FAILED`. Audit `internalReason: 'opa_unavailable'`. No request passes through.
- **OPA input contains no private key:** Capture OPA input object in test. Assert no field matches any known private key hex string. Assert `credential.revoked` is always `false` when OPA is called (revocation was already checked before this point).
- **OPA called after crypto — never before:** Intercept `opaClient.evaluate` call. Confirm it is called only after `verifySignature` returns true, `consumedAt` check passes, and revocation check returns bit 0. Submit tampered VP (signature invalid) → `evaluate` must not be called; verify via spy.

### Rego Policy Tests — `policies/base/*.rego.test`

Use OPA's built-in test framework (`opa test ./policies`):

```rego
# policies/base/integrity_test.rego
package helixid.policy_test

test_allow_valid_credential if {
    helixid.policy.allow with input as {
        "credential": {
            "verified": true, "revoked": false,
            "scopes": ["read:orders"],
            "expiresAtUnix": 9999999999,
            "isDelegated": false
        },
        "request": { "action": "read:orders", "vpId": "vp:1", "timestampUnix": 0 },
        "policy": { "helixIssuerDid": "did:hedera:testnet:issuer" }
    }
}

test_deny_wrong_scope if {
    not helixid.policy.allow with input as {
        "credential": {
            "verified": true, "revoked": false,
            "scopes": ["read:orders"],
            "expiresAtUnix": 9999999999,
            "isDelegated": false
        },
        "request": { "action": "write:orders", "vpId": "vp:2", "timestampUnix": 0 },
        "policy": { "helixIssuerDid": "did:hedera:testnet:issuer" }
    }
}

test_deny_expired_credential if {
    not helixid.policy.allow with input as {
        "credential": {
            "verified": true, "revoked": false,
            "scopes": ["read:orders"],
            "expiresAtUnix": 1,       # far in the past
            "isDelegated": false
        },
        "request": { "action": "read:orders", "vpId": "vp:3", "timestampUnix": 0 },
        "policy": { "helixIssuerDid": "did:hedera:testnet:issuer" }
    }
}
```

Add `opa test ./policies` to `turbo.json` test pipeline.

---

## Story 9 Acceptance Criteria

- [ ] OPA sidecar runs in Docker Compose — base policies loaded from `policies/base/`
- [ ] `POST /v1/vp/verify` calls OPA after all cryptographic checks pass — OPA is the last gate before consumption
- [ ] OPA denial returns `VP_VERIFICATION_FAILED` externally — never `OPA_POLICY_DENIED` in HTTP response (EH-4)
- [ ] OPA unavailable fails closed — no request passes when OPA is unreachable
- [ ] `OPA_ENABLED=false` disables OPA entirely — `NoOpOPAClient` used, no sidecar needed
- [ ] Base Rego library covers integrity and delegation rules — all rules have passing `opa test` tests
- [ ] `policies/README.md` documents input schema and how to write custom rules
- [ ] OPA input object never contains private keys or raw VC proof values — verified by security test
- [ ] OPA called only after crypto checks pass — never on invalid VPs — verified by security test
- [ ] `@styra/opa` added to `decisions.md` with alternatives considered
- [ ] `docker-compose.yml` and `docker-compose.test.yml` include OPA sidecar with policy volume mount
