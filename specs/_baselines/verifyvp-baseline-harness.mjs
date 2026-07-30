// Copyright 2026 DgVerse LLP
//
// §2.9 / §9.2 regression harness for Epic 2 (VP Build & Verify).
//
// Usage (from repo root, helix-core built):
//   node specs/_baselines/verifyvp-baseline-harness.mjs capture
//     - builds the deterministic R1–R8 fixture set, runs it through the
//       CURRENT `verifyVP()`, writes:
//         specs/_baselines/verifyvp-fixtures.json       (frozen signed VPs + status lists)
//         specs/_baselines/verifyvp-results-pre.json    (per-case result/error)
//   node specs/_baselines/verifyvp-baseline-harness.mjs compare
//     - loads the frozen fixtures (NOT rebuilt — byte-identical inputs),
//       re-runs them through the current `verifyVP()`, writes
//       verifyvp-results-post.json, and diffs against results-pre.
//       The ONLY permitted difference is the additive `effectiveScopes`
//       field, which must equal `privilegeScopes` for every 1-element case
//       (§2.9: "effectiveScopes trivially equal to it").
//
// Fixture determinism: fixed private keys, fixed validity windows
// (2026-01-01 → 2036-01-01, except deliberately-expired cases), did:key
// identifiers (offline resolution — no DID fetch), and a fetch stub that
// serves status lists from the frozen fixture map. VP `expirationDate` is
// fixed far-future so frozen fixtures do not rot; the deliberately-expired
// VP case uses a fixed past date.

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const core = await import(join(here, '../../helix-core/dist/index.js'));
const proofMod = await import(join(here, '../../helix-core/dist/proof.js'));

const {
  buildDelegationVC,
  buildStatusListCredential,
  createStatusList,
  derivePublicKey,
  publicKeyToMultibase,
  setBit,
  verifyVP,
  clearDIDCache,
} = core;
const { createEd25519Proof } = proofMod;

const FIXTURES_PATH = join(here, 'verifyvp-fixtures.json');
const PRE_PATH = join(here, 'verifyvp-results-pre.json');
const POST_PATH = join(here, 'verifyvp-results-post.json');

// Fixed key material — never reuse outside tests.
const KEYS = {
  issuer: '1111111111111111111111111111111111111111111111111111111111111111',
  holder: '2222222222222222222222222222222222222222222222222222222222222222',
  subAgent: '3333333333333333333333333333333333333333333333333333333333333333',
  wrong: '4444444444444444444444444444444444444444444444444444444444444444',
};

const VALID_FROM = '2026-01-01T00:00:00.000Z';
const VALID_UNTIL = '2036-01-01T00:00:00.000Z';
const PAST_UNTIL = '2026-01-02T00:00:00.000Z';
const VP_EXPIRY = '2036-01-01T00:00:00.000Z';
const VP_EXPIRED = '2026-01-02T00:00:00.000Z';
const NONCE = 'ab'.repeat(32);
const LIST_URL_OK = 'https://baseline.example/status/ok';
const LIST_URL_REVOKED = 'https://baseline.example/status/revoked';

function didKey(privateKeyHex) {
  return `did:key:${publicKeyToMultibase(derivePublicKey(privateKeyHex))}`;
}

function sortedStringify(value) {
  const sortKeys = (input) => {
    if (Array.isArray(input)) return input.map(sortKeys);
    if (input && typeof input === 'object') {
      return Object.fromEntries(
        Object.keys(input)
          .sort()
          .map((key) => [key, sortKeys(input[key])]),
      );
    }
    return input;
  };
  return JSON.stringify(sortKeys(value), null, 2);
}

async function signVC(payload, privateKeyHex, issuerDid) {
  return { ...payload, proof: await createEd25519Proof(payload, privateKeyHex, `${issuerDid}#key-1`) };
}

async function signVP(payload, privateKeyHex, holderDid) {
  return { ...payload, proof: await createEd25519Proof(payload, privateKeyHex, `${holderDid}#key-1`) };
}

