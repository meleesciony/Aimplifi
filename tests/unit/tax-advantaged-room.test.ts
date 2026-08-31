/**
 * Tax-advantaged contribution-room parse — Settings form / stored column →
 * the closed union `nextDollar` consumes. Hand-verified against
 * tests/edge-cases/tax-advantaged-room-settings-w-6-b.md.
 *
 * Fail-safe is SKIP (`unknown`), never invent `remaining` from garbage.
 */
import { describe, expect, it } from 'vitest';

import {
  parseTaxAdvantagedRoom,
  taxAdvantagedRoomToColumn,
} from '@/lib/engine/settings/tax-advantaged-room';

describe('parseTaxAdvantagedRoom', () => {
  it('TR1 empty / unknown / null / whitespace → unknown', () => {
    expect(parseTaxAdvantagedRoom('')).toBe('unknown');
    expect(parseTaxAdvantagedRoom('   ')).toBe('unknown');
    expect(parseTaxAdvantagedRoom('unknown')).toBe('unknown');
    expect(parseTaxAdvantagedRoom(null)).toBe('unknown');
    expect(parseTaxAdvantagedRoom(undefined)).toBe('unknown');
  });

  it('TR2 closed-set values pass through', () => {
    expect(parseTaxAdvantagedRoom('remaining')).toBe('remaining');
    expect(parseTaxAdvantagedRoom('maxed')).toBe('maxed');
    expect(parseTaxAdvantagedRoom('none')).toBe('none');
    expect(parseTaxAdvantagedRoom('  remaining  ')).toBe('remaining');
  });

  it('test_regression__garbage_tax_room_column_is_unknown_never_remaining', () => {
    expect(parseTaxAdvantagedRoom('yes')).toBe('unknown');
    expect(parseTaxAdvantagedRoom('7000')).toBe('unknown');
    expect(parseTaxAdvantagedRoom('REMAINING')).toBe('unknown');
    expect(parseTaxAdvantagedRoom('has_room')).toBe('unknown');
    expect(parseTaxAdvantagedRoom('true')).toBe('unknown');
  });
});

describe('taxAdvantagedRoomToColumn', () => {
  it('unknown stores as null; the three facts store as themselves', () => {
    expect(taxAdvantagedRoomToColumn('unknown')).toBeNull();
    expect(taxAdvantagedRoomToColumn('remaining')).toBe('remaining');
    expect(taxAdvantagedRoomToColumn('maxed')).toBe('maxed');
    expect(taxAdvantagedRoomToColumn('none')).toBe('none');
  });
});
