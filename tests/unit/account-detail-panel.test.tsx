// @vitest-environment jsdom
/**
 * Renders of the /accounts in-place detail panel (the mortgage dead-end slice,
 * U.3) — including, deliberately FIRST, the shape a REAL synced account gets:
 * no BalanceSnapshot rows exist outside the seed (only prisma/seed.ts writes
 * them — TASKS U.4) and no SimpleFIN loan carries aprBps/minimum/due, so the
 * production panel is the role line + the honest no-history line. The critic's
 * finding #3: the demo e2e alone proved only the seed's best case.
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
        detail={{ id: 'acct-m', history: [], aprBps: null, minimumPaymentCents: null, dueDayOfMonth: null }}
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
        detail={{ id: 'acct-l', history: [], aprBps: 649, minimumPaymentCents: 38500, dueDayOfMonth: 5 }}
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
        }}
      />,
    );
    const history = screen.getByTestId('account-detail-history');
    expect(history.textContent).toContain('−$412,300.00');
    expect(history.textContent).toContain('−$415,000.00');
    expect(screen.queryByTestId('account-detail-no-history')).toBeNull();
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
        }}
      />,
    );
    const panel = screen.getByTestId('account-detail-panel');
    expect(panel.textContent).toContain('money you own');
    expect(panel.textContent).toContain('$650,000.00');
    expect(panel.textContent).not.toContain('−$650,000.00');
  });
});
