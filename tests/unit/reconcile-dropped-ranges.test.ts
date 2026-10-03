/**
 * `reconciliationDroppedRanges` is the exact complement of the boundary's own keep rule
 * (`reconciliationTxnKeepFilter`), day by day — so Ask's "which days does this combined
 * card's record cover" can never drift from what every other surface keeps (#781, critic
 * cycle 3). Checked over every day of two years, for chains, fan-in, a cutover before the
 * predecessor's first row (A-F8: degenerate, keeps everything), and a predecessor with no rows.
 */
import { describe, expect, it } from 'vitest';
import { addDays, compareDates, isoDate, type ISODate } from '@/lib/dates';
import { reconciliationDroppedRanges, reconciliationTxnKeepFilter } from '@/lib/engine/account/reconcile-boundary';

const acct = (id: string) => ({ id, type: 'CREDIT', currency: 'USD', currentBalanceCents: 0 });

function check(
  accounts: ReturnType<typeof acct>[],
  links: { predecessorAccountId: string; successorAccountId: string; cutoverDate: string }[],
  spans: { accountId: string; first: string; last: string }[],
) {
  const keeps = reconciliationTxnKeepFilter(accounts, links, spans);
  const dropped = reconciliationDroppedRanges(accounts, links, spans);
  let days = 0;
  for (const a of accounts) {
    for (let d: ISODate = isoDate('2025-06-01'); compareDates(d, isoDate('2027-06-01')) <= 0; d = addDays(d, 1)) {
      const inDrop = (dropped.get(a.id) ?? []).some((r) => compareDates(r.from, d) <= 0 && compareDates(d, r.to) <= 0);
      expect(inDrop, `${a.id} ${d}`).toBe(!keeps(a.id, d));
      days++;
    }
  }
  return days;
}

describe('reconciliationDroppedRanges is the keep rule, inverted', () => {
  it('a chain of three, both cutovers mid-record', () => {
    const days = check(
      [acct('a'), acct('b'), acct('c')],
      [
        { predecessorAccountId: 'a', successorAccountId: 'b', cutoverDate: '2026-03-15' },
        { predecessorAccountId: 'b', successorAccountId: 'c', cutoverDate: '2026-07-31' },
      ],
      [
        { accountId: 'a', first: '2025-09-01', last: '2026-05-01' },
        { accountId: 'b', first: '2026-02-01', last: '2026-09-10' },
      ],
    );
    expect(days).toBeGreaterThan(2000);
  });

  it('two old records into one, a degenerate cutover, and an old record with no rows', () => {
    check(
      [acct('p1'), acct('p2'), acct('s'), acct('q'), acct('t'), acct('r')],
      [
        { predecessorAccountId: 'p1', successorAccountId: 's', cutoverDate: '2026-04-30' },
        { predecessorAccountId: 'p2', successorAccountId: 's', cutoverDate: '2026-06-15' },
        // Cutover before its first row: the claim is degenerate and it keeps everything.
        { predecessorAccountId: 'q', successorAccountId: 't', cutoverDate: '2025-12-31' },
        // No rows at all: it claims nothing, but still drops every day after its cutover.
        { predecessorAccountId: 'r', successorAccountId: 't', cutoverDate: '2026-02-01' },
      ],
      [
        { accountId: 'p1', first: '2025-10-01', last: '2026-08-01' },
        { accountId: 'p2', first: '2026-01-10', last: '2026-06-01' },
        { accountId: 'q', first: '2026-01-05', last: '2026-09-01' },
      ],
    );
  });

  it('nothing is dropped where nothing is linked', () => {
    expect(reconciliationDroppedRanges([acct('x')], [], []).size).toBe(0);
  });
});
