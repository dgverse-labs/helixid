# HelixID Console

Operator UI for the HelixID trust stack — browse agents, enroll new ones,
manage verifier services, and read the audit trail, without hitting the
API by hand.

## 1. Overview

### 1.1 What Console is

Console is a single-page React app with four screens (**Agents**,
**Enroll**, **Services**, **Audit**) behind a login gate. It's an internal
operator tool, not a consumer product — everything is fetch-on-load or
manual refresh, there's no real-time infrastructure, and the styling
favors clarity over polish. See [`DEV_SPEC.md`](./DEV_SPEC.md) for the
full design rationale and the (superseded) original spec.

### 1.2 Where it fits in the HelixID trust stack

Console is a client of `helix-api` — it calls the same admin endpoints
(`x-admin-api-key`) that the CLI and SDK use, and adds nothing to the
trust model itself. See the main repo [README's 5-layer table](../README.md#what-helixid-does)
for how DIDs, VCs, VPs, JWT sessions and the audit trail fit together;
Console is a read/write surface over that stack, not a new layer.

## 2. Prerequisites

- **Node 24.15.0** (see the repo's `.nvmrc`; `nvm use` picks it up)
- **pnpm** (`corepack enable` if you don't have it)
- A running `helix-api` instance and its admin API key — Console has no
  backend of its own. See the main repo README's Quick Start for spinning
  one up locally.

## 3. Running Console

### 3.1 As part of the sample app (pre-built image via docker-compose)

Console does not yet have an entry in the root `docker-compose.yml`. Until
that lands, run it standalone (§3.2) alongside the compose stack's
`helix-api`, pointing `API_BASE_URL` at whatever host/port that stack
exposes (e.g. `http://localhost:3000`).

### 3.2 Standalone self-hosting (docker build / docker run)

Console ships as a static SPA served by nginx. Build from the **repository
root** (it depends on the `@helixid/sdk-js` workspace package):

```bash
docker build -f console/Dockerfile -t helixid-console .
```

Run it with the runtime config every environment needs (see §4 — nothing
is baked in at build time, so the same image works anywhere):

```bash
docker run -p 8080:80 \
  -e API_BASE_URL=http://localhost:3000 \
  -e ADMIN_API_KEY=your-admin-key \
  -e CONSOLE_USERNAME=admin \
  -e CONSOLE_PASSWORD=admin \
  helixid-console
```

Open `http://localhost:8080`.

### 3.3 Local development (npm run dev)

From the repository root, install workspace dependencies once, then build
the packages Console depends on:

```bash
pnpm install
pnpm --filter @helixid/core build
pnpm --filter @helixid/sdk-js build
```

Copy the env template and fill in a running `helix-api`'s URL and admin
key:

```bash
cd console
cp .env.example .env
# edit .env: VITE_API_BASE_URL, VITE_ADMIN_API_KEY
npm run dev
```

Vite serves on `http://localhost:5173` (or the next free port) and proxies
`/v1` requests to `http://localhost:3400` in dev, since `helix-api` has no
CORS handling — adjust the proxy target in `vite.config.ts` if your API
runs on a different port.

## 4. Configuration / Environment Variables

| Variable            | Required | Default        | Purpose                                              |
| -------------------- | -------- | --------------- | ----------------------------------------------------- |
| `API_BASE_URL`       | yes      | —               | Host-reachable `helix-api` URL (the **browser** calls it, not the container — never a Docker-internal DNS name) |
| `ADMIN_API_KEY`      | yes      | —               | Same `x-admin-api-key` value `helix-api` is configured with |
| `CONSOLE_USERNAME`   | no       | `admin`         | Login gate username (see §5.5 — client-side gate, not a security boundary) |
| `CONSOLE_PASSWORD`   | no       | `admin`         | Login gate password |

### 4.1 `ADMIN_API_KEY`

Reused from the same value `helix-api`'s admin routes expect. Console
attaches it to every request via `HelixClient`; there's no separate
Console-side credential store.

### 4.2 `API_BASE_URL`

Must resolve from the **operator's browser**, since the browser makes the
API calls directly — not the container running Console. In a
docker-compose stack this is usually a `localhost:<port>` mapping, not the
compose service's internal hostname.

### 4.3 How runtime injection works

Console is built once and deployed everywhere — env vars are read at
**container startup**, not baked in at build time. The nginx image
regenerates `env-config.js` from the container's environment before
nginx starts (`docker/40-env-config.sh`), and `index.html` loads that
script before the app bundle, so `window.__HELIXID_CONFIG__` is populated
before React mounts. For local `npm run dev`, the same values come from
`VITE_API_BASE_URL` / `VITE_ADMIN_API_KEY` / `VITE_CONSOLE_USERNAME` /
`VITE_CONSOLE_PASSWORD` in `console/.env` instead. See `DEV_SPEC.md` §6
for the full mechanism; `src/runtimeConfig.ts` is the one module that
reads either source.

## 5. Features

### 5.1 Agents (`/agents`, default route after login)

Lists every agent's latest VC — scopes, status, delegation lineage — with
a manual Refresh button. Click a row for the detail panel: full VC JSON
(collapsed by default), credential history for that DID, and a Revoke
action. Revocation is **never optimistic** — the status badge only flips
after the API confirms and the detail re-fetches.

### 5.2 Enroll (`/enroll`)

Mint a one-time enrollment token from agent name / scopes / domains /
delegation depth. Once minted, the token is shown immediately and a
polling component watches the audit log for the matching
`onboarding_complete` event every 3 seconds, stopping after a match or
after 2 minutes with a "check manually" message. This is the only screen
that auto-polls.

### 5.3 Services (`/services`)

Lists registered verifier services and lets you register a new one
(service name, display name, verified domain, public key, API endpoint,
optional metadata).

### 5.4 Audit (`/audit`)

A full page (not a persistent side rail — see the "Known Limitations"
note in `DEV_SPEC.md` if you're comparing against the original spec)
listing recent identity/credential/verification events, newest first,
with a manual Refresh button. Rows with a `subjectDid` link to `/agents`
pre-filtered to that DID.

### 5.5 Login & theme

Console sits behind a login gate (`/login`) — default credentials
`admin` / `admin`, overridable via `CONSOLE_USERNAME` / `CONSOLE_PASSWORD`
(§4). This is a **client-side access gate, not a security boundary**: the
`ADMIN_API_KEY` still ships in runtime config to the browser regardless of
login state. The session persists via `sessionStorage` (cleared when the
tab closes) and unauthenticated route access redirects to `/login`. A
theme toggle in the header switches between a light default and a dark
theme, persisted in `localStorage`.

## 6. Versioning & Releases

### 6.1 Image tags

`ghcr.io/nicedigverse/helixid-console` is the intended tag namespace once
Console images are published; no image has been published yet as of this
branch.

### 6.2 Compatibility with helix-api versions

Console calls `GET /v1/vcs`, `GET /v1/audit-log`, and the existing
services/enrollment endpoints on `helix-api`. Pin Console and `helix-api`
to versions built from the same monorepo commit until these are
independently versioned and a compatibility table exists.

## 7. Contributing / Development

### 7.1 Folder structure

See `DEV_SPEC.md` §3 for the intended layout. Current structure:

```
console/
  src/
    api/            # api/client.ts (the only module wrapping HelixClient) + types.ts
    auth/            # login gate: AuthContext, useAuth, RequireAuth
    theme/            # light/dark theme context + hook
    runtimeConfig.ts  # the one seam reading window.__HELIXID_CONFIG__ / VITE_*
    components/
      layout/         # AppLayout (sidebar/topbar), ThemeToggle, icons
      agents/          # AgentList, AgentDetailPanel, RevokeButton
      enroll/          # EnrollForm, EnrollmentStatus (polling)
      services/        # ServiceList, ServiceForm
    hooks/
      usePolling.ts    # generic poll-until-timeout hook
    pages/
      AgentsPage.tsx, EnrollPage.tsx, ServicesPage.tsx, AuditPage.tsx, LoginPage.tsx
    App.tsx, main.tsx, styles.css
  tests/               # mirrors src/
  docker/              # nginx.conf, 40-env-config.sh (container runtime injection)
  brand-src/           # original brand asset sources (not bundled)
```

### 7.2 Running tests

```bash
npm test           # vitest run --coverage
npm run test:watch
npm run typecheck   # tsc --noEmit
npm run build       # tsc --noEmit && vite build
```

Coverage thresholds match `helix-api`/`helix-sdk-js` (90% lines/statements,
90% functions, 85% branches) — see `vite.config.ts`.

## 8. Known Limitations

### 8.1 No real-time updates

Manual refresh model throughout, except the Enroll page's onboarding poll
(§5.2). Revoking an agent or registering a service elsewhere won't appear
until you click Refresh.

### 8.2 VP inspection scope

No Verifiable Presentation payload inspection anywhere in Console — the
audit trail only records that a VP was verified, not its contents. This
was an open item in `DEV_SPEC.md` §8 and remains unresolved.

### 8.3 Login gate is not a security boundary

The login screen (§5.5) prevents casual access to the UI; it does not
protect the `ADMIN_API_KEY`, which is still delivered to every browser
session via runtime config. Treat Console's trust boundary as identical
to any other client holding that key.
