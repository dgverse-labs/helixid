// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0

// HelixClient — public surface of the SDK (AC-5).
// All SDK consumers interact with helix-api through this class only.
// SA-1: private key never leaves the agent — buildAndSignVP executes entirely client-side.
export class HelixClient {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_baseUrl: string) {
    // placeholder — full implementation in Story 4
  }
}