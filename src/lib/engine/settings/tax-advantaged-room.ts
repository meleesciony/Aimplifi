/**
 * Tax-advantaged contribution-room status for the W.6(b) next-dollar rung
 * (DECISIONS #529).
 *
 * Room is a RUNG, not an IRS limit we invent and not a vehicle we pick
 * (Roth vs 401(k) vs HSA — educational, not advisory). This module is the
 * one boundary where a Settings form string (or the stored column) becomes
 * the closed union `nextDollar` already consumes. We do not collect a dollar
 * amount — annual limits move, MAGI gates exist, and a number we cannot
 * ground would be fabrication — and we do not invent `remaining` from a
 * missing or garbage column.
 *
 * Pure: no React, no DB, no `new Date()`.
 */
import type { TaxAdvantagedRoom } from '@/lib/engine/fi/next-dollar';

/** Stored column values. Null in the DB is `unknown` (the ranking skip). */
export const STORED_TAX_ADVANTAGED_ROOM = ['remaining', 'maxed', 'none'] as const;
export type StoredTaxAdvantagedRoom = (typeof STORED_TAX_ADVANTAGED_ROOM)[number];

const STORED = new Set<string>(STORED_TAX_ADVANTAGED_ROOM);

/**
 * Form / column → ranking input.
 *
 * Empty, whitespace, "unknown", null, and anything not in the closed set all
 * become `unknown` — the fail-safe is SKIP the rung, never pick "fill
 * remaining room" from a corrupt or omitted field.
 */
export function parseTaxAdvantagedRoom(
  raw: string | null | undefined,
): TaxAdvantagedRoom {
  const v = (raw ?? '').trim();
  if (v === '' || v === 'unknown') return 'unknown';
  if (STORED.has(v)) return v as StoredTaxAdvantagedRoom;
  return 'unknown';
}

/** What the Settings radios write. `unknown` stores as SQL null. */
export function taxAdvantagedRoomToColumn(status: TaxAdvantagedRoom): string | null {
  return status === 'unknown' ? null : status;
}
