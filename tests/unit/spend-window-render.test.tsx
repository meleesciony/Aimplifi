// @vitest-environment jsdom
/**
 * C.26 critic cycle 2, F2 — the RENDER decisions, locked.
 *
 * Cycle 1 found the clamp's disclosure asserted nowhere and the fix moved the
 * string builders into the engine. Cycle 2 pointed out that this only moved the
 * hole: a critic deleted the page-level sentence, the "so far" suffix, the
 * empty-state string, the corrected `aria-label` and BOTH `windowLabelSoFar`
 * calls in one pass, and 5972/5972 stayed green — "moving the string builder
 * without moving the render decision converts an unlocked sentence into an
 * unlocked call to a locked sentence."
 *
 * The repo had no way to assert a rendered component, which is why two cycles
 * of user-visible copy shipped unlocked. That is now a harness rather than a
 * standing excuse: this file renders the real components with React Testing
 * Library under jsdom. Every assertion below is a sentence a reader meets.
 *
 * Deliberately NOT a snapshot test. A snapshot would go green on any change
 * that updates it, which is the same hole one level along.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// The card's engagement link is a client component whose server action pulls in
// next-auth, which cannot load under jsdom. Stubbed at the ACTION — the
// component tree under test, including the link itself, is the real one.
vi.mock('@/server/engagement-actions', () => ({ logEngagement: vi.fn() }));
// /reports is a client page: it routes on the month selector and draws with
// Recharts. Neither is under test here — the sentences are.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/reports',
}));
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CategoryBreakdownPanel } from '@/components/finance/category-breakdown-panel';
import { TopSpendingCard } from '@/components/finance/top-spending-card';
import { MonthFlowPanel } from '@/components/finance/month-flow-panel';
import { ReportsView } from '@/components/finance/reports-view';
import type { ReportsData } from '@/server/reports';
import { cents } from '@/lib/money';
import type { CategoryBreakdown } from '@/lib/engine/glass-box/category-breakdown';
import type { MonthFlowBreakdown } from '@/lib/engine/glass-box/month-flow-breakdown';

// Explicit, because this config does not enable vitest globals and RTL's
// auto-cleanup rides on those. Without it the previous test's DOM survives and
// every CONTROL passes for the wrong reason.
afterEach(cleanup);

const HELD_BACK = 40_000;

const categoryBreakdown = (notCountedYetCents: number): CategoryBreakdown => ({
  categoryId: 'groceries',
  headlineCents: cents(12_000),
  rows: [
    {
      key: 'groceries:0:2026-06-04',
      transactionId: 't1',
      date: '2026-06-04',
      label: 'Kroger',
      rawDescriptor: null,
      amountCents: cents(12_000),
      isPending: false, onHandoverDay: false,
    },
  ],
  sumCents: cents(12_000),
  reconciles: true,
  clampedByNetRefund: false,
  notCountedYetCents: cents(notCountedYetCents),
  countedOnHandoverDays: 0,
});

const monthFlowBreakdown = (notCountedYetCents: number): MonthFlowBreakdown => ({
  month: '2026-06',
  flow: 'expense',
  headlineCents: cents(12_000),
  rows: [
    {
      key: '2026-06:expense:0:2026-06-04',
      transactionId: 't1',
      date: '2026-06-04',
      label: 'Kroger',
      rawDescriptor: null,
      amountCents: cents(12_000),
      isPending: false, onHandoverDay: false,
    },
  ],
  sumCents: cents(12_000),
  reconciles: true,
  clampedByNetRefund: false,
  notCountedYetCents: cents(notCountedYetCents),
  countedOnHandoverDays: 0,
});

describe('C.26 — the category panel prints the clamp clause it was given', () => {
  it('names the amount held back, inside the basis a reader can open', () => {
    render(
      <CategoryBreakdownPanel
        breakdown={categoryBreakdown(HELD_BACK)}
        categoryName="Groceries"
        windowLabel="June 2026"
      />,
    );
    expect(screen.getByText(/\$400\.00 here is dated after today/)).toBeDefined();
  });

  it('narrows the window label in the sentence that names one', () => {
    // The label surfaces in the EMPTY sentence (a category whose counted rows
    // are none), which is the state a clamped window most often produces.
    render(
      <CategoryBreakdownPanel
        breakdown={{ ...categoryBreakdown(HELD_BACK), rows: [], sumCents: cents(0), headlineCents: cents(0) }}
        categoryName="Groceries"
        windowLabel="June 2026"
      />,
    );
    // The empty sentence lives inside the collapsed region — open it the way a
    // reader does.
    fireEvent.click(screen.getByTestId('breakdown-toggle-groceries'));
    expect(screen.getByText(/June 2026 so far/)).toBeDefined();
  });

  it('CONTROL: with nothing dated ahead, neither string appears', () => {
    render(
      <CategoryBreakdownPanel
        breakdown={categoryBreakdown(0)}
        categoryName="Groceries"
        windowLabel="June 2026"
      />,
    );
    expect(screen.queryByText(/dated after today/)).toBeNull();
    expect(screen.queryByText(/so far/)).toBeNull();
  });
});

describe('C.26 — the chart panel prints its own clamp clause', () => {
  it('names the amount and narrows the window label', () => {
    render(<MonthFlowPanel breakdown={monthFlowBreakdown(HELD_BACK)} windowLabel="June 2026" />);
    expect(screen.getByText(/\$400\.00 here is dated after today/)).toBeDefined();
  });

  it('an empty bar over money dated ahead does not claim the month had no spending', () => {
    // Critic cycle 1, P1-4 executed at the render site: this printed "No posted
    // spending in June 2026" over $400.00 of posted June spending.
    render(
      <MonthFlowPanel
        breakdown={{ ...monthFlowBreakdown(HELD_BACK), rows: [], sumCents: cents(0), headlineCents: cents(0) }}
        windowLabel="June 2026"
      />,
    );
    fireEvent.click(screen.getByTestId('month-flow-toggle-2026-06-expense'));
    expect(screen.getByText(/No posted spending in June 2026 so far/)).toBeDefined();
  });

  it('CONTROL: an unclamped bar is byte-identical to its pre-C.26 self', () => {
    render(<MonthFlowPanel breakdown={monthFlowBreakdown(0)} windowLabel="June 2026" />);
    expect(screen.queryByText(/dated after today/)).toBeNull();
    expect(screen.queryByText(/so far/)).toBeNull();
  });
});

describe('C.26 — the dashboard top-spending card (critic cycle 2, F3)', () => {
  const breakdown = { totalCents: 12_000, countedOnHandoverDays: 0, uncountedOnHandoverDays: [], byCategory: [], byGroup: [] };

  it('an empty table over money dated ahead says so instead of "No spending yet"', () => {
    render(
      <TopSpendingCard
        breakdown={{ ...breakdown, totalCents: 0 }}
        breakdowns={{}}
        ym="2026-06"
        notCountedYetCents={HELD_BACK}
      />,
    );
    // The exact pair the critic executed: "$0.00 this month" over "No spending
    // yet this month." with $400.00 of posted June charges unmentioned.
    expect(screen.queryByText(/No spending yet this month/)).toBeNull();
    expect(screen.getByText(/Nothing counted yet this month/)).toBeDefined();
    expect(screen.getByTestId('top-spending-not-counted-yet').textContent).toMatch(/\$400\.00/);
    expect(screen.getByText(/so far this month/)).toBeDefined();
  });

  it('does NOT pre-narrow the label its panels narrow for themselves (critic cycle 3, G1)', () => {
    // The card renders panels, and each panel applies `windowLabelSoFar` with
    // its OWN category's amount. Narrowing with the PAGE amount first produced
    // "Jun 2026 so far so far" for a category with money dated ahead, and put
    // "so far" on a category that had held nothing back.
    render(
      <TopSpendingCard
        breakdown={{
          totalCents: 12_000,
          byCategory: [
            { categoryId: 'groceries', name: 'Groceries', group: 'Food & Dining', amountCents: 12_000, countedOnHandoverDays: 0 },
          ],
          countedOnHandoverDays: 0,
          uncountedOnHandoverDays: [],
          byGroup: [],
        }}
        breakdowns={{ groceries: { ...categoryBreakdown(HELD_BACK), rows: [], sumCents: cents(0) } }}
        ym="2026-06"
        notCountedYetCents={HELD_BACK}
      />,
    );
    fireEvent.click(screen.getByTestId('top-spending-breakdown-toggle-groceries'));
    expect(screen.queryByText(/so far so far/)).toBeNull();
    expect(screen.getByText(/Jun 2026 so far/)).toBeDefined();
  });

  it('a category that held nothing back is not labelled "so far" because the PAGE did', () => {
    render(
      <TopSpendingCard
        breakdown={{
          totalCents: 12_000,
          byCategory: [
            { categoryId: 'groceries', name: 'Groceries', group: 'Food & Dining', amountCents: 12_000, countedOnHandoverDays: 0 },
          ],
          countedOnHandoverDays: 0,
          uncountedOnHandoverDays: [],
          byGroup: [],
        }}
        // The page held $400 back — in some OTHER category.
        breakdowns={{ groceries: { ...categoryBreakdown(0), rows: [], sumCents: cents(0) } }}
        ym="2026-06"
        notCountedYetCents={HELD_BACK}
      />,
    );
    fireEvent.click(screen.getByTestId('top-spending-breakdown-toggle-groceries'));
    // The CARD header still says "so far this month" — the page did hold money
    // back. The PANEL's own sentence must not, because this category did not.
    expect(screen.getByText(/Nothing was filed into this category in Jun 2026 —/)).toBeDefined();
  });

  it('CONTROL: with nothing dated ahead the card reads exactly as it always did', () => {
    render(
      <TopSpendingCard
        breakdown={{ ...breakdown, totalCents: 0 }}
        breakdowns={{}}
        ym="2026-06"
        notCountedYetCents={0}
      />,
    );
    expect(screen.getByText(/No spending yet this month/)).toBeDefined();
    expect(screen.queryByTestId('top-spending-not-counted-yet')).toBeNull();
    expect(screen.queryByText(/so far/)).toBeNull();
  });
});

describe('C.26 — /reports itself, the surface the finding is about (critic cycle 3, G2)', () => {
  // Recharts measures its container; jsdom reports zero and the chart draws
  // nothing. That is fine — every assertion below is text outside the chart.
  beforeAll(() => {
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  });

  const reportsData = (notCountedYetCents: number, empty = false): ReportsData => ({
    ym: '2026-06',
    window: { fromYm: '2026-06', toYm: '2026-06', asOf: '2026-06-10' },
    categoryHrefs: { groceries: '/transactions?category=groceries&from=2026-06-01&to=2026-06-10' },
    notCountedYetCents,
    months: [{ month: '2026-06', incomeCents: 50_000, expensesCents: empty ? 0 : 12_000 }],
    breakdown: empty
      ? { totalCents: 0, countedOnHandoverDays: 0, uncountedOnHandoverDays: [], byCategory: [], byGroup: [] }
      : {
          totalCents: 12_000,
          countedOnHandoverDays: 0,
          uncountedOnHandoverDays: [],
          byCategory: [{ categoryId: 'groceries', name: 'Groceries', group: 'Food & Dining', amountCents: 12_000, countedOnHandoverDays: 0 }],
          byGroup: [
            {
              group: 'Food & Dining',
              amountCents: 12_000,
              categories: [
                { categoryId: 'groceries', name: 'Groceries', group: 'Food & Dining', amountCents: 12_000, countedOnHandoverDays: 0 },
              ],
            },
          ],
        },
    breakdowns: empty ? {} : { groceries: categoryBreakdown(notCountedYetCents) },
    monthFlows: {},
    loanPaymentExclusions: [],
    loanPaymentRefusedCategories: [],
  });

  const withheld = { count: 0, currencies: [] as string[] };

  it('names the money held back, and says "so far" beside the total', () => {
    render(<ReportsView data={reportsData(HELD_BACK)} withheld={withheld} months={6} />);
    expect(screen.getByTestId('reports-not-counted-yet').textContent).toMatch(/\$400\.00/);
    expect(screen.getByTestId('reports-category-total').textContent).toMatch(/so far/);
  });

  it('an empty table over money dated ahead does not say "No spending this month yet"', () => {
    render(<ReportsView data={reportsData(HELD_BACK, true)} withheld={withheld} months={6} />);
    expect(screen.queryByText(/No spending this month yet/)).toBeNull();
    expect(screen.getByText(/Nothing counted yet this month/)).toBeDefined();
    expect(screen.getByTestId('reports-not-counted-yet').textContent).toMatch(/\$400\.00/);
  });

  it("the category link's accessible name carries the FIGURE's window, not the month's", () => {
    render(<ReportsView data={reportsData(HELD_BACK)} withheld={withheld} months={6} />);
    const link = screen.getByTestId('category-link-groceries');
    expect(link.getAttribute('aria-label')).toMatch(/in Jun so far/);
    // And the href is the loader's, stopping at today.
    expect(link.getAttribute('href')).toContain('to=2026-06-10');
  });

  it('CONTROL: with nothing dated ahead every one of those strings is the pre-C.26 one', () => {
    render(<ReportsView data={reportsData(0)} withheld={withheld} months={6} />);
    expect(screen.queryByTestId('reports-not-counted-yet')).toBeNull();
    expect(screen.getByTestId('reports-category-total').textContent).not.toMatch(/so far/);
    expect(screen.getByTestId('category-link-groceries').getAttribute('aria-label')).not.toMatch(/so far/);
  });
});
