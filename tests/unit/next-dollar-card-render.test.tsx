// @vitest-environment jsdom
/**
 * TASKS L.19 residual (5) — the /coach "Your next dollar" card renders the frozen note under the
 * headline it qualifies, before the reasoning. A behavioural lock on the component (a source grep
 * for `nextDollarFrozenNote(` passes a rename and a logic bug alike). The abstention case is
 * pinned to the note's ABSENCE, so a caveat on a ranking no frozen account feeds fails here.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { cleanup, render, screen } from '@testing-library/react';
import { NextDollarCard } from '@/components/coach/next-dollar-card';
import { FROZEN_NEXT_DOLLAR_TESTID } from '@/lib/engine/account/feed-dropped-view';
import { nextDollar, type NextDollarDebt } from '@/lib/engine/fi/next-dollar';

afterEach(cleanup);

const LOAN: NextDollarDebt = {
  id: 'personal',
  name: 'Personal Loan',
  kind: 'installment',
  balanceCents: 500_000,
  aprBps: 1_200,
  frozenSince: '2026-05-28',
};

const plan = (debts: NextDollarDebt[]) =>
  nextDollar({
    debts,
    expectedReturnBps: 700,
    returnIsDefault: true,
    runwayMonths: 4.2,
    employerMatch: 'unknown',
    taxAdvantagedRoom: 'unknown',
  });

describe('NextDollarCard — the frozen note under the instruction', () => {
  it('test_regression__next_dollar_card_names_a_frozen_debt_behind_its_instruction', () => {
    render(<NextDollarCard plan={plan([LOAN])} />);
    expect(FROZEN_NEXT_DOLLAR_TESTID).toBe('next-dollar-frozen');
    const note = screen.getByTestId(FROZEN_NEXT_DOLLAR_TESTID);
    expect(note.textContent).toBe(
      'Your bank stopped sharing Personal Loan on Thu, May 28, 2026, so what we know about this loan is the last thing it sent — nothing about it has been confirmed since, including whether it is still open. Accounts shows the connection and how to fix or remove it.',
    );
    // Directly AFTER the reasoning, and before the skipped-rungs line: on the investing branch
    // the why is the first sentence to name the loan, so the caveat may not precede it (critic
    // P2-2) — one position on every branch.
    const headline = screen.getByTestId('next-dollar-headline');
    const why = screen.getByTestId('next-dollar-why');
    const skipped = screen.getByTestId('next-dollar-skipped');
    expect(headline.textContent).toBe('Next extra dollar: Personal Loan (12.00% APR)');
    expect(why.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(note.compareDocumentPosition(skipped) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // DISCLOSE, never wall off: the instruction and its reasoning still render.
    expect(why.textContent).toContain('Personal Loan is 12.00%');
  });

  it('investing branch: the losing loan is introduced by the why BEFORE the note names it (critic P2-2)', () => {
    render(<NextDollarCard plan={plan([{ ...LOAN, name: 'Auto Loan', aprBps: 649 }])} />);
    expect(screen.getByTestId('next-dollar-headline').textContent).toBe('Next extra dollar: investing');
    const why = screen.getByTestId('next-dollar-why');
    const note = screen.getByTestId(FROZEN_NEXT_DOLLAR_TESTID);
    expect(why.textContent).toContain('The Auto Loan is 6.49%');
    expect(note.textContent).toContain('Your bank stopped sharing Auto Loan');
    expect(why.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('nothing frozen → no note element at all, not an empty one', () => {
    render(<NextDollarCard plan={plan([{ ...LOAN, frozenSince: null }])} />);
    expect(screen.queryByTestId(FROZEN_NEXT_DOLLAR_TESTID)).toBeNull();
    expect(screen.getByTestId('next-dollar-headline').textContent).toBe(
      'Next extra dollar: Personal Loan (12.00% APR)',
    );
  });
});
