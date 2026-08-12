import { describe, expect, it } from 'vitest';
import { netWorthDelta, netWorthLiveBasis, netWorthPointBasis } from '@/lib/engine/networth/panel';
import { cents } from '@/lib/money';
import { isoDate } from '@/lib/dates';

/**
 * A trend point; only the fields the delta rule reads. `liabilityIds` is the
 * subset counted as money OWED at that point — a per-point property since U.6,
 * because the row carries the class it was recorded under.
 *
 * Constituent balances default to a non-zero magnitude because the class check
 * ignores an account worth $0.00 on the previous point (a class change there
 * moves the figure by 2 × 0). Pass `zeroIds` for that case explicitly.
 */
function point(
  date: string,
  netWorthCents: number,
  accountIds: string[],
  liabilityIds: string[] = [],
  zeroIds: string[] = [],
) {
  return {
    date,
    netWorthCents,
    constituents: accountIds.map((accountId) => ({
      accountId,
      isLiability: liabilityIds.includes(accountId),
      balanceCents: zeroIds.includes(accountId)
        ? 0
        : liabilityIds.includes(accountId)
          ? -10_000_00
          : 10_000_00,
    })),
  };
}

describe('netWorthDelta — a difference is a change in wealth only across the SAME accounts (U.4)', () => {
  it('compares like for like and keeps the demo’s month-end wording byte-identical', () => {
    const out = netWorthDelta(
      point('2026-05-31', 400_000_00, ['chk', 'sav']),
      point('2026-06-10', 425_000_00, ['sav', 'chk']), // order must not matter
    );
    expect(out.deltaCents).toBe(25_000_00);
    expect(out.label).toBe('vs last month-end');
  });

  it('names the date when the previous point is not a month-end', () => {
    const out = netWorthDelta(
      point('2026-06-03', 50_000_00, ['chk']),
      point('2026-06-10', 51_000_00, ['chk']),
    );
    expect(out.deltaCents).toBe(1_000_00);
    expect(out.label).toBe('vs Wed, Jun 3, 2026'); // carries the year — "vs Wed, Jun 3" is ambiguous across a gap
    expect(out.label).not.toContain('month-end');
  });

  it('will not call a month-end "last month-end" across a gap', () => {
    // A user whose only trigger is the nightly cron can miss months. 38 days of
    // drift labelled as one month's is the same lie one month-end over.
    const out = netWorthDelta(
      point('2026-01-31', 100_000_00, ['chk']),
      point('2026-03-10', 90_000_00, ['chk']),
    );
    expect(out.label).toBe('vs Sat, Jan 31, 2026');
    expect(out.deltaCents).toBe(-10_000_00);
  });

  it('REFUSES the comparison when an account joined — the fabricated cliff', () => {
    // The real scenario: sign up Jun 3 with checking+savings (the writer claims
    // June), type the mortgage the /accounts placeholder advertises on Jun 20.
    // Subtracting prints −$251,200.00 as if wealth had evaporated.
    const out = netWorthDelta(
      point('2026-06-03', 50_000_00, ['chk', 'sav']),
      point('2026-06-20', -201_200_00, ['chk', 'sav', 'mortgage', 'card']),
    );
    expect(out.deltaCents).toBeNull();
    expect(out.label).toBe('No comparison — 2 accounts joined since Wed, Jun 3, 2026.');
  });

  it('REFUSES it in the flattering direction too, and counts one account as singular', () => {
    // Reverse the arrival order and the same subtraction prints +$50,000.00 in
    // emerald — the direction the planner's docblock calls dangerous.
    const out = netWorthDelta(
      point('2026-06-03', -250_000_00, ['mortgage']),
      point('2026-06-20', -200_000_00, ['mortgage', 'chk']),
    );
    expect(out.deltaCents).toBeNull();
    expect(out.label).toBe('No comparison — 1 account joined since Wed, Jun 3, 2026.');
  });

  it('REFUSES when an account left (a deleted row cascades its snapshots)', () => {
    const out = netWorthDelta(
      point('2026-05-31', -200_000_00, ['mortgage', 'chk']),
      point('2026-06-10', -250_000_00, ['mortgage']),
    );
    expect(out.deltaCents).toBeNull();
    expect(out.label).toBe('No comparison — 1 account left since Sun, May 31, 2026.');
  });

  it('names the churn without arithmetic when accounts both joined and left', () => {
    const out = netWorthDelta(
      point('2026-05-31', 10_000_00, ['old']),
      point('2026-06-10', 12_000_00, ['new']),
    );
    expect(out.deltaCents).toBeNull();
    expect(out.label).toBe('No comparison — the accounts counted have changed since Sun, May 31, 2026.');
  });

  // ── U.6: the same accounts, counted the other way round ─────────────────────
  // A reclassification used to re-sign BOTH points together — history was wrong
  // but the subtraction between two equally-wrong points still came out clean.
  // Now each row keeps the class it was read under, so this slice is what makes
  // two points genuinely disagree, and it owns the figure that disagreement
  // produces.
  it('REFUSES when an account crossed the own/owe line between the two points', () => {
    // $10,000 recorded as CHECKING in May, the feed calls it CREDIT in June:
    // 10,000 → −10,000 is a $20,000 "loss" in a month nothing was spent.
    const out = netWorthDelta(
      point('2026-05-31', 10_000_00, ['flip']),
      point('2026-06-10', -10_000_00, ['flip'], ['flip']),
    );
    expect(out.deltaCents).toBeNull();
    expect(out.label).toBe(
      'No comparison — since Sun, May 31, 2026 one account moved between the things you own and the things you owe, so the two dates are not measuring the same thing. Open that account on Accounts to see which balances were counted which way.',
    );
  });

  it('REFUSES in the flattering direction too, and counts more than one', () => {
    const out = netWorthDelta(
      point('2026-05-31', -30_000_00, ['a', 'b', 'c'], ['a', 'b']),
      point('2026-06-10', 30_000_00, ['a', 'b', 'c']),
    );
    expect(out.deltaCents).toBeNull();
    expect(out.label).toBe(
      'No comparison — since Sun, May 31, 2026 2 accounts moved between the things you own and the things you owe, so the two dates are not measuring the same thing. Open that account on Accounts to see which balances were counted which way.',
    );
  });

  it('still compares when the classes are stable — a like-for-like month is untouched', () => {
    const out = netWorthDelta(
      point('2026-05-31', -150_000_00, ['chk', 'mortgage'], ['mortgage']),
      point('2026-06-10', -148_000_00, ['chk', 'mortgage'], ['mortgage']),
    );
    expect(out.deltaCents).toBe(2_000_00);
    expect(out.label).toBe('vs last month-end');
  });

  it('names a changed SET and a changed class together — neither alone is the whole answer', () => {
    // Both are true here. "1 account joined" alone sends the reader to their
    // account list, where they find the new account and stop — a complete-looking
    // answer to half the question.
    const out = netWorthDelta(
      point('2026-05-31', 10_000_00, ['flip']),
      point('2026-06-10', -5_000_00, ['flip', 'new'], ['flip']),
    );
    expect(out.deltaCents).toBeNull();
    expect(out.label).toBe(
      'No comparison — 1 account joined since Sun, May 31, 2026, and one account moved between the things you own and the things you owe.',
    );
  });

  it('does NOT refuse over a $0.00 account that changed sides — a false refusal deletes a true figure', () => {
    // The routine case the critic found: a paid-off card sitting at $0.00 that
    // the feed moves CREDIT → OTHER_ASSET, while checking genuinely rose $2,000.
    // The subtraction is identical either way (−0 === +0), so refusing would
    // throw away a correct number and hand the reader a warning instead.
    const out = netWorthDelta(
      point('2026-05-31', 50_000_00, ['chk', 'card'], ['card'], ['card']),
      point('2026-06-10', 52_000_00, ['chk', 'card'], [], ['card']),
    );
    expect(out.deltaCents).toBe(2_000_00);
    expect(out.label).toBe('vs last month-end');
  });

  it('still refuses when the moved account carried a real balance on the earlier point', () => {
    // The distorting term is 2 × the PREVIOUS balance, so this is the case that
    // matters — and the one the $0.00 exemption must not swallow.
    const out = netWorthDelta(
      point('2026-05-31', -10_000_00, ['flip'], ['flip']),
      point('2026-06-10', 10_000_00, ['flip']),
    );
    expect(out.deltaCents).toBeNull();
    expect(out.label).toContain('one account moved between the things you own and the things you owe');
    expect(out.label).toContain('Open that account on Accounts');
  });

  it('counts an account once even when a point carries it twice', () => {
    // `netWorthSeries` blesses two same-account constituents on one date, and the
    // joined/left checks above use Sets — this must agree with them rather than
    // report "2 accounts moved" about one account.
    const prev = point('2026-05-31', 20_000_00, ['dup'], []);
    prev.constituents.push({ ...prev.constituents[0] });
    const curr = point('2026-06-10', -20_000_00, ['dup'], ['dup']);
    curr.constituents.push({ ...curr.constituents[0] });
    const out = netWorthDelta(prev, curr);
    expect(out.deltaCents).toBeNull();
    expect(out.label).toContain('one account moved');
    expect(out.label).not.toContain('2 accounts');
  });
});

