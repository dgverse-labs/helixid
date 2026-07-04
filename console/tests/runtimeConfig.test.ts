// Copyright 2026 DgVerse LLP
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getApiConfig, getAuthConfig } from '../src/runtimeConfig';

describe('runtimeConfig', () => {
  beforeEach(() => {
    delete window.__HELIXID_CONFIG__;
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    delete window.__HELIXID_CONFIG__;
    vi.unstubAllEnvs();
  });

  it('prefers window runtime config for both API and auth', () => {
    window.__HELIXID_CONFIG__ = {
      API_BASE_URL: 'http://runtime:4000',
      ADMIN_API_KEY: 'runtime-key',
      CONSOLE_USERNAME: 'ops',
      CONSOLE_PASSWORD: 'pw',
    };
    expect(getApiConfig()).toEqual({ apiBaseUrl: 'http://runtime:4000', adminApiKey: 'runtime-key' });
    expect(getAuthConfig()).toEqual({ username: 'ops', password: 'pw' });
  });

  it('falls back to VITE_* env vars for local dev', () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://env:4000');
    vi.stubEnv('VITE_ADMIN_API_KEY', 'env-key');
    vi.stubEnv('VITE_CONSOLE_USERNAME', 'envuser');
    vi.stubEnv('VITE_CONSOLE_PASSWORD', 'envpass');
    expect(getApiConfig()).toEqual({ apiBaseUrl: 'http://env:4000', adminApiKey: 'env-key' });
    expect(getAuthConfig()).toEqual({ username: 'envuser', password: 'envpass' });
  });

  it('defaults auth to admin/admin when nothing is configured', () => {
    // No window config and no VITE_CONSOLE_* env → the built-in default.
    expect(getAuthConfig()).toEqual({ username: 'admin', password: 'admin' });
  });

  it('falls back to empty strings for API config when unset', () => {
    // Stub the API env empty so the assertion is independent of any local .env.
    vi.stubEnv('VITE_API_BASE_URL', '');
    vi.stubEnv('VITE_ADMIN_API_KEY', '');
    expect(getApiConfig()).toEqual({ apiBaseUrl: '', adminApiKey: '' });
  });
});
