// @vitest-environment jsdom
/**
 * #791 critic cycle 1 (P2-4, P3): every branch of Home's cash-needed card names the payments
 * counted in transit — nothing due, dated cards still due, and the undated-cards branch — at
 * household scope with the owner of the card and the account, and the audit panel behind the
 * number says the same. Built from the REAL assembler and engine. Invented figures.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/server/engagement-actions', () => ({ logEngagement: vi.fn() }));
vi.mock('@/components/finance/card-statement-control', () => ({ CardStatementControl: () => null }));

import { cleanup, render, screen } from '@testing-library/react';
import { CashNeededCard } from '@/components/finance/cash-needed-card';
import { holidayTable, isoDate } from '@/lib/dates';
import { assembleCashNeededInput } from '@/lib/engine/cash-needed/assemble';
import { computeCashNeeded } from '@/lib/engine/cash-needed/engine';
import { traceCashNeeded } from '@/lib/engine/glass-box/trace';

afterEach(cleanup);

const TODAY = isoDate('2026-10-06');
type Row = { accountId: string; date: string; amountCents: number; rawDescriptor?: string };
const result = (rows: Row[], extraAccounts: { id: string; name: string; type: string; currentBalanceCents: number; aprBps: number | null; dueDayOfMonth: number | null; cycleCloseDayOfMonth: number | null }[] = []) =>
  computeCashNeeded(
    assembleCashNeededInput({
      today: TODAY,
      scenario: 'PAY_IN_FULL',
      paymentAccountId: 'chk',
      accounts: [
        { id: 'chk', name: 'Everyday Checking', type: 'CHECKING', currentBalanceCents: 300000, aprBps: null, dueDayOfMonth: null, cycleCloseDayOfMonth: null },
        { id: 'b', name: 'Card B', type: 'CREDIT', currentBalanceCents: 480000, aprBps: 2499, dueDayOfMonth: 5, cycleCloseDayOfMonth: 10 },
        { id: 'c', name: 'Card C', type: 'CREDIT', currentBalanceCents: 1010000, aprBps: 2499, dueDayOfMonth: 20, cycleCloseDayOfMonth: 25 },
        ...extraAccounts,
      ],
      autopays: [],
      statements: [
        { id: 'sb', accountId: 'b', cycleEnd: '2026-09-10', dueDate: '2026-10-05', statementBalanceCents: 432109, minimumPaymentCents: 4300 },
        { id: 'sc', accountId: 'c', cycleEnd: '2026-09-25', dueDate: '2026-10-20', statementBalanceCents: 98765, minimumPaymentCents: 3500 },
      ],
      cardPayments: [],
      transactions: rows.map((r) => ({ status: 'POSTED', isTransfer: true, rawDescriptor: 'NORTHWIND BANK CRCARDPMT', categoryId: 'transfer', ...r })),
      scheduled: [],
      holidayTable: holidayTable(2026, 2027),
    }),
  );
const PAID_B: Row = { accountId: 'chk', date: '2026-10-05', amountCents: -432109 };
const SENTENCE_B = 'Counted as paid before the card company shows it: $4,321.09 to Card B (left Everyday Checking Mon, Oct 5).';

describe('Home’s card names the payment on every branch', () => {
  it('cards still due (Card C, due Oct 20)', () => {
    const r = result([PAID_B]);
    expect(r.headline.requiredCents).toBe(98765);
    render(<CashNeededCard result={r} paymentAccountName="Everyday Checking" today={TODAY} />);
    expect(screen.getByTestId('cash-needed-in-transit').textContent).toContain(SENTENCE_B);
  });

  it('nothing due', () => {
    const r = result([PAID_B, { accountId: 'chk', date: '2026-10-05', amountCents: -98765 }]);
    expect(r.headline.requiredCents).toBe(0);
    render(<CashNeededCard result={r} paymentAccountName="Everyday Checking" today={TODAY} />);
    expect(screen.getByText('Cards: nothing due')).toBeTruthy();
    expect(screen.getByTestId('cash-needed-in-transit').textContent).toContain('$4,321.09 to Card B');
  });

  it('a card with no due date we can place', () => {
    const undated = { id: 'u', name: 'Store Card', type: 'CREDIT', currentBalanceCents: 50000, aprBps: 2999, dueDayOfMonth: null, cycleCloseDayOfMonth: null };
    const r = result([PAID_B, { accountId: 'chk', date: '2026-10-05', amountCents: -98765 }], [undated]);
    expect(r.headline.firstDueDate).toBeNull();
    expect(r.unknownDueDateCards.length).toBe(1);
    render(<CashNeededCard result={r} paymentAccountName="Everyday Checking" today={TODAY} />);
    expect(screen.getByTestId('cash-needed-in-transit').textContent).toContain('$4,321.09 to Card B');
  });

  it('household scope: the partner’s card and account carry their owner', () => {
    const r = result([PAID_B]);
    render(
      <CashNeededCard result={r} paymentAccountName="Everyday Checking" today={TODAY} householdName="The Smiths" accountOwnerLabel={{ b: 'Sam', chk: 'Sam' }} />,
    );
    expect(screen.getByTestId('cash-needed-in-transit').textContent).toContain(
      '$4,321.09 to Card B (Sam\'s) (left Everyday Checking (Sam\'s) Mon, Oct 5)',
    );
  });

  it('two cards with one name are told apart by the page’s own identity line (critic cycle 2, P3-2)', () => {
    const r = result([PAID_B]);
    render(<CashNeededCard result={r} paymentAccountName="Everyday Checking" today={TODAY} cardIdentity={{ b: '····6271', c: '····0966' }} />);
    expect(screen.getByTestId('cash-needed-in-transit').textContent).toContain('$4,321.09 to Card B ····6271 (left Everyday Checking');
  });

  it('nothing in transit, nothing said', () => {
    render(<CashNeededCard result={result([])} paymentAccountName="Everyday Checking" today={TODAY} />);
    expect(screen.queryByTestId('cash-needed-in-transit')).toBeNull();
  });
});

describe('the audit panel behind the number', () => {
  it('names the payment it counted as paid', () => {
    const trace = traceCashNeeded(result([PAID_B]));
    expect(trace.basis.join(' ')).toContain(SENTENCE_B);
    expect(traceCashNeeded(result([])).basis.join(' ')).not.toContain('Counted as paid');
  });
});
