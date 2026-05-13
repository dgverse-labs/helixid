// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0

import { vi } from 'vitest';

// Provide required environment variables for @helix-id/core config validation
process.env['NODE_ENV'] = 'test';
process.env['API_BASE_URL'] = 'http://localhost:3000';
process.env['DATABASE_URL'] = 'postgresql://user:pass@localhost:5432/db';
process.env['HEDERA_OPERATOR_ID'] = '0.0.123';
process.env['HEDERA_OPERATOR_KEY'] = '302e020100300506032b657004220420' + 'a'.repeat(64);
process.env['HEDERA_TOPIC_ID'] = '0.0.456';
process.env['HELIX_SIGNING_KEY'] = 'a'.repeat(64);
