// @vitest-environment jsdom
/**
 * K.7 (DECISIONS #437) cycle 1 critic F3 — the /calendar WIRING, locked at the
 * render site.
 *
 * The pure engine and the radar/forecast wiring are locked elsewhere; this is
 * the one surface line the critic found unwitnessed (deleting the
 * `splitLoanCarriedScheduled` call in page.tsx kept every test green). It
 * renders the REAL awaited server component to static markup with a mocked
 * session and a mocked cash-needed read, and the real register read against the
 * unit DB — so the row that must not paint TWICE is asserted by the absence of
 * the detected series' description, and the row that must still paint when
 * C.25 has no fact is asserted by its presence (#400's failure direction: a
 * duplicate the reader can see beats a real payment silently deleted).
 *
 * FAIL-OLD: restoring `scheduled: snap.scheduled.map(...)` (skipping the
 * split) turns test 1 red — the wiring line is locked, not just the engine.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { getCashNeeded as getCashNeededType } from '@/server/finance';
import { prisma } from '@/lib/db';
import CalendarPage from '@/app/(app)/calendar/page';

type CashNeeded = Awaited<ReturnType<typeof getCashNeededType>>;

// The demo user's session, mocked at the boundary — the page graph needs only
// `auth` from '@/auth' (the register read path deliberately stays free of
// NextAuth, the #220 rule), and only `getCashNeeded` from '@/server/finance'.
const TEST_USER = 'calendar-k7-f3';
vi.mock('@/auth', () => ({
  auth: async () => ({ user: { id: TEST_USER } }),
}));
vi.mock('@/server/finance', () => ({ getCashNeeded: vi.fn() }));
import { getCashNeeded } from '@/server/finance';

/** The demo's auto loan as `getCashNeeded` derives it (selectLoanObligations). */
const AUTO_LOAN_OBLIGATION = {
  accountId: 'acct-autoloan',
  accountName: 'Auto Loan',
  accountType: 'LOAN',
  dueDate: '2026-07-05',
  effectiveDueDate: '2026-07-02', // July 5, 2026 is a Sunday → prior business day
  paymentCents: 38500,
  isEstimated: false,
  frozenSince: null,
};

/** The detected series row `server/recurring.ts` persists for the ACH that pays it. */
const DETECTED = {
  id: 'sched-loan-detected',
  accountId: 'chk',
  description: 'CARMAX AUTO FINANCE',
  amountCents: -38500,
  nextDate: '2026-07-05',
  cadence: 'MONTHLY',
};

/** The C.25 disclosure fact proving the row above IS the obligation's payment. */
const CARRIED = {
  canonical: 'Carmax Auto Finance',
  accountId: 'acct-autoloan',
  paymentCents: 38500,
};

function cashNeeded(withFact: boolean): CashNeeded {
  return {
    today: '2026-06-10', // the pinned demo asOf; the loan's July cycle is ahead of it
    snap: {
      scheduled: [DETECTED],
      loanPaymentFlowExclusions: withFact
        ? { excludeIds: new Set<string>(), excluded: [CARRIED] }
        : undefined,
    },
    input: {
      cards: [],
      paymentAccount: { id: 'chk', name: 'Everyday Checking' },
    },
    result: {
      cards: [],
      headline: { shortfallDate: null, recommendation: null, shortfallDateBalanceCents: null, worstDipDate: null },
      fundingFrozen: null,
      intraPeriodMinimum: null,
    },
    loanObligations: [AUTO_LOAN_OBLIGATION],
    scope: 'mine',
    household: null,
    accountOwnerLabel: {},
    householdWithheldCount: 0,
    householdDuplicates: [],
    cardDuplicates: [],
  } as unknown as CashNeeded;
}

beforeAll(async () => {
  // The page's own gate: `prisma.account.count(...) > 0`, or it renders the
  // onboarding empty state instead of the grid. One row is enough; the posted
  // half of the month reads an empty register, which is a valid state.
  await prisma.user.create({ data: { id: TEST_USER, email: `${TEST_USER}@test.local` } });
  await prisma.account.create({
    data: {
      id: `${TEST_USER}-chk`,
      userId: TEST_USER,
      provider: 'demo',
      name: 'Everyday Checking',
      type: 'CHECKING',
      currentBalanceCents: 1_249_500,
      currency: 'USD',
    },
  });
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: TEST_USER } }); // cascades the account
});

async function renderCalendar() {
  return renderToStaticMarkup(
    await CalendarPage({ searchParams: Promise.resolve({ month: '2026-07' }) }),
  );
}

describe('K.7 — /calendar paints the proven loan payment once (critic F3)', () => {
  it('the C.25-proven detected row is not ALSO painted: obligation due yes, series no', async () => {
    vi.mocked(getCashNeeded).mockResolvedValueOnce(cashNeeded(true));
    const html = await renderCalendar();
    // The obligation owns the payment — its badged due is the one row in July.
    expect(html).toContain('Auto Loan due');
    // The detected series' description must not survive as a second row.
    expect(html).not.toContain('CARMAX AUTO FINANCE');
  });

  it('with no C.25 fact the duplicate stays VISIBLE — both rows paint (#400)', async () => {
    vi.mocked(getCashNeeded).mockResolvedValueOnce(cashNeeded(false));
    const html = await renderCalendar();
    // A first month, a one-sided bank: nothing is proven, nothing may be
    // deleted. The reader sees the obligation AND the detected series.
    expect(html).toContain('Auto Loan due');
    expect(html).toContain('CARMAX AUTO FINANCE');
  });
});
