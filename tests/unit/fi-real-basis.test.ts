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
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '@/lib/db';
import { cents, formatCents } from '@/lib/money';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import {
  DEFAULT_EXPECTED_RETURN_BPS,
  type DialOwnership,
} from '@/lib/engine/settings/dials';
import type { Opportunity } from '@/lib/engine/fi/insights';
import {
  coastFI,
  monthsToFI,
  opportunityFVCents,
  opportunityRowTrailsContributions,
  opportunityValueTodayCents,
  opportunityValueTrailsContributions,
} from '@/lib/engine/fi/fi';
import {
  RETIREMENT_ASSUMPTIONS,
  isRealReturnFloored,
  realReturnBps,
} from '@/lib/engine/investments/retirement';
import { getCoachData } from '@/server/coach';

const NOMINAL_BPS = 700;

/**
 * W.13 — who chose each rate. The seeded users below set `expectedReturnBps` EXPLICITLY, so
 * `OWNS_BOTH` is what the pure-copy cases assert against; `getCoachData` decides the live flag
 * by value, which is why the two integration cases pass what the server actually returned
 * rather than one of these.
 */
const OWNS_BOTH: DialOwnership = { returnIsDefault: false, inflationIsDefault: false };
const DEFAULT_BOTH: DialOwnership = { returnIsDefault: true, inflationIsDefault: true };
const DEFAULT_RETURN: DialOwnership = { returnIsDefault: true, inflationIsDefault: false };
const INFLATION_BPS = 250;
/** 7.00% less 2.50%. Written as a literal rather than derived, so a change to the helper has
 *  to come past this file rather than through it. */
const REAL_BPS = 450;