describe('net-worth drilldown basis sentences (O.20d/O.20f)', () => {
  it('month-end point basis embeds the figure and date, and says "month-end"', () => {
    const basis = netWorthPointBasis(cents(120_00), isoDate('2026-04-30'));
    expect(basis.length).toBeGreaterThanOrEqual(2); // NON-EMPTY by type; locked again here
    // NOT "every account's" (U.4): a point can be missing an account that was
    // linked later or deleted since, and basis[1] says exactly that — so a first
    // sentence claiming completeness made the second one a retraction.
    expect(basis[0]).toBe(
      'The $120.00 is the sum of the month-end balances the app had recorded on Thu, Apr 30 — assets minus liabilities.',
    );
    expect(basis[0]).not.toContain('every account');
    expect(basis[1]).toContain('snapshots');
    expect(basis[1]).toContain('no snapshot then is not in it');
  });

  it('mid-month point basis reads "balance on", never "month-end" (O.20f P2-g)', () => {
    // The seed's `back === 0` snapshot is dated `asOf` — `npx prisma db seed
    // -- --asOf 2026-05-15` with DEMO_TODAY=2026-06-10 produces exactly one
    // mid-month point; calling a mid-month snapshot a "month-end balance"
    // would be the O.18c lie the composer exists to prevent.
    const basis = netWorthPointBasis(cents(120_00), isoDate('2026-05-15'));
    expect(basis[0]).toBe(
      'The $120.00 is the sum of the balances the app had recorded on Fri, May 15 — assets minus liabilities.',
    );
    expect(basis[0]).not.toContain('month-end');
  });

  it('live basis embeds the rendered figure and names manual items explicitly', () => {
    const basis = netWorthLiveBasis(cents(500_250_00));
    expect(basis[0]).toBe(
      'The $500,250.00 is today\'s live balance across every account — manual items included.',
    );
    expect(basis[1]).toContain('headline above');
    // The contrast is recorded-earlier vs right-now: "month-end" named a shape
    // that no longer exists on a live user's chart (U.4).
    expect(basis[1]).toContain('not a balance recorded earlier');
  });

  it('both tuples are non-empty (the BreakdownPanel contract)', () => {
    expect(netWorthPointBasis(cents(1), isoDate('2026-01-31')).length).toBeGreaterThan(0);
    expect(netWorthLiveBasis(cents(1)).length).toBeGreaterThan(0);
  });
});