async function buildFixtures() {
  const issuerDid = didKey(KEYS.issuer);
  const holderDid = didKey(KEYS.holder);
  const subAgentDid = didKey(KEYS.subAgent);

  const okList = buildStatusListCredential('ok', createStatusList(1024), issuerDid, 'https://baseline.example');
  const revokedList = buildStatusListCredential(
    'revoked',
    setBit(createStatusList(1024), 7, 1),
    issuerDid,
    'https://baseline.example',
  );

  const rootVCPayload = (overrides = {}) => ({
    '@context': ['https://www.w3.org/ns/credentials/v2', 'https://helixid.io/contexts/v1'],
    id: 'vc:baseline:root',
    type: ['VerifiableCredential', 'HelixAgentCredential'],
    issuer: issuerDid,
    validFrom: VALID_FROM,
    validUntil: VALID_UNTIL,
    credentialStatus: {
      id: `${LIST_URL_OK}#5`,
      type: 'BitstringStatusListEntry',
      statusPurpose: 'revocation',
      statusListIndex: '5',
      statusListCredential: LIST_URL_OK,
    },
    credentialSubject: {
      id: holderDid,
      type: 'HelixAgent',
      privilegeScopes: ['read:orders', 'write:orders'],
      agentName: 'baseline-agent',
      delegationDepth: 0,
      maxDelegationDepth: 1,
    },
    targetService: 'orders',
    ...overrides,
  });

  const rootVC = await signVC(rootVCPayload(), KEYS.issuer, issuerDid);

  const vpPayload = (vc, overrides = {}) => ({
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    type: ['VerifiablePresentation'],
    id: 'vp:helix:baseline-0000-0000',
    holder: holderDid,
    verifiableCredential: [vc],
    nonce: NONCE,
    expirationDate: VP_EXPIRY,
    delegatedBy: 'did:web:user.example',
    targetService: 'orders',
    ...overrides,
  });

  // R2: legit 2-link chain — child delegated from the root VC.
  const childVC = await buildDelegationVC(
    { to: subAgentDid, scopes: ['read:orders'], expiresIn: 10 * 365 * 24 * 3600, fromVC: rootVC },
    { did: holderDid, privateKeyHex: KEYS.holder },
  );

  // R3: escalated child — same shape as childVC but scopes beyond the parent,
  // legitimately re-signed by the delegator so the signature verifies and the
  // chain-integrity check is what fires.
  const { proof: _cp, ...childBase } = childVC;
  const escalatedPayload = {
    ...childBase,
    id: 'vc:baseline:escalated-child',
    credentialSubject: {
      ...childBase.credentialSubject,
      privilegeScopes: ['read:orders', 'admin:everything'],
    },
  };
  const escalatedChild = await signVC(escalatedPayload, KEYS.holder, holderDid);

  const expiredVC = await signVC(
    rootVCPayload({ id: 'vc:baseline:expired', validUntil: PAST_UNTIL }),
    KEYS.issuer,
    issuerDid,
  );

  const revokedVC = await signVC(
    rootVCPayload({
      id: 'vc:baseline:revoked',
      credentialStatus: {
        id: `${LIST_URL_REVOKED}#7`,
        type: 'BitstringStatusListEntry',
        statusPurpose: 'revocation',
        statusListIndex: '7',
        statusListCredential: LIST_URL_REVOKED,
      },
    }),
    KEYS.issuer,
    issuerDid,
  );

  const cases = {};
  cases.R1_root_valid = await signVP(vpPayload(rootVC), KEYS.holder, holderDid);
  cases.R2_delegated_valid = await signVP(
    vpPayload(childVC, { holder: subAgentDid, id: 'vp:helix:baseline-r2' }),
    KEYS.subAgent,
    subAgentDid,
  );
  cases.R3_chain_escalation = await signVP(
    vpPayload(escalatedChild, { holder: subAgentDid, id: 'vp:helix:baseline-r3' }),
    KEYS.subAgent,
    subAgentDid,
  );
  cases.R4_vc_expired = await signVP(
    vpPayload(expiredVC, { id: 'vp:helix:baseline-r4' }),
    KEYS.holder,
    holderDid,
  );
  cases.R5_vc_revoked = await signVP(
    vpPayload(revokedVC, { id: 'vp:helix:baseline-r5' }),
    KEYS.holder,
    holderDid,
  );
  cases.R6_vp_expired = await signVP(
    vpPayload(rootVC, { id: 'vp:helix:baseline-r6', expirationDate: VP_EXPIRED }),
    KEYS.holder,
    holderDid,
  );
  cases.R7_vp_bad_signature = await signVP(
    vpPayload(rootVC, { id: 'vp:helix:baseline-r7' }),
    KEYS.wrong,
    holderDid,
  );
  cases.R8_target_mismatch = await signVP(
    vpPayload(rootVC, { id: 'vp:helix:baseline-r8', targetService: 'hotels' }),
    KEYS.holder,
    holderDid,
  );

  return {
    statusLists: { [LIST_URL_OK]: okList, [LIST_URL_REVOKED]: revokedList },
    verifyOptions: { R8_target_mismatch: { expectedTargetService: 'hotels' } },
    cases,
  };
}