/**
 * Twelve complete months of identical income and spending, ending 2026-06.
 *
 * Identical months mean the six the server picks yield the same figures wherever the six-month
 * window lands: `monthlyFlows` emits only months that CONTAIN rows and `getCoachData` takes
 * the last six COMPLETE ones (strictly before the current month — K.8 critic: at the gate's
 * pinned today of 2026-06-10 the window is 2025-12..2026-05, NOT "2026-01..2026-06" as this
 * comment used to claim). Because all twelve months are identical, the arithmetic is invariant
 * to which six are chosen; only C.9 below asserts a window SIZE, and it pins its own today.
 * The alternative — dating rows relative to `new Date()` — would make the fixture's
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
  /**
   * W.13 — 8.00% rather than the 700 this block used to seed. `returnIsDefault` is decided by
   * VALUE (there is no nullable column to read), so a fixture seeded at exactly the app's
   * default cannot express "the reader chose this rate", and the old assertion below — that the
   * return half stays "yours" while the inflation half is disclaimed — was riding a user whose
   * return dial was indistinguishable from an untouched one. The sibling block asserts the
   * default direction on its own fixture.
   */
  const CHOSEN_RETURN_BPS = 800;

  beforeAll(async () => {
    await seedUser(U, { expectedReturnBps: CHOSEN_RETURN_BPS, inflationBps: null });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: U } });
  });

  it('falls back to the shared assumption and SAYS it was a fallback', async () => {
    const d = await getCoachData(U);
    expect(d.fi.inflationBps).toBe(RETIREMENT_ASSUMPTIONS.inflationBps);
    expect(d.fi.inflationIsDefault).toBe(true);
    expect(d.fi.projectionReturnBps).toBe(
      CHOSEN_RETURN_BPS - RETIREMENT_ASSUMPTIONS.inflationBps,
    );
  });

  it('the basis copy will not call an unset dial "yours" (a possessive is a claim)', async () => {
    const d = await getCoachData(U);
    const line = COACH_COPY.fiProjectionBasis(
      d.fi.projectionReturnBps,
      d.fi.expectedReturnBps,
      d.fi.inflationBps,
      d.fi.realReturnFloored,
      { returnIsDefault: d.fi.returnIsDefault, inflationIsDefault: d.fi.inflationIsDefault },
    );
    expect(line).toContain('our default 2.50% inflation assumption');
    expect(line).not.toContain('your 2.50% inflation assumption');
    // The dial this reader DID set is still theirs — only the inflation half is disclaimed.
    expect(d.fi.returnIsDefault).toBe(false);
    expect(line).toContain('your 8.00% return assumption');
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
/**
 * W.13 — the mirror of the block above, and the defect it was opened for. `expectedReturnBps`
 * is NOT nullable: it carries the app's own 700 for every reader who has never opened the
 * /settings money dials, and until this slice all six sentences that name it called that
 * number "your 7.00% return assumption". This fixture is the ordinary case — a user row
 * created with nothing but defaults — so it is the one the live demo and every new signup are
 * in.
 */
describe('W.13 — the return dial the reader never set', () => {
  const U = `w13-default-${Date.now()}-${process.pid}`;

  beforeAll(async () => {
    // Both dials left as the app supplies them: `inflationBps` null, `expectedReturnBps` at
    // its schema default.
    await seedUser(U, { expectedReturnBps: DEFAULT_EXPECTED_RETURN_BPS, inflationBps: null });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: U } });
  });

  it('reports the return dial as the app’s, and the copy says so on every surface', async () => {
    const d = await getCoachData(U);
    expect(d.fi.returnIsDefault).toBe(true);
    expect(d.fi.inflationIsDefault).toBe(true);
    const owner = {
      returnIsDefault: d.fi.returnIsDefault,
      inflationIsDefault: d.fi.inflationIsDefault,
    };
    const basis = COACH_COPY.fiProjectionBasis(
      d.fi.projectionReturnBps,
      d.fi.expectedReturnBps,
      d.fi.inflationBps,
      d.fi.realReturnFloored,
      owner,
    );
    const list = COACH_COPY.opportunityBasis(d.fi.expectedReturnBps, d.fi.inflationBps, owner);
    const dials = COACH_COPY.wealthTargetDials(
      d.fi.expectedReturnBps,
      d.fi.inflationBps,
      owner,
    );
    for (const line of [basis, list]) {
      expect(line).toContain('our default 7.00% return assumption');
      expect(line).not.toContain('your 7.00% return assumption');
    }
    // The dials sentence is the one that said it outright — "7.00% return is your setting".
    expect(dials).toContain("7.00% return and 2.50% inflation");
    expect(dials).toContain("Aimplifi's defaults");
    expect(dials).not.toContain('your setting');
    expect(dials).not.toMatch(/yours to change/i);
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
      { returnIsDefault: d.fi.returnIsDefault, inflationIsDefault: d.fi.inflationIsDefault },
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
  }): string =>
    COACH_COPY.fiHeadline({
      monthsToFI: o.monthsToFINow,
      monthlySavingsCents: o.monthlySavingsCents,
      coastIsCoast: o.coastIsCoast,
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
    });
    expect(line).toContain('see the Coast line below');
    expect(line).not.toContain("a projection date wouldn't be honest");
  });

  it('a genuinely non-saving reader still gets the plain sentence (no over-correction)', () => {
    const line = yearsToFiLine({
      monthsToFINow: null,
      monthlySavingsCents: -500_000,
      coastIsCoast: false,
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

    const line = COACH_COPY.fiProjectionBasis(450, 700, 250, false, OWNS_BOTH);
    expect(line).not.toContain('years earlier');
    expect(line).toContain('would arrive sooner'); // direction only — always true
  });

  it('says the monthly figures are today\'s dollars that a flat standing order outruns (UI-1)', () => {
    // W.2 changed `notCoastFI` from a nominal instalment to a REAL one without changing the
    // sentence. The engine's convention (`retirement.ts`) is level contributions at a real
    // rate = today's dollars, so an untouched standing order lands short — the same caveat
    // the sibling wealth card already carried for the identical figure.
    expect(COACH_COPY.notCoastFI(cents(145_462), 25, true)).toContain("in today's money");
    const basis = COACH_COPY.fiProjectionBasis(450, 700, 250, false, OWNS_BOTH);
    expect(basis).toContain('would need to rise with inflation');
  });

  it('equal dials read as a match, not as "7.00% is at or below 7.00%" (UI-11)', () => {
    const equal = COACH_COPY.fiProjectionBasis(0, 700, 700, true, OWNS_BOTH);
    expect(equal).toContain('exactly matches');
    expect(equal).not.toContain('at or below');
    // The strictly-below case keeps its own wording.
    expect(COACH_COPY.fiProjectionBasis(0, 200, 1000, true, OWNS_BOTH)).toContain('is below');
  });

  it('no sentence points at a screen POSITION for a rate (UI-8 / UI-9)', () => {
    // "the dates above" was false — the Coast line and the slider are below the disclosure —
    // and "the return rate above" became ambiguous once two rates appeared above it.
    // W.12 — freedomDividend used to say "the 4.50% after inflation above"; that both pointed
    // at a position and restated a rate the basis owns. It now names neither.
    const vol = COACH_COPY.volatilityPrice(700, 450);
    expect(vol).toContain('the projections on this card');
    expect(vol).not.toContain('the dates above');
    const payoff = COACH_COPY.freedomDividend(17);
    expect(payoff).not.toMatch(/\d+\.\d+%/);
    expect(payoff).not.toMatch(/\b(above|below)\b/);
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
    const appChose = COACH_COPY.notCoastFI(cents(120_000), 25, true);
    expect(appChose).toContain('not a date you set');
    expect(COACH_COPY.coastFI(25, true)).toContain('not a date you set');

    // The false branch must be a real alternative, not dead decoration: if a control ever
    // sets the horizon, the sentence has to stop disclaiming it.
    const readerChose = COACH_COPY.notCoastFI(cents(120_000), 25, false);
    expect(readerChose).toContain('the horizon you set');
    expect(readerChose).not.toContain('not a date you set');
    expect(COACH_COPY.coastFI(25, false)).not.toContain('not a date you set');
  });
});


