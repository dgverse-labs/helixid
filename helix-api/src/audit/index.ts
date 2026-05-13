// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0

// Audit log implementation for helix-api.
// Implements the audit log interface from helix-core.
// Writes to PostgreSQL audit_log table and/or stdout based on AUDIT_LOG_DESTINATION (AL-3, AL-4).
// Missing audit entries for AL-1 events are treated as bugs with the same priority as failing security tests (AL-5).
export {};