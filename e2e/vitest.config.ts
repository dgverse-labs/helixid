// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0

import { defineConfig } from 'vitest/config';

// Without a config file of its own, vitest run from this directory climbs
// up and picks up the workspace root's vitest.config.ts (since vitest.config
// now lives at the repo root, with e2e/ as a sibling underneath it) --
// including that config's setupFiles: ['./tests/setup.ts'], resolved
// against *this* package's cwd, where no such file exists ("Cannot find
// module '.../e2e/tests/setup.ts'"). This package's tests are currently
// all it.todo() stubs needing no setup at all, so an empty config is enough
// to stop the accidental inheritance.
export default defineConfig({});
