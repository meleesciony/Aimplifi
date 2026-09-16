// @vitest-environment jsdom
/**
 * TASKS L.19 — the /goals Debt Freedom planner renders the frozen-balance note, resolved against
 * the rows its order list prints. A behavioural lock on the component (critic P2-3 on the first
 * cut: a `readFileSync` grep for `frozenDebtPlanNote(` passes a rename and a logic bug alike).
 * The abstention case is pinned to the note's ABSENCE, so a caveat on a plan no frozen account
 * feeds — the false hedge this slice can introduce — fails here.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/server/goal-actions', () => ({ saveDebtFreeGoal: vi.fn() }));

import { cleanup, render, screen } from '@testing-library/react';
import { DebtFreedomPlanner } from '@/components/finance/debt-freedom-planner';
import { FROZEN_DEBT_PLAN_TESTID } from '@/lib/engine/account/feed-dropped-view';
import type { DebtAccount } from '@/lib/engine/debt/payoff';

afterEach(cleanup);

const TODAY = '2026-06-10';

const CARD: DebtAccount = {
  id: 'card',
  name: 'Chase Sapphire',
  kind: 'card',
  balanceCents: 900_000,
  aprBps: 2_399,
  minimumPaymentCents: 9_000,
  frozenSince: '2026-05-28',
};
const LOAN: DebtAccount = {
  id: 'auto',
  name: 'Auto Loan',
  kind: 'loan',
  balanceCents: 1_430_000,
  aprBps: 649,
  minimumPaymentCents: 38_500,
  frozenSince: null,
};

describe('DebtFreedomPlanner — the frozen note under the hero', () => {
  it('test_regression__debt_planner_names_a_frozen_balance_behind_its_date', () => {
    render(<DebtFreedomPlanner debts={[CARD, LOAN]} today={TODAY} canSaveGoal />);
    const note = screen.getByTestId(FROZEN_DEBT_PLAN_TESTID);
    expect(FROZEN_DEBT_PLAN_TESTID).toBe('debt-planner-frozen');
    expect(note.textContent).toBe(
      'Your bank stopped sharing Chase Sapphire on Thu, May 28, 2026, so the balance behind this payoff plan is the last one we saw — nothing that has happened on the card since is in it, including any payment you have made or any new charge, so the real balance may be higher or lower than the one used here. Accounts shows the connection and how to fix or remove it.',
    );
    // Only the frozen row is named; the live loan is not.
    expect(note.textContent).not.toContain('Auto Loan');
    // The note sits ABOVE the save control: the reader sees what the saved total rests on first.
    const save = screen.getByTestId('debt-planner-save-goal');
    expect(note.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // DISCLOSE, never wall off: the hero date and the save control both still render.
    expect(screen.getByTestId('debt-free-hero').textContent).toMatch(/^Debt-free by /);
    expect((save as HTMLButtonElement).disabled).toBe(false);
  });

  it('nothing frozen → no note element at all, not an empty one', () => {
    render(
      <DebtFreedomPlanner debts={[{ ...CARD, frozenSince: null }, LOAN]} today={TODAY} canSaveGoal />,
    );
    expect(screen.queryByTestId(FROZEN_DEBT_PLAN_TESTID)).toBeNull();
    expect(screen.getByTestId('debt-planner').textContent).not.toContain('stopped sharing');
  });
});
