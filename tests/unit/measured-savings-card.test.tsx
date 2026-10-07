// @vitest-environment jsdom
/**
 * DECISIONS #790 — the "Money you set aside" section renders the engine verbatim: the
 * lead, this month's lines (a line only for an account kind the reader links — never a
 * bare $0.00 for an account they do not have), earnings listed apart, the empty states
 * naming WHICH zero, and the rule. Invented figures.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MeasuredSavingsCard } from '@/components/finance/measured-savings-card';
import { isoDate } from '@/lib/dates';
import type { DepositAccount, DepositRow } from '@/lib/engine/investments/deposits';
import { measureSavings } from '@/lib/engine/savings/measured';
import {
  MEASURED_NO_RECORDS,
  MEASURED_NO_SAVING_ACCOUNTS,
  MEASURED_NO_SOURCE_ACCOUNTS,
} from '@/lib/engine/savings/measured-copy';

afterEach(cleanup);

const TODAY = isoDate('2026-10-17');
const acct = (id: string, type: string, label: string, mask: string, institutionName: string | null): DepositAccount => ({
  id,
  type,
  label,
  mask,
  institutionName,
  feedName: label,
  completeThrough: type === 'INVESTMENT' ? null : '2026-10-16',
});
const CHK = acct('chk', 'CHECKING', 'Everyday Checking', '7712', 'First Example Bank');
const SAV = acct('sav', 'SAVINGS', 'Rainy Day Savings', '3390', 'First Example Bank');
const VG = acct('vg', 'INVESTMENT', 'Vanguard Brokerage', '5521', 'Vanguard');
let n = 0;
const row = (accountId: string, date: string, amountCents: number, rawDescriptor: string, categoryId = 'transfer'): DepositRow => ({
  id: `c${++n}`,
  accountId,
  date,
  amountCents,
  rawDescriptor,
  status: 'POSTED',
  categoryId,
});
const anchors = () => [row('chk', '2025-01-02', -1000, 'BLUE DOOR COFFEE', 'coffee'), row('sav', '2025-01-02', -200, 'MONTHLY FEE', 'fees')];

function draw(accounts: DepositAccount[], rows: DepositRow[], planned = 100_000) {
  const measured = measureSavings({ deposit: { today: TODAY, rows: [...anchors(), ...rows], accounts }, plan: planned });
  render(<MeasuredSavingsCard measured={measured} canLink />);
}

describe('#790 — the section', () => {
  it('this month: the lead, both lines, earnings apart, the link to the deposit rows', () => {
    draw([CHK, SAV, VG], [
      row('chk', '2026-10-01', -50_000, 'TRANSFER TO SAVINGS X3390'),
      row('sav', '2026-10-01', 50_000, 'TRANSFER FROM CHECKING X7712'),
      row('chk', '2026-10-03', -75_000, 'ONLINE TRANSFER TO XXXXXX5521'),
      row('sav', '2026-10-05', 412, 'INTEREST PAYMENT', 'interest-income'),
    ]);
    expect(screen.getByTestId('measured-lead').textContent).toBe(
      'So far this month you’ve set aside $1,250.00 — $250.00 more than the $1,000.00 your plan sets aside.',
    );
    expect(screen.getByTestId('measured-this-month-savings-figure').textContent).toBe('+$500.00');
    expect(screen.getByTestId('measured-this-month-investments-figure').textContent).toBe('+$750.00');
    expect(screen.getByTestId('measured-this-month-earnings-figure').textContent).toBe('+$4.12');
    expect(screen.getByTestId('measured-this-month-investments-link').getAttribute('href')).toBe('/investments');
    expect(screen.getAllByTestId('measured-month')).toHaveLength(12);
  });

  it('no investment account linked: no "Investment accounts" line, never a bare $0.00', () => {
    draw([CHK, SAV], [row('chk', '2026-10-01', -50_000, 'TRANSFER TO SAVINGS X3390'), row('sav', '2026-10-01', 50_000, 'TRANSFER FROM CHECKING X7712')]);
    expect(screen.queryByTestId('measured-this-month-investments')).toBeNull();
    expect(screen.getByTestId('measured-this-month-savings-figure').textContent).toBe('+$500.00');
  });

  it('no savings account linked: no "Savings accounts" line', () => {
    draw([CHK, VG], [row('chk', '2026-10-03', -75_000, 'ONLINE TRANSFER TO XXXXXX5521')]);
    expect(screen.queryByTestId('measured-this-month-savings')).toBeNull();
    expect(screen.getByTestId('measured-this-month-investments-figure').textContent).toBe('+$750.00');
  });

  it('each empty state names which zero, and offers to link only where linking is the lever', () => {
    draw([VG], []);
    expect(screen.getByTestId('measured-empty').textContent).toBe(MEASURED_NO_SOURCE_ACCOUNTS);
    expect(screen.getByTestId('measured-link-account').getAttribute('href')).toBe('/accounts');
    cleanup();
    draw([CHK], []);
    expect(screen.getByTestId('measured-empty').textContent).toBe(MEASURED_NO_SAVING_ACCOUNTS);
    expect(screen.getByTestId('measured-link-account')).toBeTruthy();
    cleanup();
    // Records begin this month: no whole month to measure — linking more is not the lever.
    const measured = measureSavings({
      deposit: { today: TODAY, rows: [row('chk', '2026-10-02', -1000, 'BLUE DOOR COFFEE', 'coffee')], accounts: [CHK, SAV] },
      plan: 100_000,
    });
    render(<MeasuredSavingsCard measured={measured} canLink />);
    expect(screen.getByTestId('measured-empty').textContent).toBe(MEASURED_NO_RECORDS);
    expect(screen.queryByTestId('measured-link-account')).toBeNull();
  });

  it('a linked account kind is drawn at $0.00; an unlinked one is not, even beside a row Investments lists (critic cycle 1, P2-4 / P3-2)', () => {
    draw([CHK, SAV, VG], []);
    expect(screen.getByTestId('measured-this-month-savings-figure').textContent).toBe('$0.00');
    expect(screen.getByTestId('measured-this-month-investments-figure').textContent).toBe('$0.00');
    cleanup();
    draw([CHK, SAV], [row('chk', '2026-10-04', -50_000, 'TRANSFER TO BETTERMENT', 'investment')]);
    expect(screen.queryByTestId('measured-this-month-investments')).toBeNull();
  });

  it('money into savings from an account we can’t see is its own line, with its rows, and not in the figure (critic cycle 1, P1-1)', () => {
    draw([CHK, SAV, VG], [row('sav', '2026-10-06', 2_000_000, 'TRANSFER FROM MARCUS SAVINGS X9981')]);
    expect(screen.getByTestId('measured-this-month-savings-figure').textContent).toBe('$0.00');
    expect(screen.getByTestId('measured-this-month-untraced-figure').textContent).toBe('+$20,000.00');
    expect(screen.getByTestId('measured-this-month-untraced-note').textContent).toMatch(/^\$20,000\.00 came into your savings that we couldn’t match/);
    // Named apart from the counted rows, and muted (critic cycle 2, P3-E).
    expect(screen.getByTestId('measured-this-month-untraced-rows-toggle').textContent).toBe('The untraced row');
    expect(screen.getByTestId('measured-this-month-untraced').firstElementChild!.className).toContain('text-muted-foreground');
    expect(screen.getByTestId('measured-this-month-untraced-rows').textContent).toContain('TRANSFER FROM MARCUS SAVINGS X9981');
    expect(screen.getByTestId('measured-lead').textContent).toBe('Nothing counted as set aside so far this month — your plan sets aside $1,000.00.');
  });

  it('a past month with missing records says so under its figure (critic cycle 1, P2-4)', () => {
    const stopped: DepositAccount = { ...SAV, completeThrough: null };
    const measured = measureSavings({
      deposit: { today: TODAY, rows: [...anchors(), row('sav', '2026-08-20', -1000, 'MONTHLY FEE', 'fees')], accounts: [CHK, stopped, VG] },
      plan: 100_000,
    });
    render(<MeasuredSavingsCard measured={measured} canLink />);
    const months = screen.getAllByTestId('measured-month');
    const sep = months.find((m) => m.getAttribute('data-month') === '2026-09')!;
    const jul = months.find((m) => m.getAttribute('data-month') === '2026-07')!;
    expect(sep.querySelector('[data-testid="measured-month-missing"]')?.textContent).toMatch(/Rainy Day Savings/);
    expect(jul.querySelector('[data-testid="measured-month-missing"]')).toBeNull();
  });

  it('the shared demo is never offered "Link an account"', () => {
    const measured = measureSavings({ deposit: { today: TODAY, rows: [], accounts: [VG] }, plan: 0 });
    render(<MeasuredSavingsCard measured={measured} canLink={false} />);
    expect(screen.queryByTestId('measured-link-account')).toBeNull();
  });
});
