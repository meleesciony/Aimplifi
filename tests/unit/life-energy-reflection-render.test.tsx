// @vitest-environment jsdom
/**
 * P2.2 (docs/COACH_PRINCIPLES_PLAN.md) — the life-energy "memory dividend /
 * who notices" reflection, render decision locked.
 *
 * The line is for big purchases OUTSIDE the reader's declared money dials:
 * a listed dial purchase is the case the sentence already blesses, so the
 * card prints the reflection only when at least one item carries
 * `isMoneyDial: false` (the server-side flag — src/server/coach.ts maps the
 * purchase's category against the resolved dial ids; uncategorized ⇒ false).
 * All dials ⇒ no reflection; one non-dial among dials ⇒ reflection.
 *
 * Deliberately not a snapshot — a snapshot would go green on any change that
 * updates it (the C.26 rule).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { LifeEnergyCard } from '@/components/coach/life-energy-card';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';

afterEach(cleanup);

const item = (merchant: string, isMoneyDial: boolean) => ({
  merchant,
  amountCents: 25_000,
  hours: 4,
  date: '2026-08-10',
  isMoneyDial,
});

describe('P2.2 life-energy memory-dividend reflection', () => {
  it('shows the reflection when a listed purchase is outside the money dials', () => {
    render(
      <LifeEnergyCard
        items={[item('Delta Airlines', true), item('Peachtree Properties', false)]}
        hourlyWageCents={6_000}
      />,
    );
    expect(screen.getByTestId('life-energy-reflection').textContent).toBe(
      COACH_COPY.lifeEnergyReflection(),
    );
  });

  it('stays silent when every listed purchase is a declared money dial', () => {
    render(
      <LifeEnergyCard
        items={[item('Delta Airlines', true), item('Marriott', true)]}
        hourlyWageCents={6_000}
      />,
    );
    expect(screen.queryByTestId('life-energy-reflection')).toBeNull();
  });

  it('stays silent on the empty state', () => {
    render(<LifeEnergyCard items={[]} hourlyWageCents={6_000} />);
    expect(screen.getByTestId('life-energy-empty')).toBeTruthy();
    expect(screen.queryByTestId('life-energy-reflection')).toBeNull();
  });
});
