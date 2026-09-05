// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0

import { existsSync, readFileSync } from 'node:fs';

if (existsSync('.env.test')) {
  for (const line of readFileSync('.env.test', 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, '');
    process.env[key] ??= value;
  }
}

// Provide required environment variables for @helixid/core config validation
process.env['NODE_ENV'] ??= 'test';
process.env['API_BASE_URL'] ??= 'http://localhost:3000';
process.env['DATABASE_URL'] ??= 'postgresql://helixid_test:helixid_test@localhost:5433/helixid_test';
process.env['HEDERA_OPERATOR_ID'] ??= '0.0.123';
process.env['HEDERA_OPERATOR_KEY'] ??= '302e020100300506032b657004220420' + 'a'.repeat(64);
process.env['HEDERA_TOPIC_ID'] ??= '0.0.456';
process.env['HELIX_SIGNING_KEY'] ??= 'a'.repeat(64);
process.env['HELIX_ISSUER_DID'] ??= 'did:hedera:testnet:helixissuer';
process.env['JWT_SESSION_TTL_SECONDS'] ??= '600';
process.env['HELIX_ADMIN_API_KEY'] ??= 'test-admin-key-0001';
process.env['DID_METHOD'] ??= 'hedera';
process.env['HEDERA_MOCK'] ??= 'true';
