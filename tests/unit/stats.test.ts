/**
 * The shared median (src/lib/stats.ts), extracted from five engines that had each
 * grown their own copy — with three different even-count roundings between them
 * (2026-07-21 agent review, finding B4).
 *
 * These tests pin the two things the extraction promised: the utility returns the
 * EXACT median (rounding is the caller's stated decision, not a hidden one), and
 * empty input still yields NaN, which is precisely what all five copies produced
 * before via `undefined + undefined`. The engines' own suites (money signature,
 * anomaly radar, merchant lens, FI insights, recurring detection) remain the
 * proof that each call site's figures are unchanged.
 */
import { describe, expect, it } from 'vitest';
import { median, medianOfSorted } from '@/lib/stats';

describe('medianOfSorted — exact median of a sorted list', () => {
  it('odd count returns the middle element unchanged', () => {
    expect(medianOfSorted([1, 2, 3])).toBe(2);
    expect(medianOfSorted([7])).toBe(7);
    expect(medianOfSorted([-500, -100, 0, 250, 900])).toBe(0);
  });

  it('even count returns the UNROUNDED mean of the two middles', () => {
    expect(medianOfSorted([1, 2])).toBe(1.5);
    expect(medianOfSorted([100, 101, 102, 103])).toBe(101.5);
    // The .5 is the whole point: floor/round/raw are three different answers,
    // and each caller states which one it wants.
    expect(Math.floor(medianOfSorted([100, 101]))).toBe(100);
    expect(Math.round(medianOfSorted([100, 101]))).toBe(101);
  });

  it('empty input is NaN — the value every local copy already returned', () => {
    expect(medianOfSorted([])).toBeNaN();
  });

  it('negative and zero cents are ordinary values, not sentinels', () => {
    expect(medianOfSorted([-300, -200, -100])).toBe(-200);
    expect(medianOfSorted([0, 0])).toBe(0);
  });
});

describe('median — sorts first, without touching the caller’s array', () => {
  it('orders numerically, not lexicographically (the [2, 10] trap)', () => {
    expect(median([10, 2, 3])).toBe(3);
    expect(median([1000, 200])).toBe(600);
  });

  it('does not mutate the input', () => {
    const xs = [5, 1, 4];
    expect(median(xs)).toBe(4);
    expect(xs).toEqual([5, 1, 4]);
  });

  it('agrees with medianOfSorted on already-sorted input', () => {
    const sorted = [1, 4, 9, 16];
    expect(median(sorted)).toBe(medianOfSorted(sorted));
  });

  it('empty input is NaN', () => {
    expect(median([])).toBeNaN();
  });
});
