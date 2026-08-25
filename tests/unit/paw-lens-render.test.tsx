// @vitest-environment jsdom
/**
 * Render lock for the expected-NW age slider (DECISIONS #518).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { PawLensCard } from '@/components/finance/paw-lens-card';

afterEach(() => cleanup());

describe('PawLensCard', () => {
  it('no income prints the empty sentence and no slider', () => {
    render(
      <PawLensCard netWorthCents={10_000_000} monthlyIncomeCents={0} incomeWindowMonths={6} />,
    );
    expect(screen.getByTestId('paw-lens-empty').textContent).toMatch(
      /No income is on file over the last 6 complete months/,
    );
    expect(screen.queryByTestId('paw-lens-slider')).toBeNull();
  });

  it('income starts idle and updates the comparison on age', () => {
    render(
      <PawLensCard
        netWorthCents={48_000_000}
        monthlyIncomeCents={1_000_000}
        incomeWindowMonths={6}
      />,
    );
    const idle = screen.getByTestId('paw-lens-idle');
    expect(idle.textContent).toMatch(/age × yearly income ÷ 10/);
    expect(idle.textContent).toMatch(/not a grade/);
    expect(idle.textContent).not.toMatch(/short of|above that number/);

    fireEvent.change(screen.getByTestId('paw-lens-slider'), { target: { value: '40' } });
    const sentence = screen.getByTestId('paw-lens-sentence');
    expect(sentence.textContent).toContain('age 40');
    expect(sentence.textContent).toContain('$480,000.00');
    expect(sentence.textContent).toMatch(/near that number/);
    expect(sentence.textContent).toMatch(/same income the FI card uses/);
    expect(sentence.textContent).not.toMatch(/\bPAW\b|\bUAW\b|\bbelow\b|this card/);
  });
});
