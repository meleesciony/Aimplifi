// @vitest-environment jsdom
/**
 * DECISIONS #792 (critic cycle 1, P2-2; cycle 2, P2-3): a recurring withdrawal from investing
 * is listed under "Recurring income" and badged "Money moved, not income" — the reason the
 * section's figure leaves it out. Only that row: a paycheck carries no badge, and neither
 * does a contribution series (an outflow, listed with the bills).
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MoneyMoveBadge } from '@/components/finance/money-move-badge';

afterEach(cleanup);

describe('#792 — the money-move badge', () => {
  it('only an income row that moves money carries it', () => {
    render(<MoneyMoveBadge item={{ isIncome: true, movesMoney: true }} />);
    expect(screen.getByTestId('recurring-money-move-badge').textContent).toBe('Money moved, not income');
    cleanup();
    for (const item of [
      { isIncome: true, movesMoney: false },
      { isIncome: false, movesMoney: true },
      { isIncome: false, movesMoney: false },
    ]) {
      render(<MoneyMoveBadge item={item} />);
      expect(screen.queryByTestId('recurring-money-move-badge'), JSON.stringify(item)).toBeNull();
      cleanup();
    }
  });

  it('sits on the card, not on a muted fill (cycle 2, P3-5: 4.34:1 there)', () => {
    render(<MoneyMoveBadge item={{ isIncome: true, movesMoney: true }} />);
    expect(screen.getByTestId('recurring-money-move-badge').className).not.toMatch(/\bbg-/);
  });

  it('every /recurring row renders it', () => {
    const view = readFileSync('src/components/finance/recurring-view.tsx', 'utf8');
    expect(view).toContain('<MoneyMoveBadge item={item} />');
  });
});
