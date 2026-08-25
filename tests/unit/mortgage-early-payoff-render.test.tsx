// @vitest-environment jsdom
/**
 * Render lock for the extra-principal slider (DECISIONS #517).
 * Demo has no mortgage; this is the ready path the seed cannot show.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { MortgageEarlyPayoffCard } from '@/components/finance/mortgage-early-payoff-card';

afterEach(() => cleanup());

describe('MortgageEarlyPayoffCard', () => {
  it('empty pick prints the empty sentence and no slider', () => {
    render(<MortgageEarlyPayoffCard pick={{ kind: 'none' }} />);
    expect(screen.getByTestId('mortgage-early-payoff-empty').textContent).toMatch(
      /No mortgage with a rate and a minimum payment/,
    );
    expect(screen.queryByTestId('mortgage-early-payoff-slider')).toBeNull();
  });

  it('incomplete pick names the missing term and has no slider', () => {
    render(
      <MortgageEarlyPayoffCard
        pick={{
          kind: 'incomplete',
          missing: 'rate',
          candidate: {
            id: 'm1',
            name: 'Home loan',
            type: 'MORTGAGE',
            balanceCents: 250_000_00,
            aprBps: null,
            minimumPaymentCents: 180_000,
          },
        }}
      />,
    );
    expect(screen.getByTestId('mortgage-early-payoff-incomplete').textContent).toMatch(
      /Home loan is on file, but a rate is not/,
    );
    expect(screen.queryByTestId('mortgage-early-payoff-slider')).toBeNull();
  });

  it('ready pick starts at the minimum walk and updates on extra', () => {
    render(
      <MortgageEarlyPayoffCard
        pick={{
          kind: 'ready',
          candidate: {
            id: 'acct-house',
            name: 'Home loan',
            type: 'MORTGAGE',
            balanceCents: 30_000,
            aprBps: 1200,
            minimumPaymentCents: 10_000,
          },
        }}
      />,
    );
    const sentence = screen.getByTestId('mortgage-early-payoff-sentence');
    expect(sentence.textContent).toContain('4 months');
    expect(sentence.textContent).toContain('$6.14');
    expect(sentence.textContent).not.toContain('sooner');

    fireEvent.change(screen.getByTestId('mortgage-early-payoff-slider'), {
      target: { value: '10000' },
    });
    expect(sentence.textContent).toContain('2 months sooner');
    expect(sentence.textContent).toContain('$2.11');
    expect(sentence.textContent).toContain('Illustration, not advice');
    expect(sentence.textContent).toContain('cash payment due');
    expect(sentence.textContent).toContain('not split out');
  });

  it('paid-off pick names the $0.00 row and has no slider', () => {
    render(
      <MortgageEarlyPayoffCard
        pick={{
          kind: 'paid-off',
          candidate: {
            id: 'm1',
            name: 'Home loan',
            type: 'MORTGAGE',
            balanceCents: 0,
            aprBps: 675,
            minimumPaymentCents: 180_000,
          },
        }}
      />,
    );
    expect(screen.getByTestId('mortgage-early-payoff-paid-off').textContent).toMatch(
      /Home loan is on file at \$0\.00/,
    );
    expect(screen.queryByTestId('mortgage-early-payoff-slider')).toBeNull();
  });
});
