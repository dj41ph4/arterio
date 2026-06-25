/** Canonical permission + role keys shared by web (UI gating) and api (enforcement). */

export const PERMISSIONS = {
  ARTWORK_READ: 'artwork:read',
  ARTWORK_CREATE: 'artwork:create',
  ARTWORK_UPDATE: 'artwork:update',
  ARTWORK_DELETE: 'artwork:delete',
  VALUATION_READ: 'valuation:read',
  VALUATION_UPDATE: 'valuation:update',
  LOAN_READ: 'loan:read',
  LOAN_APPROVE: 'loan:approve',
  EXHIBITION_MANAGE: 'exhibition:manage',
  RESTORATION_MANAGE: 'restoration:manage',
  DOCUMENT_SIGN: 'document:sign',
  USER_MANAGE: 'user:manage',
  SETTINGS_MANAGE: 'settings:manage',
  AUDIT_READ: 'audit:read',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const SYSTEM_ROLES = [
  'admin',
  'curator',
  'registrar',
  'conservator',
  'finance',
  'viewer',
] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];

export function hasPermission(granted: string[], required: PermissionKey): boolean {
  return granted.includes(required);
}
