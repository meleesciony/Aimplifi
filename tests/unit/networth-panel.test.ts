import { describe, expect, it } from 'vitest';
import { netWorthDelta, netWorthLiveBasis, netWorthPointBasis } from '@/lib/engine/networth/panel';
import { cents } from '@/lib/money';
import { isoDate } from '@/lib/dates';

/** A trend point; only the three fields the delta rule reads. */
function point(date: string, netWorthCents: number, accountIds: string[]) {
  return { date, netWorthCents, constituents: accountIds.map((accountId) => ({ accountId })) };
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
