export const ALLOWED_PRIVILEGE_SCOPES = [
  'read:orders',
  'write:orders',
  'read:profile',
  'write:profile',
  'read:payments',
  'write:payments',
  'read:inventory',
  'write:inventory',
] as const;

export type PrivilegeScope = (typeof ALLOWED_PRIVILEGE_SCOPES)[number];

export const SCOPE_PATTERN = /^[a-z]+:[a-z_]+$/;
