/**
 * Domain enums as string-literal unions — mirror the Prisma enums so the web app
 * can depend on them without importing the Prisma client (server-only).
 */

export const ARTWORK_STATUS = [
  'draft',
  'active',
  'on_loan',
  'on_exhibition',
  'in_storage',
  'in_restoration',
  'in_transit',
  'sold',
  'deaccessioned',
  'archived',
] as const;
export type ArtworkStatus = (typeof ARTWORK_STATUS)[number];

export const CONDITION_RATING = [
  'excellent',
  'good',
  'fair',
  'poor',
  'critical',
  'unknown',
] as const;
export type ConditionRating = (typeof CONDITION_RATING)[number];

export const AUTHENTICATION_STATUS = [
  'authenticated',
  'attributed',
  'workshop',
  'after',
  'follower',
  'manner_of',
  'forgery',
  'unverified',
] as const;
export type AuthenticationStatus = (typeof AUTHENTICATION_STATUS)[number];

export const ACQUISITION_METHOD = [
  'purchase',
  'donation',
  'bequest',
  'commission',
  'exchange',
  'loan_in',
  'found',
  'unknown',
] as const;
export type AcquisitionMethod = (typeof ACQUISITION_METHOD)[number];

export const CURRENCY = ['EUR', 'USD', 'GBP', 'CHF', 'JPY'] as const;
export type Currency = (typeof CURRENCY)[number];

/** Tailwind/utility tone used for status chips in the UI. */
export const ARTWORK_STATUS_TONE: Record<
  ArtworkStatus,
  'neutral' | 'success' | 'info' | 'warning' | 'danger' | 'violet'
> = {
  draft: 'neutral',
  active: 'success',
  on_loan: 'info',
  on_exhibition: 'violet',
  in_storage: 'neutral',
  in_restoration: 'warning',
  in_transit: 'info',
  sold: 'danger',
  deaccessioned: 'danger',
  archived: 'neutral',
};

export const CONDITION_TONE: Record<
  ConditionRating,
  'neutral' | 'success' | 'info' | 'warning' | 'danger'
> = {
  excellent: 'success',
  good: 'success',
  fair: 'warning',
  poor: 'danger',
  critical: 'danger',
  unknown: 'neutral',
};
