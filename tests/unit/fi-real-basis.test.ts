/**
 * TASKS W.2 + W.9 — the /coach FI card's projection basis, locked against the REAL
 * `getCoachData` and real Prisma.
 *
 * W.2's defect was a UNIT MISMATCH, not an arithmetic one: `fiNumberCents(annualExpenses,
 * swrBps)` is a present value (the reader's last 6 complete months of spending × 2), and the
 * server grew the portfolio toward it at the NOMINAL dial — future dollars measured against
 * today's dollars, optimistic by the whole inflation gap. Nothing about that is visible from
 * inside the engine, which is why these tests drive the server read rather than `monthsToFI`
 * directly: `monthsToFI` was never wrong, its third argument was.
 *
 * The core lock (`compounds at the REAL rate`) is written so it CANNOT pass vacuously. It
 * asserts the fixture is non-degenerate (a portfolio, a positive savings rate, a reachable
 * target), then pins the returned month count to the real-rate recomputation AND asserts the
 * nominal-rate recomputation differs and differs in the OPTIMISTIC direction. A test that only
 * checked `months === monthsToFI(..., projectionReturnBps, ...)` would pass just as happily
 * with the bug restored, because `projectionReturnBps` would have moved with it — the
 * `f(x, null) === f(x)` shape the L.15 finding warns about.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/db';
import { cents } from '@/lib/money';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import { coastFI, monthsToFI } from '@/lib/engine/fi/fi';
import {
  RETIREMENT_ASSUMPTIONS,
  isRealReturnFloored,
  realReturnBps,
} from '@/lib/engine/investments/retirement';
import { getCoachData } from '@/server/coach';

const NOMINAL_BPS = 700;
const INFLATION_BPS = 250;
/** 7.00% less 2.50%. Written as a literal rather than derived, so a change to the helper has
 *  to come past this file rather than through it. */
const REAL_BPS = 450;

/**
 * Twelve complete months of identical income and spending, ending 2026-06.
 *
 * Identical months mean the six the server picks are the same six whatever the wall clock
 * says: `monthlyFlows` emits only months that CONTAIN rows and `getCoachData` takes the last
 * six COMPLETE ones, so any "today" after 2026-06 selects 2026-01..2026-06 and yields the same
 * figures. The alternative — dating rows relative to `new Date()` — would make the fixture's
 * arithmetic drift with the calendar, and this file's assertions are exact.
 */
const MONTHS = [
  '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12',
  '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06',
];
const INCOME_CENTS = 500_000; // $5,000/mo
const EXPENSE_CENTS = 300_000; // $3,000/mo → $2,000/mo saved, $36,000/yr of spending
const PORTFOLIO_CENTS = 10_000_000; // $100,000 invested

async function seedUser(
  id: string,
  opts: { expectedReturnBps: number; inflationBps: number | null },
): Promise<void> {
  await prisma.user.deleteMany({ where: { id } });
  await prisma.user.create({
    data: {
      id,
      email: `${id}@test.local`,
      expectedReturnBps: opts.expectedReturnBps,
      swrBps: 400,
      inflationBps: opts.inflationBps,
    },
  });
  const checking = await prisma.account.create({
    data: {
      userId: id,
      provider: 'plaid',
      providerRef: `${id}-checking`,
      name: 'Everyday Checking',
      type: 'CHECKING',
      currency: 'USD',
      currentBalanceCents: 0,
    },
  });
  await prisma.account.create({
    data: {
      userId: id,
      provider: 'plaid',
      providerRef: `${id}-brokerage`,
      name: 'Brokerage',
      type: 'INVESTMENT',
      currency: 'USD',
      currentBalanceCents: PORTFOLIO_CENTS,
    },
  });
  await prisma.transaction.createMany({
    data: MONTHS.flatMap((m) => [
      // Positive with no category = an income row (`isIncomeFlowRow`).
      {
        id: `${id}-inc-${m}`,
        accountId: checking.id,
        date: `${m}-05`,
        amountCents: INCOME_CENTS,
        rawDescriptor: 'PAYROLL',
      },
      {
        id: `${id}-exp-${m}`,
        accountId: checking.id,
        date: `${m}-12`,
        amountCents: -EXPENSE_CENTS,
        rawDescriptor: 'LIVING EXPENSES',
        categoryId: 'groceries',
      },
    ]),
  });
}

