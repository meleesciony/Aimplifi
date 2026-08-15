/**
 * The U.5 copy, locked where it lives (TASKS U.5).
 *
 * These sentences were inline ternaries in `account-detail-panel.tsx` for one
 * draft, and that draft shipped a singular/plural defect in the branch the
 * component test did not cover — the reason this repo's rule is that a rule
 * written in a .tsx cannot be locked by a unit test.
 */
import { describe, expect, it } from 'vitest';
import {
  replacedByLiveClassNote,
  replacedByLiveMarker,
  replacedByLiveNote,
  uncountedBalanceMarker,
  uncountedBalancesNote,
} from '@/lib/engine/account/balance-history-view';

describe('uncountedBalanceMarker', () => {
  it('names the figure the trend used, with the counterpart row’s own sign', () => {
    expect(uncountedBalanceMarker({ name: 'Auto Loan Retired', balanceCents: 1_430_000, isLiability: true })).toBe(
      'your net worth counts −$14,300.00 from Auto Loan Retired',
    );
  });

  it('an ASSET counterpart carries no minus — the sign is the row’s class, not the panel’s', () => {
    expect(uncountedBalanceMarker({ name: 'Old Savings', balanceCents: 250_000, isLiability: false })).toBe(
      'your net worth counts $2,500.00 from Old Savings',
    );
  });

  it('states only what is certain when no single counterpart owns the date', () => {
    // A chain: the date's owner is not this account's direct counterpart, so
    // naming one would attribute the balance to the wrong account.
    expect(uncountedBalanceMarker(null)).toBe('not in your net worth');
  });

  it('is never positional — "here" inside a list titled Recorded balance history contradicts itself', () => {
    // The L.19/L.20 correction, applied to a new marker in the same family.
    expect(uncountedBalanceMarker(null)).not.toContain('here');
    expect(uncountedBalanceMarker({ name: 'X', balanceCents: 1, isLiability: true })).not.toContain('here');
  });
});

describe('uncountedBalancesNote', () => {
  it('nothing uncounted → no sentence at all (the golden panel is byte-identical)', () => {
    expect(uncountedBalancesNote(0)).toBeNull();
    expect(uncountedBalancesNote(-1)).toBeNull();
  });

  it('agrees with itself in the singular', () => {
    const note = uncountedBalancesNote(1) ?? '';
    expect(note).toContain('One balance here is not in your net worth');
    expect(note).toContain('that date');
    expect(note).not.toContain('those dates');
  });

  it('agrees with itself in the plural', () => {
    const note = uncountedBalancesNote(3) ?? '';
    expect(note).toContain('3 balances here are not in your net worth');
    expect(note).toContain('those dates');
    expect(note).not.toContain('that date —');
  });

  it('never claims the two balances would "double" anything — they differ, which is why one has to win', () => {
    const note = uncountedBalancesNote(2) ?? '';
    expect(note).not.toContain('double');
    // Scoped to balances since U.9 — see the U.11 test below for why the
    // unqualified "the same account is not counted twice" had to go.
    expect(note).toContain('no balance is counted twice');
  });

  it('points at the surface that shows the pair, because the named account is folded out of the groups', () => {
    expect(uncountedBalancesNote(1) ?? '').toContain('Account cleanup');
  });

  it('U.9: never claims BOTH SIDES recorded a balance on the date — a sibling or chain member may be the winner', () => {
    // The displacing row can belong to a third account (a chain member, or a second
    // stale row continued onto the same live account), in which case this account's
    // own counterpart recorded nothing that date. The note may only claim that more
    // than one row DID record, never that a specific pair both observed it.
    for (const n of [1, 2, 5]) {
      const note = uncountedBalancesNote(n) ?? '';
      expect(note).not.toContain('both sides');
      expect(note).toContain('more than one of them recorded a balance');
    }
  });

  it('U.9: never says a SINGULAR "another one" / "the combination" — one live account can continue several', () => {
    // The only panel that renders this note is the live account's, and it may have
    // continued two old rows; the same page then says "Combines 2 old accounts into
    // this one" a few sections down.
    for (const n of [1, 2, 5]) {
      const note = uncountedBalancesNote(n) ?? '';
      expect(note).toContain('at least one other account');
      expect(note).not.toContain('with another one');
      expect(note).not.toContain('The combination is listed');
      expect(note).toContain('Your combined accounts are listed');
    }
  });

  it('U.9: certifies BALANCES only — U.11 measures the same account counted twice in spending', () => {
    // An unqualified "the same account is not counted twice" claims every figure the
    // account touches. Two stale feeds of one account still contribute a purchase
    // twice (TASKS U.11), so the sentence may only certify what this rule covers.
    for (const n of [1, 2]) {
      const note = uncountedBalancesNote(n) ?? '';
      expect(note).toContain('no balance is counted twice');
      expect(note).not.toContain('the same account is not counted twice');
      expect(note).not.toContain('double');
    }
  });

  it('U.9: states what HAPPENED, not what is possible — no modal "can describe"', () => {
    // The reader is asking why THEIR balance is missing; "more than one row can
    // describe the same account" is true, vacuous, and answers a different question.
    expect(uncountedBalancesNote(1) ?? '').not.toContain('can describe');
  });
});

describe('U.10 — replaced-by-live copy', () => {
  it('names the live overwrite, never a combine, a discarded figure, or a tomorrow promise', () => {
    expect(replacedByLiveMarker()).toBe("today's point is live");
    const note = replacedByLiveNote();
    expect(note).toBe(
      "One balance here is dated today. Today's chart point uses the live balance, " +
        'even when it still matches this recording.',
    );
    // The combine copy would be false of this row (no counterpart; the
    // account IS in today's net worth).
    expect(note).not.toContain('combined');
    expect(note).not.toContain('not in your net worth');
    expect(note).not.toContain('Account cleanup');
    // Demo / first-sync-of-month: recorded cents equal live. "not from this
    // recording" reads as discarded dollars. "Tomorrow" never arrives while
    // today is pinned, and a later combine can drop the row.
    expect(note).not.toContain('not from this recording');
    expect(note).not.toContain('Tomorrow');
    expect(replacedByLiveMarker()).not.toContain('not in your net worth');
  });

  it('a same-day class flip names the CURRENT class the live point uses', () => {
    expect(replacedByLiveClassNote('loan')).toBe(
      "Today's live point counts this account as loan, not as the class on this recording.",
    );
    expect(replacedByLiveClassNote('loan')).not.toContain('for that date it counts');
  });
});
