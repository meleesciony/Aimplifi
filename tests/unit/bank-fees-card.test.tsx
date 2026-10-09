// @vitest-environment jsdom
/**
 * DECISIONS #796 — the "Fees you paid" card renders the engine verbatim: the lead, one
 * disclosure per kind (its line, how it is usually avoided, its rows, each row opening its
 * transaction with the way back to /coach), what came back, what is left out, the handover
 * note only when a counted row sits on a handover day, and the rule always. Invented figures.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { BankFeesCard } from '@/components/coach/bank-fees-card';
import { isoDate } from '@/lib/dates';
import { handoverKey } from '@/lib/engine/account/reconcile-boundary';
import { findBankFees, type BankFeeRowInput } from '@/lib/engine/fi/bank-fees';
import { BANK_FEES_RULE, FEE_KIND_COPY } from '@/lib/engine/fi/bank-fees-copy';

afterEach(cleanup);

const TODAY = isoDate('2026-10-17');
let n = 0;
const row = (
  accountId: string,
  date: string,
  amountCents: number,
  rawDescriptor: string,
  categoryId: string,
  extra: Partial<BankFeeRowInput> = {},
): BankFeeRowInput => ({
  id: `f${++n}`,
  accountId,
  date,
  amountCents,
  rawDescriptor,
  categoryId,
  isTransfer: false,
  status: 'POSTED',
  isSplitParent: false,
  excludeFromTotals: false,
  ...extra,
});

describe('BankFeesCard', () => {
  it('lays out the engine: lead, kinds with their rows and advice, given back, left out, rule', () => {
    n = 0;
    const fees = findBankFees(
      [
        row('chk', '2024-02-01', -500, 'BLUE DOOR COFFEE', 'coffee'),
        row('chk', '2026-09-03', -3_500, 'OVERDRAFT ITEM FEE', 'fees', { merchantName: 'Checking overdraft' }),
        row('chk', '2026-09-10', 3_500, 'OVERDRAFT FEE REFUND', 'fees'),
        row('card', '2026-05-20', -2_900, 'LATE FEE', 'late-fee'),
        row('card', '2026-05-20', -4_512, 'INTEREST CHARGE ON PURCHASES', 'fees'),
      ],
      TODAY,
    );
    render(<BankFeesCard fees={fees} />);

    expect(screen.getByTestId('bank-fees-card').id).toBe('fees-you-paid');
    expect(screen.getByTestId('bank-fees-lead').textContent).toBe(
      'You were charged $64.00 in bank fees (2 charges) in the last 12 months; $35.00 came back, so they cost you $29.00.',
    );

    const overdraft = screen.getByTestId('bank-fees-kind-overdraft');
    expect(overdraft.tagName).toBe('DETAILS');
    expect(overdraft.textContent).toContain('Overdraft and returned-item fees — $35.00 (1 charge)');
    expect(overdraft.textContent).toContain(FEE_KIND_COPY.overdraft.avoid);
    const link = within(screen.getByTestId('bank-fees-rows-overdraft')).getByTestId('bank-fee-row-link');
    expect(link.textContent).toBe('Checking overdraft');
    expect(link.getAttribute('href')).toBe('/transactions/f2?back=_coach');
    expect(screen.getByTestId('bank-fees-rows-overdraft').textContent).toContain('OVERDRAFT ITEM FEE');
    // The refund's label IS its bank text: printed once, not twice.
    expect(screen.getByTestId('bank-fees-rows-given-back').textContent?.match(/OVERDRAFT FEE REFUND/g)).toHaveLength(1);
    expect(screen.getByTestId('bank-fees-rows-overdraft').textContent).toContain('Sep 3, 2026');

    expect(screen.getByTestId('bank-fees-kind-late').textContent).toContain('Late fees — $29.00 (1 charge)');
    // Largest first: overdraft ($35.00) before late ($29.00).
    const order = Array.from(screen.getByTestId('bank-fees-kinds').querySelectorAll('details')).map((d) =>
      d.getAttribute('data-testid'),
    );
    expect(order).toEqual(['bank-fees-kind-overdraft', 'bank-fees-kind-late']);

    expect(screen.getByTestId('bank-fees-given-back').textContent).toContain('Came back — $35.00 (1 refund or reversal)');
    expect(screen.getByTestId('bank-fees-left-out').textContent).toContain(
      'Not counted here: $45.12 of interest and finance charges (1 charge).',
    );
    expect(screen.queryByTestId('bank-fees-handover')).toBeNull();
    // The rule is one tap away, folded under "How these are counted" (audit rule: no always-open essays).
    const how = screen.getByTestId('bank-fees-how');
    expect(how.tagName).toBe('DETAILS');
    expect(how.hasAttribute('open')).toBe(false);
    expect(how.querySelector('summary')?.textContent).toBe('How these are counted');
    expect(within(how).getByTestId('bank-fees-rule').textContent).toBe(BANK_FEES_RULE);
  });

  it('nothing counted: the lead names the zero, the rule still prints, no empty lists', () => {
    n = 0;
    const fees = findBankFees([row('chk', '2024-02-01', -500, 'BLUE DOOR COFFEE', 'coffee')], TODAY);
    render(<BankFeesCard fees={fees} />);
    expect(screen.getByTestId('bank-fees-lead').textContent).toBe('No bank fees counted in the last 12 months.');
    expect(screen.queryByTestId('bank-fees-kinds')).toBeNull();
    expect(screen.queryByTestId('bank-fees-given-back')).toBeNull();
    expect(screen.queryByTestId('bank-fees-left-out')).toBeNull();
    expect(screen.getByTestId('bank-fees-rule').textContent).toBe(BANK_FEES_RULE);
  });

  it('a counted row on a handover day is marked, and the amounts note says what that can mean', () => {
    n = 0;
    const fees = findBankFees(
      [row('chk', '2024-02-01', -500, 'BLUE DOOR COFFEE', 'coffee'), row('chk', '2026-09-03', -1_200, 'MONTHLY SERVICE FEE', 'fees')],
      TODAY,
      { handoverKeys: new Set([handoverKey('chk', '2026-09-03')]) },
    );
    render(<BankFeesCard fees={fees} />);
    expect(screen.getByTestId('bank-fees-rows-account').textContent).toContain('(both connections kept)');
    expect(screen.getByTestId('bank-fees-handover').textContent).toMatch(/^1 transaction behind these amounts falls/);
  });
});