function stubFetch(statusLists) {
  globalThis.fetch = async (url) => {
    const body = statusLists[String(url)];
    if (!body) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => body };
  };
}

async function runCases(fixtures) {
  stubFetch(fixtures.statusLists);
  const results = {};
  for (const [name, vp] of Object.entries(fixtures.cases)) {
    clearDIDCache();
    const options = fixtures.verifyOptions?.[name] ?? {};
    try {
      results[name] = { outcome: 'result', value: await verifyVP(vp, options) };
    } catch (error) {
      results[name] = {
        outcome: 'error',
        error: {
          name: error?.name,
          code: error?.code,
          httpStatus: error?.httpStatus,
          message: error?.message,
        },
      };
    }
  }
  return results;
}

const mode = process.argv[2];
if (mode === 'capture') {
  const fixtures = await buildFixtures();
  await writeFile(FIXTURES_PATH, sortedStringify(fixtures), 'utf8');
  const results = await runCases(fixtures);
  await writeFile(PRE_PATH, sortedStringify(results), 'utf8');
  console.log(`captured ${Object.keys(results).length} cases`);
  for (const [name, r] of Object.entries(results)) {
    console.log(`  ${name}: ${r.outcome === 'result' ? 'valid' : r.error.code}`);
  }
} else if (mode === 'compare') {
  const fixtures = JSON.parse(await readFile(FIXTURES_PATH, 'utf8'));
  const pre = JSON.parse(await readFile(PRE_PATH, 'utf8'));
  const post = await runCases(fixtures);
  await writeFile(POST_PATH, sortedStringify(post), 'utf8');

  let failures = 0;
  for (const name of Object.keys(pre)) {
    const preEntry = pre[name];
    const postEntry = post[name];
    // The only §2.9-permitted delta: an additive effectiveScopes field that
    // must equal privilegeScopes on every successful 1-element case.
    let comparablePost = postEntry;
    let effectiveScopesNote = 'n/a';
    if (postEntry?.outcome === 'result' && 'effectiveScopes' in (postEntry.value ?? {})) {
      const { effectiveScopes, ...rest } = postEntry.value;
      comparablePost = { ...postEntry, value: rest };
      const equal =
        sortedStringify(effectiveScopes) === sortedStringify(postEntry.value.privilegeScopes);
      effectiveScopesNote = equal ? 'equals privilegeScopes' : 'MISMATCH vs privilegeScopes';
      if (!equal) failures += 1;
    }
    const identical = sortedStringify(preEntry) === sortedStringify(comparablePost);
    if (!identical) failures += 1;
    console.log(
      `${identical ? 'IDENTICAL' : 'DIFFERENT'}  ${name}  (effectiveScopes: ${effectiveScopesNote})`,
    );
    if (!identical) {
      console.log(`  pre:  ${sortedStringify(preEntry).replaceAll('\n', ' ')}`);
      console.log(`  post: ${sortedStringify(comparablePost).replaceAll('\n', ' ')}`);
    }
  }
  console.log(failures === 0 ? 'BASELINE MATCH: all cases byte-identical' : `BASELINE FAILURES: ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
} else {
  console.error('usage: node verifyvp-baseline-harness.mjs <capture|compare>');
  process.exit(2);
}
