// Audit log implementation for helix-api.
// Implements the audit log interface from helix-core.
// Writes to PostgreSQL audit_log table and/or stdout based on AUDIT_LOG_DESTINATION (AL-3, AL-4).
// Missing audit entries for AL-1 events are treated as bugs with the same priority as failing security tests (AL-5).
export {};
