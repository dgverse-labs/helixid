// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0

/**
 * The single seam that reads runtime configuration (dev spec §6).
 *
 * In containers, window.__HELIXID_CONFIG__ is populated by env-config.js,
 * generated from the container's environment at startup — the same
 * pre-built image runs with different values per environment, so these
 * cannot be build-time Vite variables. The import.meta.env.VITE_* fallback
 * exists only for local `npm run dev`.
 *
 * Every consumer (api/client.ts for the API config, the auth gate for the
 * console credentials) reads through this module so there is exactly one
 * place in the app that touches the injected config object.
 */

export interface HelixRuntimeConfig {
  API_BASE_URL?: string;
  ADMIN_API_KEY?: string;
  /** Console login username (client-side gate only — see §8 scope note). */
  CONSOLE_USERNAME?: string;
  /** Console login password (client-side gate only — see §8 scope note). */
  CONSOLE_PASSWORD?: string;
}

declare global {
  interface Window {
    __HELIXID_CONFIG__?: HelixRuntimeConfig;
  }
}

function runtime(): HelixRuntimeConfig | undefined {
  return typeof window === 'undefined' ? undefined : window.__HELIXID_CONFIG__;
}

function env(key: string): string | undefined {
  return import.meta.env[key] as string | undefined;
}

export interface ApiConfig {
  apiBaseUrl: string;
  adminApiKey: string;
}

export function getApiConfig(): ApiConfig {
  const config = runtime();
  return {
    // API_BASE_URL must be reachable from the operator's browser (the
    // browser makes the calls), not the compose-internal DNS name.
    apiBaseUrl: config?.API_BASE_URL ?? env('VITE_API_BASE_URL') ?? '',
    adminApiKey: config?.ADMIN_API_KEY ?? env('VITE_ADMIN_API_KEY') ?? '',
  };
}

export interface AuthConfig {
  username: string;
  password: string;
}

/**
 * Credentials for the client-side login gate (§8 override). Defaults to
 * admin / admin but is overridable per environment via runtime config.
 * These are never hardcoded in a component.
 */
export function getAuthConfig(): AuthConfig {
  const config = runtime();
  return {
    username: config?.CONSOLE_USERNAME ?? env('VITE_CONSOLE_USERNAME') ?? 'admin',
    password: config?.CONSOLE_PASSWORD ?? env('VITE_CONSOLE_PASSWORD') ?? 'admin',
  };
}
