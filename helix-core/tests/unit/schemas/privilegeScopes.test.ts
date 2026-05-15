// Copyright 2026 DgVerse LLP
import { describe, it, expect } from 'vitest';
import { ALLOWED_PRIVILEGE_SCOPES, SCOPE_PATTERN } from '../../../src/schemas/privilegeScopes.js';

describe('Privilege Scopes', () => {
  it('has allowed scopes', () => {
    expect(ALLOWED_PRIVILEGE_SCOPES).toContain('read:orders');
    expect(ALLOWED_PRIVILEGE_SCOPES.length).toBeGreaterThan(0);
  });

  it('validates scope pattern', () => {
    expect(SCOPE_PATTERN.test('read:orders')).toBe(true);
    expect(SCOPE_PATTERN.test('write:profile_settings')).toBe(true);
    expect(SCOPE_PATTERN.test('invalid-scope')).toBe(false);
    expect(SCOPE_PATTERN.test('read:')).toBe(false);
    expect(SCOPE_PATTERN.test(':orders')).toBe(false);
  });
});
