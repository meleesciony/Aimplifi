/**
 * The /cards minimum-path interest sentence (audit P2). The estimate covers ONLY
 * the cards with a carried balance AND a datable cycle; undatable cards and
 * next-cycle cards are excluded — so the sentence must name the covered set and
 * the exclusions, never let the total read as a complete statement. Rendered via
 * `minimumInterestNote` from the component file (the pattern `card-identity-view`
 * established for copy beside a component). Byte-locked here.
 */
import { describe, expect, it, vi } from 'vitest';

// CardsBreakdown now mounts AccountNameControl, which imports renameAccount.
// This file only exercises minimumInterestNote copy; keep the action out of vitest.
vi.mock('@/components/finance/account-name-form', () => ({
  AccountNameControl: () => null,
}));
vi.mock('@/components/finance/card-statement-control', () => ({
  CardStatementControl: () => null,
}));

import { minimumInterestNote } from '@/components/finance/cards-breakdown';

describe('minimumInterestNote (audit P2 — names the covered set)', () => {
  it('prints the covered count with the method disclosure when nothing is excluded', () => {
    expect(minimumInterestNote(673600, 2, 0, 0)).toBe(
      "Minimum path costs ≈ $6,736.00 in interest next cycle on the 2 cards that carry a balance (estimated by the average-daily-balance method at each card's APR; new purchases aren't included).",
    );
  });

  it('names undated and next-cycle cards as excluded when both exist', () => {
    expect(minimumInterestNote(610800, 1, 1, 2)).toBe(
      "Minimum path costs ≈ $6,108.00 in interest next cycle on the 1 card that carries a balance (estimated by the average-daily-balance method at each card's APR; new purchases aren't included, and 1 card with no statement date and 2 next-cycle cards aren't counted).",
    );
  });

  it('lists a single excluded set without inventing the other, with correct agreement', () => {
    expect(minimumInterestNote(10000, 1, 2, 0)).toBe(
      "Minimum path costs ≈ $100.00 in interest next cycle on the 1 card that carries a balance (estimated by the average-daily-balance method at each card's APR; new purchases aren't included, and 2 cards with no statement date aren't counted).",
    );
    expect(minimumInterestNote(10000, 1, 0, 1)).toBe(
      "Minimum path costs ≈ $100.00 in interest next cycle on the 1 card that carries a balance (estimated by the average-daily-balance method at each card's APR; new purchases aren't included, and 1 next-cycle card isn't counted).",
    );
  });

  it('a paid-in-full cycle (zero carried cards) says so instead of counting zero cards (critic F5)', () => {
    expect(minimumInterestNote(0, 0, 0, 0)).toBe(
      "Minimum path costs ≈ $0.00 in interest next cycle, because every card is paid in full (estimated by the average-daily-balance method at each card's APR; new purchases aren't included).",
    );
  });

  it('pluralizes the covered count', () => {
    expect(minimumInterestNote(610800, 1, 0, 0)).toContain('on the 1 card that carries');
    expect(minimumInterestNote(1221600, 2, 0, 0)).toContain('on the 2 cards that carry');
  });
});
