/**
 * Employer-match status for the W.6(b) next-dollar rung (DECISIONS #528).
 *
 * Match is a RUNG, not a rate we compare to APR (#510). This module is the one
 * boundary where a Settings form string (or the stored column) becomes the
 * closed union `nextDollar` already consumes. We do not collect a percentage —
 * a "50% match on the first 6%" is two numbers and is not comparable to a loan
 * APR — and we do not invent uncaptured from a missing or garbage column.
 *
 * Pure: no React, no DB, no `new Date()`.
 */
import type { EmployerMatch } from '@/lib/engine/fi/next-dollar';

/** Stored column values. Null in the DB is `unknown` (the ranking skip). */
export const STORED_EMPLOYER_MATCH = ['uncaptured', 'captured', 'none'] as const;
export type StoredEmployerMatch = (typeof STORED_EMPLOYER_MATCH)[number];

const STORED = new Set<string>(STORED_EMPLOYER_MATCH);

/**
 * Form / column → ranking input.
 *
 * Empty, whitespace, "unknown", null, and anything not in the closed set all
 * become `unknown` — the fail-safe is SKIP the rung, never pick "capture the
 * match" from a corrupt or omitted field.
 */
export function parseEmployerMatch(raw: string | null | undefined): EmployerMatch {
  const v = (raw ?? '').trim();
  if (v === '' || v === 'unknown') return 'unknown';
  if (STORED.has(v)) return v as StoredEmployerMatch;
  return 'unknown';
}

/** What the Settings radios write. `unknown` stores as SQL null. */
export function employerMatchToColumn(status: EmployerMatch): string | null {
  return status === 'unknown' ? null : status;
}
