/**
 * Weekly self-audit Critic rates (TASKS 3.2 / DECISIONS #211) — known-answer tests.
 */
import { describe, expect, it } from 'vitest';
import { computeSelfAuditSnapshot, formatRateBps } from '@/lib/engine/audit/snapshot';

describe('computeSelfAuditSnapshot', () => {
  it('all zeros → all rates 0', () => {
    const r = computeSelfAuditSnapshot({
      reviewNeeding: 0,
      reviewTotal: 0,
      unknownStayed: 0,
      unknownAttempts: 0,
      alertsSent: 0,
      alertsActed: 0,
    });
    expect(r.reviewRateBps).toBe(0);
    expect(r.unknownRateBps).toBe(0);
    expect(r.alertActRateBps).toBe(0);
  });

  it('1/20 review → 500 bps (5.0%)', () => {
    expect(
      computeSelfAuditSnapshot({
        reviewNeeding: 1,
        reviewTotal: 20,
        unknownStayed: 0,
        unknownAttempts: 0,
        alertsSent: 0,
        alertsActed: 0,
      }).reviewRateBps,
    ).toBe(500);
  });

  it('3/10 unknown → 3000 bps', () => {
    expect(
      computeSelfAuditSnapshot({
        reviewNeeding: 0,
        reviewTotal: 0,
        unknownStayed: 3,
        unknownAttempts: 10,
        alertsSent: 0,
        alertsActed: 0,
      }).unknownRateBps,
    ).toBe(3000);
  });

  it('2/8 alerts acted → 2500 bps', () => {
    expect(
      computeSelfAuditSnapshot({
        reviewNeeding: 0,
        reviewTotal: 0,
        unknownStayed: 0,
        unknownAttempts: 0,
        alertsSent: 8,
        alertsActed: 2,
      }).alertActRateBps,
    ).toBe(2500);
  });

  it('numerator above denom clamps via min (never >100%)', () => {
    expect(
      computeSelfAuditSnapshot({
        reviewNeeding: 5,
        reviewTotal: 3,
        unknownStayed: 0,
        unknownAttempts: 0,
        alertsSent: 0,
        alertsActed: 0,
      }).reviewRateBps,
    ).toBe(10000);
  });

  it('formatRateBps', () => {
    expect(formatRateBps(500)).toBe('5.0%');
    expect(formatRateBps(0)).toBe('0.0%');
  });
});