// ════════════════════════════════════════════════════════════════════════════════════════════
describe('W.2 — the FI projections compound at the REAL return, not the nominal dial', () => {
  const U = `w2-real-${Date.now()}-${process.pid}`;

  beforeAll(async () => {
    await seedUser(U, { expectedReturnBps: NOMINAL_BPS, inflationBps: INFLATION_BPS });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: U } });
  });

  it('reports the real rate it used, and the two operands the copy names', async () => {
    const d = await getCoachData(U);
    expect(d.fi.expectedReturnBps).toBe(NOMINAL_BPS);
    expect(d.fi.inflationBps).toBe(INFLATION_BPS);
    expect(d.fi.projectionReturnBps).toBe(REAL_BPS);
    expect(d.fi.inflationIsDefault).toBe(false);
    expect(d.fi.realReturnFloored).toBe(false);
  });

  it('years-to-FI is the REAL-rate answer, and the nominal one would have been sooner', async () => {
    const d = await getCoachData(U);

    // ── the fixture must actually exercise the case, or the assertions below are theatre ──
    expect(d.fi.portfolioCents).toBe(PORTFOLIO_CENTS);
    expect(d.fi.monthlySavingsCents).toBe(200_000);
    expect(d.fi.annualExpensesCents).toBe(3_600_000);
    expect(d.fi.fiNumberCents).toBe(90_000_000); // $36,000 ÷ 4%
    expect(d.fi.monthsToFI).not.toBeNull();

    const real = monthsToFI(
      cents(PORTFOLIO_CENTS),
      cents(200_000),
      REAL_BPS,
      cents(90_000_000),
    );
    const nominal = monthsToFI(
      cents(PORTFOLIO_CENTS),
      cents(200_000),
      NOMINAL_BPS,
      cents(90_000_000),
    );
    expect(d.fi.monthsToFI).toBe(real);
    // The bug's signature, stated as an assertion: the nominal basis arrives strictly sooner.
    // This is what makes the pin above unfalsifiable-proof — restoring the bug moves the
    // returned value onto `nominal`, which this line asserts is a DIFFERENT number.
    expect(nominal).not.toBeNull();
    expect(nominal!).toBeLessThan(real!);
  });

  it('the Coast line is on the same real basis as the date above it', async () => {
    const d = await getCoachData(U);
    const real = coastFI(cents(PORTFOLIO_CENTS), cents(90_000_000), REAL_BPS, 25 * 12);
    const nominal = coastFI(cents(PORTFOLIO_CENTS), cents(90_000_000), NOMINAL_BPS, 25 * 12);

    expect(d.fi.coastIsCoast).toBe(real.isCoastFI);
    expect(d.fi.coastRequiredMonthlyCents).toBe(real.requiredMonthlyContributionCents);
    // Non-vacuity: the two bases genuinely disagree on this fixture, so the pin above is a
    // choice between two live answers rather than a restatement of one.
    expect(real.requiredMonthlyContributionCents).not.toBe(
      nominal.requiredMonthlyContributionCents,
    );
    // …and the nominal basis asks for LESS money — the flattering direction.
    expect(nominal.requiredMonthlyContributionCents!).toBeLessThan(
      real.requiredMonthlyContributionCents!,
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
describe('W.2 — the inflation dial the reader never set', () => {
  const U = `w2-default-${Date.now()}-${process.pid}`;

  beforeAll(async () => {
    await seedUser(U, { expectedReturnBps: NOMINAL_BPS, inflationBps: null });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: U } });
  });

  it('falls back to the shared assumption and SAYS it was a fallback', async () => {
    const d = await getCoachData(U);
    expect(d.fi.inflationBps).toBe(RETIREMENT_ASSUMPTIONS.inflationBps);
    expect(d.fi.inflationIsDefault).toBe(true);
    expect(d.fi.projectionReturnBps).toBe(NOMINAL_BPS - RETIREMENT_ASSUMPTIONS.inflationBps);
  });

  it('the basis copy will not call an unset dial "yours" (a possessive is a claim)', async () => {
    const d = await getCoachData(U);
    const line = COACH_COPY.fiProjectionBasis(
      d.fi.projectionReturnBps,
      d.fi.expectedReturnBps,
      d.fi.inflationBps,
      d.fi.realReturnFloored,
      d.fi.inflationIsDefault,
    );
    expect(line).toContain('our default 2.50% inflation assumption');
    expect(line).not.toContain('your 2.50% inflation assumption');
    // The reader's OWN dial is still theirs — only the inflation half is disclaimed.
    expect(line).toContain('your 7.00% return assumption');
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
describe('W.2 — inflation at or above the return assumption (the floored branch)', () => {
  const U = `w2-floored-${Date.now()}-${process.pid}`;

  beforeAll(async () => {
    await seedUser(U, { expectedReturnBps: 200, inflationBps: 1000 });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: U } });
  });

  it('floors the real rate at zero and flags that it did', async () => {
    const d = await getCoachData(U);
    expect(d.fi.projectionReturnBps).toBe(0);
    expect(d.fi.realReturnFloored).toBe(true);
  });

  it('the floored copy does NOT print the subtraction, and names its direction', async () => {
    const d = await getCoachData(U);
    const line = COACH_COPY.fiProjectionBasis(
      d.fi.projectionReturnBps,
      d.fi.expectedReturnBps,
      d.fi.inflationBps,
      d.fi.realReturnFloored,
      d.fi.inflationIsDefault,
    );
    // "2.00% less 10.00%" is not 0.00%, and a reader can do that arithmetic in their head
    // (`the-arithmetic-was-never-the-risk`: a clamped output may not print its inputs).
    expect(line).not.toContain('less');
    // Digit-boundary, not `toContain('0.00%')`: "10.00%" ends with that substring, so the
    // naive check fails on a correct sentence. What must not appear is the CLAMPED RESULT
    // presented as a rate of its own.
    expect(line).not.toMatch(/(^|[^\d])0\.00%/);
    expect(line).toContain('no growth after inflation at all');
    // A clamp that flatters is the expensive one, so the direction is stated.
    expect(line).toContain('later than they say, not sooner');
  });

  it('a zero real rate still projects — it does not crash or silently skip the card', async () => {
    const d = await getCoachData(U);
    // With no growth at all, savings alone must still carry the reader to the target.
    expect(d.fi.monthsToFI).toBe(
      monthsToFI(cents(PORTFOLIO_CENTS), cents(200_000), 0, cents(90_000_000)),
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
/**
 * The W.2 critic cycle. Both critics ran fresh-context with different lenses and converged
 * INDEPENDENTLY on two of these — the strongest signal available that a finding is real.
 *
 * The card-level state selection is asserted through the same expression `fi-card.tsx` uses,
 * because these are UI branches over engine outputs and the defect was never in the engine.
 */
describe('W.2 critic — the four states `monthsToFI: null` was collapsing into one', () => {
  /** The card's OWN selector — imported, not re-implemented, so reverting the component
   *  fails these tests instead of leaving them passing over a copy of the old logic. */
  const yearsToFiLine = (o: {
    monthsToFINow: number | null;
    monthlySavingsCents: number;
    coastIsCoast: boolean;
    projectionReturnBps: number;
  }): string =>
    COACH_COPY.fiHeadline({
      monthsToFI: o.monthsToFINow,
      monthlySavingsCents: o.monthlySavingsCents,
      coastIsCoast: o.coastIsCoast,
      projectionReturnBps: o.projectionReturnBps,
    });

  it('a saver past the projection cap is NOT told they aren\'t saving (F1)', () => {
    // Measured by the critic: at a floored 0% real rate the 1200-month cap binds on savings
    // below fiTarget/1200 — $740/mo against a $900k target — and the card called that reader
    // "not outpacing spending". They save $8,880 a year.
    const months = monthsToFI(cents(0), cents(74_000), 0, cents(90_000_000));
    expect(months).toBeNull(); // the precondition that made the old copy fire

    const line = yearsToFiLine({
      monthsToFINow: months,
      monthlySavingsCents: 74_000,
      coastIsCoast: false,
      projectionReturnBps: 0,
    });
    expect(line).not.toContain("aren't outpacing spending");
    expect(line).toContain('You are saving');
    expect(line).toContain('beyond the 100 years');
  });

  it('"not on track" and "already Coast FI" no longer contradict each other (F3)', () => {
    // Big portfolio, negative savings: monthsToFI is null while coastFI says the portfolio
    // alone arrives. The old copy said "a projection date wouldn't be honest" directly above
    // a Coast line handing over a date.
    const months = monthsToFI(cents(50_000_000), cents(-500_000), 450, cents(90_000_000));
    const coast = coastFI(cents(50_000_000), cents(90_000_000), 450, 25 * 12);
    expect(months).toBeNull();
    expect(coast.isCoastFI).toBe(true); // both preconditions genuinely hold

    const line = yearsToFiLine({
      monthsToFINow: months,
      monthlySavingsCents: -500_000,
      coastIsCoast: coast.isCoastFI,
      projectionReturnBps: 450,
    });
    expect(line).toContain('see the Coast line below');
    expect(line).not.toContain("a projection date wouldn't be honest");
  });

  it('a genuinely non-saving reader still gets the plain sentence (no over-correction)', () => {
    const line = yearsToFiLine({
      monthsToFINow: null,
      monthlySavingsCents: -500_000,
      coastIsCoast: false,
      projectionReturnBps: 450,
    });
    expect(line).toBe(COACH_COPY.notOnTrack());
  });
});

describe('W.2 critic — claims the copy may not make', () => {
  it('does not promise the nominal basis arrives "years" earlier (F4 / UI-2)', () => {
    // Executed by both critics: for a reader one month from their number the two bases land
    // on the SAME month, so "years earlier" is false exactly where the card is scrutinised most.
    const real = monthsToFI(cents(89_900_000), cents(200_000), 450, cents(90_000_000));
    const nominal = monthsToFI(cents(89_900_000), cents(200_000), 700, cents(90_000_000));
    expect(real).toBe(nominal); // the gap the retired sentence called "years"

    const line = COACH_COPY.fiProjectionBasis(450, 700, 250, false, false);
    expect(line).not.toContain('years earlier');
    expect(line).toContain('would arrive sooner'); // direction only — always true
  });

  it('says the monthly figures are today\'s dollars that a flat standing order outruns (UI-1)', () => {
    // W.2 changed `notCoastFI` from a nominal instalment to a REAL one without changing the
    // sentence. The engine's convention (`retirement.ts`) is level contributions at a real
    // rate = today's dollars, so an untouched standing order lands short — the same caveat
    // the sibling wealth card already carried for the identical figure.
    expect(COACH_COPY.notCoastFI(cents(145_462), 25, 450, true)).toContain("in today's money");
    const basis = COACH_COPY.fiProjectionBasis(450, 700, 250, false, false);
    expect(basis).toContain('would need to rise with inflation');
  });

  it('equal dials read as a match, not as "7.00% is at or below 7.00%" (UI-11)', () => {
    const equal = COACH_COPY.fiProjectionBasis(0, 700, 700, true, false);
    expect(equal).toContain('exactly matches');
    expect(equal).not.toContain('at or below');
    // The strictly-below case keeps its own wording.
    expect(COACH_COPY.fiProjectionBasis(0, 200, 1000, true, false)).toContain('is below');
  });

  it('no sentence points at a screen POSITION for a rate (UI-8 / UI-9)', () => {
    // "the dates above" was false — the Coast line and the slider are below the disclosure —
    // and "the return rate above" became ambiguous once two rates appeared above it.
    const vol = COACH_COPY.volatilityPrice(700, 450);
    expect(vol).toContain('the projections on this card');
    expect(vol).not.toContain('the dates above');
    expect(COACH_COPY.freedomDividend(17, 450)).toContain('4.50% after inflation above');
  });
});

describe('W.2 critic — the real-return helper is total (F7)', () => {
  it('a negative inflation row cannot lift the real rate above the nominal dial', () => {
    // `Math.max(0, nominal - inflation)` guarded only the top. A -2.50% row made 7.00% become
    // 9.50% and reported "not floored", so the card would have printed a projection MORE
    // optimistic than the reader's own dial. No DB constraint backs `User.inflationBps`.
    expect(realReturnBps(700, -250)).toBe(700);
    expect(realReturnBps(700, 250)).toBe(450);
    expect(isRealReturnFloored(700, -250)).toBe(false);
    // The two stay consistent with each other at the boundary.
    expect(realReturnBps(700, 700)).toBe(0);
    expect(isRealReturnFloored(700, 700)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
describe('W.9 — the Coast horizon says who chose it', () => {
  const U = `w9-horizon-${Date.now()}-${process.pid}`;

  beforeAll(async () => {
    await seedUser(U, { expectedReturnBps: NOMINAL_BPS, inflationBps: INFLATION_BPS });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: U } });
  });

  it('no control sets the 25 years, so the server reports it as the app\'s pick', async () => {
    const d = await getCoachData(U);
    expect(d.fi.coastTargetYears).toBe(25);
    expect(d.fi.coastTargetYearsIsAppDefault).toBe(true);
  });

  it('both Coast sentences disclaim an app-chosen horizon, and neither does when it is the reader\'s', () => {
    const appChose = COACH_COPY.notCoastFI(cents(120_000), 25, REAL_BPS, true);
    expect(appChose).toContain('not a date you set');
    expect(COACH_COPY.coastFI(25, REAL_BPS, true)).toContain('not a date you set');

    // The false branch must be a real alternative, not dead decoration: if a control ever
    // sets the horizon, the sentence has to stop disclaiming it.
    const readerChose = COACH_COPY.notCoastFI(cents(120_000), 25, REAL_BPS, false);
    expect(readerChose).toContain('the horizon you set');
    expect(readerChose).not.toContain('not a date you set');
    expect(COACH_COPY.coastFI(25, REAL_BPS, false)).not.toContain('not a date you set');
  });
});
