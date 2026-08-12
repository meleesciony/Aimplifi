// @vitest-environment jsdom
/**
 * O.18e-FU2 (TASKS, P2-1 of the O.18e-FU re-review) — the RENDER decisions
 * in the figureless state, locked.
 *
 * /reports and /trends gate the scoped C.25 sentence behind the figure it
 * describes. A dedicated mortgage account whose ONLY activity is the excluded
 * loan payment gets a non-empty exclusion set and no sentence at all — the
 * page prints "No spending counted yet this month" / "No income or spending
 * recorded…" while money DID move (the surfaces' "silence means nothing did"
 * contract). The naive fix — gating on the array — is FALSE COPY: the scoped
 * sentence names a figure the abstain state does not render, and a claim
 * about an absent figure is the same falsehood class O.18e-FU removed. So
 * the empty branch gets its own 'figureless' sentence from the composer.
 *
 * The C.26 lesson holds here too: the string is locked in
 * loan-payment-basis.test.ts (verbatim golden for the new scope), and this
 * file locks the RENDER DECISION — that the empty branch actually prints the
 * figureless scope, that the with-figure branch does NOT, and that the
 * control (empty + no exclusions) stays silent.
 *
 * Deliberately not a snapshot — a snapshot would go green on any change that
 * updates it (the C.26 rule).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// /reports is a client page: it routes on the month selector and draws with
// Recharts. Neither is under test here — the sentences are (the
// spend-window-render precedent).
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/reports',
}));
import { cleanup, render, screen } from '@testing-library/react';
import { ReportsView } from '@/components/finance/reports-view';
import { TrendsView } from '@/components/finance/trends-view';
import type { ReportsData } from '@/server/reports';
import type { SpendingTrendsData } from '@/server/trends';

// Explicit, because this config does not enable vitest globals and RTL's
// auto-cleanup rides on those. Without it the previous test's DOM survives and
// every CONTROL passes for the wrong reason.
afterEach(cleanup);

// Recharts measures its container; jsdom reports zero and the chart draws
// nothing. That is fine — every assertion below is text outside the chart.
beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

// The FU2 shape: a dedicated mortgage account whose ONLY activity is the
// excluded payment. The engine facts — the exclusion set is non-empty while
// the figures abstain (pace null / all-zero months) — are the exact pair the
// O.18e-FU re-review's P2-1 executed.
const EXCLUSION = { payee: 'Mr Cooper', loanName: 'Mortgage', paymentCents: 621_707 };
const FIGURELESS = 'Payments to Mr Cooper at $6,217.07/mo are counted on Mortgage instead.';

const trendsFigureless = (exclusions = true): SpendingTrendsData => ({
  asOfYm: '2026-06',
  asOfDate: '2026-06-10',
  comparedYm: null,
  baselineMonths: [],
  pace: null,
  movers: [],
  moverTotal: 0,
  largest: [],
  newMerchants: [],
  newMerchantTotal: 0,
  breakdowns: {},
  loanPaymentExclusions: exclusions ? [EXCLUSION] : [],
  loanPaymentRefusedCategories: [],
});

const reportsFigureless = (exclusions = true): ReportsData => ({
  ym: '2026-06',
  window: { fromYm: '2026-06', toYm: '2026-06', asOf: '2026-06-10' },
  categoryHrefs: {},
  notCountedYetCents: 0,
  months: [{ month: '2026-06', incomeCents: 0, expensesCents: 0 }],
  breakdown: { totalCents: 0, countedOnHandoverDays: 0, byCategory: [], byGroup: [] },
  breakdowns: {},
  monthFlows: {},
  loanPaymentExclusions: exclusions ? [EXCLUSION] : [],
  loanPaymentRefusedCategories: [],
});

// The with-figure shape — the FU2 fixtures' mirror (critic P2-2): the same
// exclusion with figures that DO render. The pace-figure / page-figures
// scopes speak there; the figureless scope must not.
const trendsWithFigure: SpendingTrendsData = {
  ...trendsFigureless(),
  pace: {
    ym: '2026-06',
    daysElapsed: 10,
    daysInMonth: 30,
    spentSoFarCents: 150_000,
    billsStillDueCents: 0,
    billsStillDue: [],
    discretionarySoFarCents: 150_000,
    projectedRemainderCents: 1_000_000,
    projectedCents: 1_150_000,
    priorMonthCents: 1_200_000,
    deltaVsPriorCents: -50_000,
  },
};

const reportsWithFigure: ReportsData = {
  ...reportsFigureless(),
  months: [{ month: '2026-06', incomeCents: 0, expensesCents: 12_000 }],
};

describe('O.18e-FU2 — /trends: the pace-empty branch speaks when an excluded payment moved', () => {
  it('prints PACE_NO_SPEND_YET AND the figureless sentence, verbatim', () => {
    render(<TrendsView trends={trendsFigureless()} />);
    expect(screen.getByTestId('trends-pace-empty')).toBeTruthy();
    expect(screen.getByText(/No spending counted yet this month/)).toBeTruthy();
    const sentence = screen.getByTestId('trends-loan-payment-basis-empty');
    expect(sentence.textContent).toBe(FIGURELESS);
  });

  it('the with-figure branch stays silent here — the two render decisions are disjoint', () => {
    render(<TrendsView trends={trendsFigureless()} />);
    // The scoped sentence names a pace figure this branch does not render.
    expect(screen.queryByTestId('trends-loan-payment-basis')).toBeNull();
    expect(document.body.textContent).not.toContain('not in this pace figure');
  });

  it('CONTROL: empty with NO exclusions stays silent — an empty exclusion set is the honest silence', () => {
    render(<TrendsView trends={trendsFigureless(false)} />);
    expect(screen.getByTestId('trends-pace-empty')).toBeTruthy();
    expect(screen.queryByTestId('trends-loan-payment-basis-empty')).toBeNull();
  });

  it('CONTROL (mirror, critic P2-2): a with-figure render never prints the figureless sentence', () => {
    render(<TrendsView trends={trendsWithFigure} />);
    expect(screen.getByTestId('trends-loan-payment-basis')).toBeTruthy();
    expect(screen.queryByTestId('trends-loan-payment-basis-empty')).toBeNull();
  });
});

describe('O.18e-FU2 — /reports: the chart-empty branch speaks when an excluded payment moved', () => {
  it('prints the empty claim AND the figureless sentence, verbatim', () => {
    render(<ReportsView data={reportsFigureless()} withheld={{ count: 0, currencies: [] }} months={6} />);
    expect(screen.getByTestId('income-expense-empty')).toBeTruthy();
    expect(screen.getByText(/No income or spending recorded in the last 6 months/)).toBeTruthy();
    const sentence = screen.getByTestId('reports-loan-payment-basis-empty');
    expect(sentence.textContent).toBe(FIGURELESS);
  });

  it('the with-figure branch stays silent here — the two render decisions are disjoint', () => {
    render(<ReportsView data={reportsFigureless()} withheld={{ count: 0, currencies: [] }} months={6} />);
    expect(screen.queryByTestId('reports-loan-payment-basis')).toBeNull();
    expect(document.body.textContent).not.toContain('not in these figures');
  });

  it('CONTROL: empty with NO exclusions stays silent', () => {
    render(
      <ReportsView data={reportsFigureless(false)} withheld={{ count: 0, currencies: [] }} months={6} />,
    );
    expect(screen.getByTestId('income-expense-empty')).toBeTruthy();
    expect(screen.queryByTestId('reports-loan-payment-basis-empty')).toBeNull();
  });

  it('CONTROL (mirror, critic P2-2): a with-figure render never prints the figureless sentence', () => {
    render(
      <ReportsView data={reportsWithFigure} withheld={{ count: 0, currencies: [] }} months={6} />,
    );
    expect(screen.getByTestId('reports-loan-payment-basis')).toBeTruthy();
    expect(screen.queryByTestId('reports-loan-payment-basis-empty')).toBeNull();
  });
});
