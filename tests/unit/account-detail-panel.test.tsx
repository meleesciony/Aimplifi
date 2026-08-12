// @vitest-environment jsdom
/**
 * Renders of the /accounts in-place detail panel (the mortgage dead-end slice,
 * U.3) — including, deliberately FIRST, the shape a REAL account gets before
 * U.4's writer has recorded a month for it (no snapshots, and no SimpleFIN loan
 * carries aprBps/minimum/due): the role line plus the honest no-history line.
 * The U.3 critic's finding #3 — the demo e2e alone proved only the seed's best
 * case.
 *
 * Since U.4 the panel also has to separate two things that look identical in a
 * list of dated figures: balances the bank actually sent, and the last one
 * repeated monthly after the feed went quiet.
 */
import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

// This config does not enable vitest globals, so RTL's auto-cleanup does not
// run — without this, renders accumulate and getBy* finds duplicates.
afterEach(cleanup);
import { AccountDetailPanel } from '@/components/finance/account-detail-panel';
import type { AccountView } from '@/lib/engine/transactions/query';

const mortgage: AccountView = {
  id: 'acct-m',
  name: 'Home Mortgage',
  type: 'MORTGAGE',
  mask: null,
  currentBalanceCents: 41230000,
};

describe('AccountDetailPanel', () => {
  it('a REAL synced mortgage — no snapshots, no loan facts — still answers the click with facts, not blanks', () => {
    render(
      <AccountDetailPanel
        account={mortgage}
        isLiability
        detail={{ id: 'acct-m', history: [], aprBps: null, minimumPaymentCents: null, dueDayOfMonth: null, feedDroppedAt: null }}
      />,
    );
    const panel = screen.getByTestId('account-detail-panel');
    expect(panel.textContent).toContain('Mortgage — counts toward your net worth as money you owe');
    expect(panel.textContent).toContain('tracked by its balance instead of an activity feed');
    // The honest absence, named — never an empty box, never a promise of
    // history no writer produces.
    expect(screen.getByTestId('account-detail-no-history').textContent).toContain(
      'No balance history recorded',
    );
    expect(screen.queryByTestId('account-detail-loan-facts')).toBeNull();
    expect(screen.queryByTestId('account-detail-history')).toBeNull();
  });

  it('loan facts render only the facts the feed supplied, formatted from their stored units', () => {
    render(
      <AccountDetailPanel
        account={{ ...mortgage, id: 'acct-l', type: 'LOAN' }}
        isLiability
        detail={{ id: 'acct-l', history: [], aprBps: 649, minimumPaymentCents: 38500, dueDayOfMonth: 5, feedDroppedAt: null }}
      />,
    );
    const facts = screen.getByTestId('account-detail-loan-facts');
    expect(facts.textContent).toContain('APR 6.49%');
    expect(facts.textContent).toContain('minimum payment $385.00');
    expect(facts.textContent).toContain('due on day 5 of the month');
  });

  it("history rows carry the row's own liability sign — the panel may never call the balance a different number than the line the reader tapped", () => {
    render(
      <AccountDetailPanel
        account={mortgage}
        isLiability
        detail={{
          id: 'acct-m',
          history: [
            { date: '2026-04-30', balanceCents: 41500000 },
            { date: '2026-05-31', balanceCents: 41230000 },
          ],
          aprBps: null,
          minimumPaymentCents: null,
          dueDayOfMonth: null,
          feedDroppedAt: null,
        }}
      />,
    );
    const history = screen.getByTestId('account-detail-history');
    expect(history.textContent).toContain('−$412,300.00');
    expect(history.textContent).toContain('−$415,000.00');
    expect(screen.queryByTestId('account-detail-no-history')).toBeNull();
  });

  it('rows recorded after the feed went quiet are marked carried-forward, never printed as readings (U.4 P0)', () => {
    // The mechanism: U.4 records EVERY account each month — including one the
    // bank stopped sharing — because the trend's totals must keep counting it
    // (L.14). So the list mixes balances the bank sent with the last one
    // repeated, and the amber note above this panel already tells the reader
    // "it has not changed since". Unmarked, a monthly column of identical dated
    // figures reads as proof the app has been checking all along.
    render(
      <AccountDetailPanel
        account={mortgage}
        isLiability
        detail={{
          id: 'acct-m',
          history: [
            { date: '2026-03-01', balanceCents: 31000000 }, // before the drop: a real reading
            { date: '2026-04-01', balanceCents: 31000000 }, // after: carried forward
            { date: '2026-05-01', balanceCents: 31000000 },
          ],
          aprBps: null,
          minimumPaymentCents: null,
          dueDayOfMonth: null,
          feedDroppedAt: '2026-03-15',
        }}
      />,
    );
    // Exactly the rows after the drop date, not the one before it.
    expect(screen.getAllByTestId('account-detail-carried')).toHaveLength(2);
    const note = screen.getByTestId('account-detail-carried-note').textContent ?? '';
    expect(note).toContain('2 rows repeat the last balance your bank sent');
    expect(note).toContain('Sun, Mar 15, 2026');
    expect(note).toContain('nothing has been read from this account since');
  });

  it('a live feed marks nothing as carried forward', () => {
    render(
      <AccountDetailPanel
        account={mortgage}
        isLiability
        detail={{
          id: 'acct-m',
          history: [{ date: '2026-05-01', balanceCents: 31000000 }],
          aprBps: null,
          minimumPaymentCents: null,
          dueDayOfMonth: null,
          feedDroppedAt: null,
        }}
      />,
    );
    expect(screen.queryByTestId('account-detail-carried')).toBeNull();
    expect(screen.queryByTestId('account-detail-carried-note')).toBeNull();
  });

  it('an asset account reads "money you own" and paints no minus sign', () => {
    render(
      <AccountDetailPanel
        account={{ ...mortgage, id: 'acct-re', name: 'Primary Home', type: 'REAL_ESTATE' }}
        isLiability={false}
        detail={{
          id: 'acct-re',
          history: [{ date: '2026-05-31', balanceCents: 65000000 }],
          aprBps: null,
          minimumPaymentCents: null,
          dueDayOfMonth: null,
          feedDroppedAt: null,
        }}
      />,
    );
    const panel = screen.getByTestId('account-detail-panel');
    expect(panel.textContent).toContain('money you own');
    expect(panel.textContent).toContain('$650,000.00');
    expect(panel.textContent).not.toContain('−$650,000.00');
  });
});
