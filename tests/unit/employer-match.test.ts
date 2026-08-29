/**
 * Employer-match status parse — Settings form / stored column → the closed
 * union `nextDollar` consumes. Hand-verified against
 * tests/edge-cases/employer-match-settings-w-6-b.md.
 *
 * Fail-safe is SKIP (`unknown`), never invent `uncaptured` from garbage.
 */
import { describe, expect, it } from 'vitest';

import {
  employerMatchToColumn,
  parseEmployerMatch,
} from '@/lib/engine/settings/employer-match';

describe('parseEmployerMatch', () => {
  it('EM1 empty / unknown / null / whitespace → unknown', () => {
    expect(parseEmployerMatch('')).toBe('unknown');
    expect(parseEmployerMatch('   ')).toBe('unknown');
    expect(parseEmployerMatch('unknown')).toBe('unknown');
    expect(parseEmployerMatch(null)).toBe('unknown');
    expect(parseEmployerMatch(undefined)).toBe('unknown');
  });

  it('EM2 closed-set values pass through', () => {
    expect(parseEmployerMatch('uncaptured')).toBe('uncaptured');
    expect(parseEmployerMatch('captured')).toBe('captured');
    expect(parseEmployerMatch('none')).toBe('none');
    expect(parseEmployerMatch('  captured  ')).toBe('captured');
  });

  it('test_regression__garbage_employer_match_column_is_unknown_never_uncaptured', () => {
    expect(parseEmployerMatch('yes')).toBe('unknown');
    expect(parseEmployerMatch('50')).toBe('unknown');
    expect(parseEmployerMatch('UNCAPTURED')).toBe('unknown');
    expect(parseEmployerMatch('true')).toBe('unknown');
  });
});

describe('employerMatchToColumn', () => {
  it('unknown stores as null; the three facts store as themselves', () => {
    expect(employerMatchToColumn('unknown')).toBeNull();
    expect(employerMatchToColumn('uncaptured')).toBe('uncaptured');
    expect(employerMatchToColumn('captured')).toBe('captured');
    expect(employerMatchToColumn('none')).toBe('none');
  });
});
