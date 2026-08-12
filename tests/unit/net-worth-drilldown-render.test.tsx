// @vitest-environment jsdom
/**
 * O.20f P2-f — the net-worth chip strip is CAPPED to the last 18 points, with
 * the live "Today" point always last.
 *
 * The card is documented as an "18-month trend"; one chip per snapshot ever is
 * a wall of pills on a 380px dashboard once a long-lived user has years of
 * snapshots. The cap is a RENDER decision (a component could silently drop the
 * wrong points, or the future growth that motivated the cap could regress), so
 * it is locked here: >18 points renders exactly the most recent 18, ≤18 renders
 * all of them, and the live point survives the slice.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

// BreakdownPanel (imported at module level, though no panel renders in these
// cases) reads next/navigation inside its body — the o18e-fu2 render-test
// precedent mocks it before the component import.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/dashboard',
}));
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NetWorthTrendDrilldown } from '@/components/finance/net-worth-trend-drilldown';
import type { NetWorthSeriesPoint } from '@/lib/engine/networth/series';

// Explicit, because this config does not enable vitest globals and RTL's
// auto-cleanup rides on those.
afterEach(cleanup);

const LIVE = '2026-08-10';

/** 20 month-ends (2024-12-31 .. 2026-07-31) + the live point = 21 points. */
const MONTH_ENDS = [
  '2024-12-31', '2025-01-31', '2025-02-28', '2025-03-31', '2025-04-30', '2025-05-31',
  '2025-06-30', '2025-07-31', '2025-08-31', '2025-09-30', '2025-10-31', '2025-11-30',
  '2025-12-31', '2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31',
  '2026-06-30', '2026-07-31',
];

const point = (date: string): NetWorthSeriesPoint => ({
  date,
  netWorthCents: 100_00,
  constituents: [],
});

const demoShape = [...MONTH_ENDS.slice(0, 17), LIVE].map(point); // 18 chips: the fixture as-seeded

describe('NetWorthTrendDrilldown chip cap (O.20f P2-f)', () => {
  it('more than 18 points renders exactly the most recent 18 — the oldest fall off', () => {
    render(<NetWorthTrendDrilldown points={[...MONTH_ENDS, LIVE].map(point)} testIdPrefix="net-worth" />);
    const chips = screen.getAllByTestId(/^net-worth-point-/);
    expect(chips).toHaveLength(18);
    // points[0..2] (2024-12-31, 2025-01-31, 2025-02-28) are the oldest 3 of 21 — gone.
    expect(screen.queryByTestId('net-worth-point-2024-12-31')).toBeNull();
    expect(screen.queryByTestId('net-worth-point-2025-01-31')).toBeNull();
    // The slice boundary: 2026-03-31 is the 17th month-end = the NEW first chip.
    expect(screen.getByTestId('net-worth-point-2026-03-31')).toBeTruthy();
    // …and the live point survives the slice, always last.
    expect(screen.getByTestId('net-worth-point-2026-08-10')).toBeTruthy();
    expect(screen.getByText('Today')).toBeTruthy();
  });

  it('at or under 18 points nothing is dropped (the demo shape renders as today)', () => {
    render(<NetWorthTrendDrilldown points={demoShape} testIdPrefix="net-worth" />);
    const chips = screen.getAllByTestId(/^net-worth-point-/);
    expect(chips).toHaveLength(18); // 17 month-ends + Today — the as-seeded 18
    expect(screen.getByTestId('net-worth-point-2024-12-31')).toBeTruthy();
    expect(screen.getByTestId('net-worth-point-2026-08-10')).toBeTruthy();
  });

  it('no points renders no strip at all', () => {
    const { container } = render(<NetWorthTrendDrilldown points={[]} testIdPrefix="net-worth" />);
    expect(container.querySelector('[data-testid^="net-worth-point-"]')).toBeNull();
  });
});

/**
 * U.6 — a point counts each account as the class it was RECORDED under, so a
 * reclassified account appears in an older point with the opposite sign to the
 * one it has today: a credit card rendered POSITIVE inside a breakdown whose
 * own basis sentence calls the sum "assets minus liabilities".
 *
 * This is the surface that has to carry it. The account detail panel explains
 * the same fact per row, but `accountRowDestination` routes CHECKING, SAVINGS
 * and CREDIT rows to /transactions — so for exactly the account types a feed
 * most often re-classes, the panel never renders. The drilldown is reachable
 * for every account in the trend.
 */
describe('NetWorthTrendDrilldown — an account counted the other way round (U.6)', () => {
  const pointWith = (
    date: string,
    constituents: NetWorthSeriesPoint['constituents'],
  ): NetWorthSeriesPoint => ({
    date,
    netWorthCents: constituents.reduce((s, c) => s + c.balanceCents, 0),
    constituents,
  });

  // April: read while the feed called it checking. Today: a credit card.
  const APRIL = pointWith('2026-04-30', [
    { accountId: 'flip', name: 'Flex Line', balanceCents: 10_000_00, isLiability: false },
    { accountId: 'chk', name: 'Checking', balanceCents: 5_000_00, isLiability: false },
  ]);
  const TODAY_POINT = pointWith(LIVE, [
    { accountId: 'flip', name: 'Flex Line', balanceCents: -10_000_00, isLiability: true },
    { accountId: 'chk', name: 'Checking', balanceCents: 5_000_00, isLiability: false },
  ]);

  it('names the account whose class differs from what it is today, on the row carrying the money', () => {
    render(<NetWorthTrendDrilldown points={[APRIL, TODAY_POINT]} testIdPrefix="net-worth" />);
    fireEvent.click(screen.getByTestId('net-worth-point-2026-04-30'));
    const panel = screen.getByTestId('net-worth-constituents-rows-2026-04-30');
    // The fact rides the row, not a sentence below the list.
    expect(panel.textContent).toContain('Flex Line · counted here as money you owned');
    // The account whose class never moved says nothing.
    expect(panel.textContent).toContain('Checking');
    expect(panel.textContent).not.toContain('Checking · counted here');
  });

  it('says nothing on the live point, and nothing when every class is stable', () => {
    render(<NetWorthTrendDrilldown points={[APRIL, TODAY_POINT]} testIdPrefix="net-worth" />);
    fireEvent.click(screen.getByTestId(`net-worth-point-${LIVE}`));
    expect(
      screen.getByTestId(`net-worth-constituents-rows-${LIVE}`).textContent,
    ).not.toContain('counted here as');
  });
});