// ════════════════════════════════════════════════════════════════════════════════════════════
/**
 * TASKS W.12 — rate-copy accretion on the FI card.
 *
 * After W.2 the same real rate appeared four times in four wordings before the reader
 * reached the payoff line, which an 800px viewport pushed past the fold. The rate lives
 * in `fiProjectionBasis` once; headline / Coast / payoff defer without restating the %.
 */
describe('W.12 — the FI card names the real rate once', () => {
  const RATE = '4.50%';

  it('headline, Coast and payoff do not restate the real-rate percentage', () => {
    expect(COACH_COPY.yearsToFI(17, 3)).not.toContain(RATE);
    expect(COACH_COPY.beyondProjectionHorizon()).not.toContain(RATE);
    expect(COACH_COPY.coastFI(25, true)).not.toContain(RATE);
    expect(COACH_COPY.notCoastFI(cents(120_000), 25, true)).not.toContain(RATE);
    expect(COACH_COPY.freedomDividend(17)).not.toContain(RATE);
    // And not any other xx.xx% — the deferral is "this card's return assumptions", not a
    // different number silently substituted.
    for (const line of [
      COACH_COPY.yearsToFI(17, 3),
      COACH_COPY.coastFI(25, true),
      COACH_COPY.notCoastFI(cents(120_000), 25, true),
      COACH_COPY.freedomDividend(17),
    ]) {
      expect(line).not.toMatch(/\d+\.\d+%/);
    }
  });

  it('the basis paragraph is still the one place that names both dials and the real rate', () => {
    const basis = COACH_COPY.fiProjectionBasis(450, 700, 250, false, OWNS_BOTH);
    expect(basis).toContain(RATE);
    expect(basis).toContain('7.00%');
    expect(basis).toContain('2.50%');
  });

  it('fail-old: restoring a rate into yearsToFI would re-accrete the copy this slice removed', () => {
    // Pins the invariant the task named. If a later edit puts "assuming 4.50% … after
    // inflation" back into the headline, this dies with a message that explains itself.
    const headline = COACH_COPY.yearsToFI(17, 3);
    expect(headline).toContain("this card's return assumptions");
    expect(headline).not.toMatch(/after inflation/);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
/**
 * TASKS W.10 — the "Worth a look" figures are in today's money too.
 *
 * W.2 moved the FI card into today's money and left this list, one scroll down, printing
 * NOMINAL 30-year future values under the words "future wealth". Both figures were correct
 * about their own unit and nothing on screen said which was which.
 *
 * These drive the real `getCoachData` for the same reason the W.2 block does: the engine was
 * never wrong, its ARGUMENTS were, and an argument is invisible from inside the function. A
 * test calling `findOpportunities(series, rate, inflation)` directly would pass just as happily
 * with the server handing it the wrong pair.
 *
 * The model: grow the monthly amount at the reader's RETURN dial, then deflate the whole total
 * by the inflation dial over the same years — a contribution that is level in NOMINAL dollars.
 * The first implementation compounded at the real rate instead (level in TODAY'S dollars, ~30%
 * more), and two independent critics killed it on the `negotiable-bill` row, whose monthly
 * amount is a hard-coded flat $20 retention offer: there is no price there to argue would have
 * risen with inflation.
 */
describe("W.10 — the opportunity list is denominated in today's money", () => {
  const U = `w10-today-${Date.now()}-${process.pid}`;
  /** $120.00/mo of insurance → an `insurance-reshop` opportunity at 15% = $18.00/mo. */
  const PREMIUM_CENTS = 12_000;

  beforeAll(async () => {
    await seedUser(U, { expectedReturnBps: NOMINAL_BPS, inflationBps: INFLATION_BPS });
    const checking = await prisma.account.findFirstOrThrow({
      where: { userId: U, type: 'CHECKING' },
    });
    // A monthly premium on a subscription category, same merchant and same amount every month:
    // `detectRecurring` needs the stable cadence and `SUBSCRIPTION_CATEGORIES` needs the leaf.
    await prisma.transaction.createMany({
      data: MONTHS.map((m) => ({
        id: `${U}-ins-${m}`,
        accountId: checking.id,
        date: `${m}-20`,
        amountCents: -PREMIUM_CENTS,
        rawDescriptor: 'GEICO PREMIUM',
        categoryId: 'insurance',
      })),
    });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: U } });
  });

  it('is the return dial grown then deflated — and the nominal figure it replaced was far larger', async () => {
    const d = await getCoachData(U);
    const o = d.opportunities.find((x) => x.kind === 'insurance-reshop');
    // The fixture's hard case must be PRESENT, or every assertion below passes vacuously.
    expect(o, 'the seeded premium must surface as an opportunity').toBeDefined();
    if (!o) return;
    expect(o.monthlyCents).toBe(Math.round(PREMIUM_CENTS * 0.15));

    const today = opportunityValueTodayCents(o.monthlyCents, 360, NOMINAL_BPS, INFLATION_BPS);
    const nominal = opportunityFVCents(o.monthlyCents, 360, NOMINAL_BPS);
    expect(o.todayValue30Cents).toBe(today);
    // Non-vacuous: pinning only to `today` would pass with the bug restored if the rate moved
    // with it. The shipped figure is a little under half the future-dollar one it replaced.
    expect(o.todayValue30Cents).toBeLessThan(nominal);
    expect(nominal / today).toBeGreaterThan(1.9);

    // All three horizons ride the same pair — a fix applied to one of three is the shape the
    // disclosure classes here keep re-learning.
    expect(o.todayValue20Cents).toBe(
      opportunityValueTodayCents(o.monthlyCents, 240, NOMINAL_BPS, INFLATION_BPS),
    );
    expect(o.todayValue10Cents).toBe(
      opportunityValueTodayCents(o.monthlyCents, 120, NOMINAL_BPS, INFLATION_BPS),
    );
  });

  it('the three horizons cannot be printed in the wrong slots', async () => {
    const d = await getCoachData(U);
    const o = d.opportunities.find((x) => x.kind === 'insurance-reshop');
    expect(o).toBeDefined();
    if (!o) return;
    // A critic mutated the template so the 30- and 20-year values swapped slots, and every
    // assertion in the repo stayed green: each one was `toContain(oneFigure)`, which cannot see
    // WHERE the figure landed. A reader would have been told the 20-year total was the larger.
    expect(o.todayValue10Cents).toBeLessThan(o.todayValue20Cents);
    expect(o.todayValue20Cents).toBeLessThan(o.todayValue30Cents);
    // A golden literal, not three containments: the whole sentence, in order.
    expect(COACH_COPY.opportunity(o, d.fi.expectedReturnBps)).toBe(
      // `o.merchant` rather than a literal name: the canonicalizer's output ("Geico", not the
      // raw "GEICO PREMIUM" descriptor) is a different subject and does not belong in this lock.
      `Re-shopping ${o.merchant} typically saves ~15% (an estimate, assuming typical quotes) — about ` +
        `${formatCents(o.monthlyCents)}/mo, which is ${formatCents(o.todayValue30Cents)} in today's money ` +
        `over 30 years (${formatCents(o.todayValue20Cents)} over 20, ${formatCents(o.todayValue10Cents)} over 10), ` +
        `assuming 7.00% average annual returns — compounding does the work, not willpower.`,
    );
  });

  it('a flat retention estimate is not grown as though it were a price', () => {
    // The first implementation compounded every row at the REAL rate, which models a stream
    // that rises with inflation. `findOpportunities` mints `negotiable-bill` as a hard-coded
    // flat $20.00/mo retention offer, so that model asserted an indexing property its own
    // input cannot have — and printed about 30% more than such a reader will ever hold.
    const flat = cents(2000);
    const shipped = opportunityValueTodayCents(flat, 360, NOMINAL_BPS, INFLATION_BPS);
    const indexed = opportunityFVCents(flat, 360, realReturnBps(NOMINAL_BPS, INFLATION_BPS));
    expect(indexed).toBeGreaterThan(shipped);
    // Pin the gap the two models disagree by, so re-adopting the flattering one means changing
    // a test that explains itself.
    expect(indexed / shipped).toBeGreaterThan(1.25);
  });

  it('the row copy names the unit, and never claims future wealth', async () => {
    const d = await getCoachData(U);
    const o = d.opportunities.find((x) => x.kind === 'insurance-reshop');
    expect(o).toBeDefined();
    if (!o) return;
    const line = COACH_COPY.opportunity(o, d.fi.expectedReturnBps);
    expect(line).toContain("in today's money");
    // The exact wording the old figure carried. True of a nominal number, false of this one.
    expect(line).not.toContain('future wealth');
  });

  it('all four row kinds parse, and each names its own monthly amount', () => {
    // Two of the four used to run a colon straight into "is $X" — "…assuming a standard
    // offer): is $15,187.72…" — a verb with no subject. The copy sweeps scan for shame words
    // and assumption clauses, so nothing caught it until a critic was asked to read them aloud.
    const kinds = [
      'unused-subscription',
      'price-increase',
      'insurance-reshop',
      'negotiable-bill',
    ] as const;
    for (const kind of kinds) {
      const o: Opportunity = {
        kind,
        merchant: 'Comcast',
        monthlyCents: cents(2000),
        todayValue10Cents: cents(200_000),
        todayValue20Cents: cents(500_000),
        todayValue30Cents: cents(900_000),
        isEstimate: kind === 'insurance-reshop' || kind === 'negotiable-bill',
      };
      const line = COACH_COPY.opportunity(o, NOMINAL_BPS);
      expect(line, kind).not.toMatch(/[):]\s+is\s/);
      expect(line, kind).toContain('$20.00');
      expect(line, kind).toContain('$9,000.00');
    }
  });

  it('a zero return assumption does not credit compounding with the deposits themselves', () => {
    // At a 0.00% return the figure is the deposits with inflation taken off, so "compounding
    // does the work, not willpower" — the persuasive payload of the sentence — is simply
    // false. Both critics found this branch independently in the first draft.
    const o: Opportunity = {
      kind: 'unused-subscription',
      merchant: 'LA Fitness',
      monthlyCents: cents(3499),
      // W.10a critic: these were 300_000 / 500_000 / 600_000, and the 10-year figure of that
      // fixture ($3,000.00) is BELOW the $4,198.80 a $34.99/mo row hands over in ten years — so
      // the closing assertion here was certifying the defect below rather than the guard above.
      // Real 7.00%/2.50% figures for this row, where nothing trails.
      todayValue10Cents: cents(605_000),
      todayValue20Cents: cents(1_822_000),
      todayValue30Cents: cents(4_267_000),
      isEstimate: false,
    };
    const zero = COACH_COPY.opportunity(o, 0);
    expect(zero).not.toContain('compounding does the work');
    expect(zero).toContain('no growth at all');
    // …and the ordinary branch still says it, so the guard is not a silent deletion.
    expect(COACH_COPY.opportunity(o, NOMINAL_BPS)).toContain('compounding does the work');
  });

  it('will not credit compounding beside a figure at or below the dollars paid in', () => {
    // W.10a critic. #363 recorded that the reader's own 0.00% return dial was "the only
    // degenerate input" for the clause above; W.10a's sweep of the same dial grid disproved it
    // one function away and the row was never revisited. 7.00% return against a 4.00%
    // inflation dial — both inside `validateDials`, and reachable from the DEFAULT return —
    // makes the 10- and 20-year figures land below what the reader hands over while the
    // 30-year one clears it.
    const nominalBps = 700;
    const inflationBps = 400;
    const monthlyCents = cents(5000);
    const o: Opportunity = {
      kind: 'unused-subscription',
      merchant: 'Streamflix',
      monthlyCents,
      todayValue10Cents: opportunityValueTodayCents(monthlyCents, 120, nominalBps, inflationBps),
      todayValue20Cents: opportunityValueTodayCents(monthlyCents, 240, nominalBps, inflationBps),
      todayValue30Cents: opportunityValueTodayCents(monthlyCents, 360, nominalBps, inflationBps),
      isEstimate: false,
    };
    // The hard case is present: two of the three printed figures trail, one does not.
    expect(o.todayValue10Cents).toBeLessThan(monthlyCents * 120);
    expect(o.todayValue20Cents).toBeLessThan(monthlyCents * 240);
    expect(o.todayValue30Cents).toBeGreaterThan(monthlyCents * 360);

    const line = COACH_COPY.opportunity(o, nominalBps);
    expect(line).not.toContain('compounding does the work');
    // The figures and the rate they were grown at are still stated — the payoff is what goes.
    expect(line).toContain('$5,846.49 over 10');
    expect(line).toContain('assuming 7.00% average annual returns.');
    // And the paragraph that renders under the same gate explains it for the list.
    expect(COACH_COPY.opportunityBasis(nominalBps, inflationBps, OWNS_BOTH)).toContain(
      'the shorter horizons land at or below the dollars you would pay in',
    );
  });

  it('the row guard reads the figures it prints, not the dials it was grown at', () => {
    // A recomputation from the rate pair would be a second derivation that can be handed
    // different arguments than the row was built with. This row carries a trailing 30-year
    // figure while the rate argument is the untroubled default, so only a predicate reading
    // the printed values can refuse.
    const monthlyCents = cents(2000);
    const o: Opportunity = {
      kind: 'negotiable-bill',
      merchant: 'Comcast',
      monthlyCents,
      todayValue10Cents: cents(900_000),
      todayValue20Cents: cents(1_800_000),
      todayValue30Cents: cents(720_000), // $7,200.00 against $7,200.00 handed over: the tie
      isEstimate: true,
    };
    expect(o.todayValue30Cents).toBe(monthlyCents * 360);
    expect(opportunityRowTrailsContributions(o)).toBe(true);
    expect(COACH_COPY.opportunity(o, NOMINAL_BPS)).not.toContain('compounding does the work');
    // Both directions: lift the tie by one cent and the clause returns, so the guard is a
    // predicate on the figures rather than a deletion.
    expect(
      opportunityRowTrailsContributions({ ...o, todayValue30Cents: cents(720_001) }),
    ).toBe(false);
    expect(
      COACH_COPY.opportunity({ ...o, todayValue30Cents: cents(720_001) }, NOMINAL_BPS),
    ).toContain('compounding does the work');
  });

  it('the basis line states the mechanism it actually performs', () => {
    const shown = COACH_COPY.opportunityBasis(NOMINAL_BPS, INFLATION_BPS, DEFAULT_RETURN);
    expect(shown).toContain('7.00% return assumption');
    expect(shown).toContain('your 2.50% inflation assumption');
    // It may NOT claim a single blended rate: the code grows at one dial and deflates by the
    // other, and "grown at 4.50% after inflation" would be a stated derivation it never does.
    expect(shown).not.toContain('4.50%');
    expect(shown).not.toContain('after inflation');
    expect(shown).toContain('what the total would buy today');
  });

  it('names the direction its flat-contribution model errs in', () => {
    // The model assumes the reader never raises the amount. That is the conservative reading,
    // and the sentence has to say so, or the printed number quietly becomes a floor presented
    // as an estimate.
    for (const [nom, inf] of [
      [NOMINAL_BPS, INFLATION_BPS],
      [NOMINAL_BPS, 0],
      [500, 600],
    ] as const) {
      const text = COACH_COPY.opportunityBasis(nom, inf, OWNS_BOTH);
      expect(text, `${nom}/${inf}`).toContain('never raise it');
      expect(text, `${nom}/${inf}`).toContain('more than they say');
    }
  });

  it('the two degenerate dial pairs get their own sentence', () => {
    // Zero inflation: nothing is deflated, so claiming a deduction would be false.
    const noInflation = COACH_COPY.opportunityBasis(NOMINAL_BPS, 0, DEFAULT_RETURN);
    expect(noInflation).toContain("today's money and future dollars are the same thing here");
    expect(noInflation).not.toContain('for every year of the horizon');

    // Inflation at or above the return dial: every horizon lands below the dollars paid in.
    // Executed across 10/20/30 years before the sentence was written — at 5.00%/6.00% the
    // ratios are 0.7226 / 0.5340 / 0.4025.
    const outrun = COACH_COPY.opportunityBasis(500, 600, OWNS_BOTH);
    expect(outrun).toContain('every figure lands at or below the dollars you would pay in');
    expect(outrun).toContain('that is the assumptions working, not an error');
    expect(opportunityValueTodayCents(cents(100_000), 360, 500, 600)).toBeLessThan(100_000 * 360);
    expect(opportunityValueTodayCents(cents(100_000), 120, 500, 600)).toBeLessThan(100_000 * 120);

    // …and the ordinary pair does NOT say it, so the branch is a real alternative.
    expect(COACH_COPY.opportunityBasis(NOMINAL_BPS, INFLATION_BPS, DEFAULT_RETURN)).not.toContain(
      'below the dollars you would pay in',
    );
  });

  it('the trailing sentence is gated on the arithmetic, not on a comparison of the dials', () => {
    // The first version fired on `inflation >= return`, which SOUNDS like the same condition.
    // A sweep of every pair the dials permit (return 0-15.00%, inflation 0-10.00%, 25bps steps)
    // found 1,579 horizon-cases where inflation is strictly BELOW the return assumption and the
    // figure still trails what the reader pays in — the annuity's dollars are each invested for
    // less than the full horizon while the deflator runs all of it.
    //
    // 10.25% return against 10.00% inflation is one of them, and the old predicate said nothing.
    expect(1025).toBeGreaterThan(1000);
    expect(opportunityValueTrailsContributions(360, 1025, 1000)).toBe(true);
    expect(COACH_COPY.opportunityBasis(1025, 1000, OWNS_BOTH)).toContain(
      'every figure lands at or below the dollars you would pay in',
    );

    // 149 pairs trail at the short horizons and NOT at 30 years, so "all of them" and "the
    // shorter ones" are two different sentences. 3.25%/1.75% is one (10y and 20y trail, 30y
    // does not) — the mixed branch must not claim every figure.
    expect(opportunityValueTrailsContributions(120, 325, 175)).toBe(true);
    expect(opportunityValueTrailsContributions(240, 325, 175)).toBe(true);
    expect(opportunityValueTrailsContributions(360, 325, 175)).toBe(false);
    const mixed = COACH_COPY.opportunityBasis(325, 175, OWNS_BOTH);
    expect(mixed).toContain('the shorter horizons land at or below the dollars you would pay in');
    expect(mixed).not.toContain('every figure lands at or below');
  });

  it('when the sentence speaks, no row it qualifies exceeds its own contributions', () => {
    // The predicate is amount-independent and the SENTENCE is what has to be true, so this
    // locks the direction the copy claims, over the whole permitted grid and three amounts:
    // where it speaks, no printed figure is greater than the dollars paid in.
    //
    // "at or below" rather than "below" is load-bearing and this is why. The predicate is
    // exact; the display is rounded. At 14.00%/8.00% over 10 years the value trails by
    // 0.0008%, which on a $2.50/mo row is under a cent, so it prints as EXACTLY what was paid
    // in. A "below" claim is false there — found by this sweep, not by reading the sentence.
    let strict = 0;
    for (let r = 0; r <= 1500; r += 100) {
      for (let inf = 0; inf <= 1000; inf += 100) {
        for (const months of [120, 240, 360]) {
          if (!opportunityValueTrailsContributions(months, r, inf)) continue;
          for (const monthly of [cents(250), cents(3499), cents(120_000)]) {
            const value = opportunityValueTodayCents(monthly, months, r, inf);
            expect(value, `${monthly}c ${months}mo r=${r} i=${inf}`).toBeLessThanOrEqual(
              monthly * months,
            );
            if (value < monthly * months) strict++;
          }
        }
      }
    }
    // Non-vacuity: the branch is reached, and overwhelmingly it is strictly below — the tie is
    // the knife-edge case, not the normal one.
    expect(strict).toBeGreaterThan(100);
  });

  it('will not call an unset inflation dial "yours"', () => {
    expect(COACH_COPY.opportunityBasis(NOMINAL_BPS, INFLATION_BPS, DEFAULT_BOTH)).toContain(
      'our default 2.50% inflation assumption',
    );
    expect(COACH_COPY.opportunityBasis(NOMINAL_BPS, INFLATION_BPS, DEFAULT_RETURN)).toContain(
      'your 2.50% inflation assumption',
    );
  });

  it('points at no screen position (the UI-8 rule, in the branch that inherited it)', () => {
    // W.2 retired "the dates above" from `volatilityPrice` for this reason; the first draft of
    // this sentence re-introduced it as "the same footing as the cards above", and the draft
    // after that still opened with the bare demonstrative "Those totals".
    for (const [nom, inf] of [
      [NOMINAL_BPS, INFLATION_BPS],
      [NOMINAL_BPS, 0],
      [500, 600],
    ] as const) {
      const text = COACH_COPY.opportunityBasis(nom, inf, OWNS_BOTH);
      // Not a bare `/above|below/`: a rate legitimately sits below another rate, which is a
      // comparison, not a location. What is banned is a noun on this screen plus a direction.
      expect(text, `${nom}/${inf}`).not.toMatch(
        /\b(?:cards?|dates?|figures?|projections?|totals?|rows?|numbers?|list|sentence)\s+(?:above|below)\b/i,
      );
      expect(text, `${nom}/${inf}`).not.toMatch(/\b(?:above|below|to the right|to the left)\s*[.,]/i);
      // The subject names the thing it qualifies rather than pointing at it.
      expect(text, `${nom}/${inf}`).toContain('The figures in this list');
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// C.9 (#405, audit P0-6) — a short history scales annual spending by the REAL window,
// never ×2: three months of rows used to print an annual figure that was exactly half the
// reader's true spending, halving the FI number, the FI date and the /goals emergency fund.
// ════════════════════════════════════════════════════════════════════════════════════════════
describe('C.9 — annual spending scales by the REAL window (fail-old: expenses6 × 2)', () => {
  const U = `c9-window-${Date.now()}-${process.pid}`;
  // Only the last three COMPLETE months, same per-month money as the 12-month fixture, so the
  // TRUE annual spending is identical ($36,000/yr).
  //
  // K.8 — this block PINS its own "today". The comment that used to sit here claimed the
  // fixture was "stable against the wall clock", and it was false: the engine keeps only
  // complete months BEFORE the current one, so under the gate's default DEMO_TODAY
  // (2026-06-10) the window collapses to one month ('2026-05') and the assertions below
  // read "expected 1 to be 3" — exactly what CI showed on every push while the ambient
  // local clock (past July 2026) kept them green. Any pinned date whose month is at or
  // after 2026-08 makes all three fixture months complete; the pin makes that hold on
  // every machine, forever.
  const SHORT_MONTHS = ['2026-05', '2026-06', '2026-07'];
  const PINNED_TODAY = '2026-08-15';

  beforeAll(async () => {
    vi.stubEnv('DEMO_TODAY', PINNED_TODAY);
    await prisma.user.deleteMany({ where: { id: U } });
    await prisma.user.create({
      data: {
        id: U,
        email: `${U}@test.local`,
        expectedReturnBps: NOMINAL_BPS,
        swrBps: 400,
        inflationBps: INFLATION_BPS,
      },
    });
    const checking = await prisma.account.create({
      data: {
        userId: U,
        provider: 'plaid',
        providerRef: `${U}-checking`,
        name: 'Everyday Checking',
        type: 'CHECKING',
        currency: 'USD',
        currentBalanceCents: 0,
      },
    });
    await prisma.transaction.createMany({
      data: SHORT_MONTHS.flatMap((m) => [
        {
          id: `${U}-inc-${m}`,
          accountId: checking.id,
          date: `${m}-05`,
          amountCents: INCOME_CENTS,
          rawDescriptor: 'PAYROLL',
        },
        {
          id: `${U}-exp-${m}`,
          accountId: checking.id,
          date: `${m}-12`,
          amountCents: -EXPENSE_CENTS,
          rawDescriptor: 'LIVING EXPENSES',
          categoryId: 'groceries',
        },
      ]),
    });
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await prisma.user.deleteMany({ where: { id: U } });
  });

  it('carries the window (3) and prints the true year of spending, not half of it', async () => {
    const d = await getCoachData(U);
    expect(d.fi.monthlySavingsMonths).toBe(3);
    expect(d.fi.monthlySavingsCents).toBe(200_000); // (income − expenses) ÷ 3 — unchanged
    // True annual spending: $3,000/mo × 12 = $36,000 — the SAME as the 12-month reader.
    expect(d.fi.annualExpensesCents).toBe(3_600_000);
    expect(d.fi.fiNumberCents).toBe(90_000_000); // $36,000 ÷ 4%
    // Fail-old pins: the `expenses6 * 2` bug printed $18,000/yr and a $450,000 FI number.
    expect(d.fi.annualExpensesCents).not.toBe(1_800_000);
    expect(d.fi.fiNumberCents).not.toBe(45_000_000);
  });

  it('the FI sentence names the real window and multiplier, never "6 full months × 2"', async () => {
    const d = await getCoachData(U);
    const text = COACH_COPY.fiNumber(
      d.fi.fiNumberCents,
      d.fi.swrBps,
      d.fi.annualExpensesCents,
      d.fi.monthlySavingsMonths,
    );
    expect(text).toContain('your last 3 full months × 4');
    expect(text).not.toContain('6 full months');
  });
});
