/**
 * C.3 — Trends labels shared by the dashboard card and /trends.
 *
 * Locks: the day-count phrase that hid the pace divisor, the zero-delta
 * relation that used to read "on pace for $0.00 less" in green, and the mover
 * window so a July fact cannot sit under an August headline unlabeled.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  baselineLabel,
  moverWindowLabel,
  newMerchantPanelBasis,
  paceAssumption,
  PACE_NO_SPEND_YET,
  paceBillsPhrase,
  paceDaysPhrase,
  paceDeltaRelation,
  shortMonth,
} from '@/lib/engine/trends/labels';
import { BREAKDOWN_BASIS } from '@/lib/engine/glass-box/category-breakdown';

describe('paceDaysPhrase', () => {
  it('names the singular day', () => {
    expect(paceDaysPhrase(1)).toBe('in the first 1 day');
  });

  it('names the plural days — the owner-reported shape', () => {
    expect(paceDaysPhrase(2)).toBe('in the first 2 days');
  });
});

describe('paceDeltaRelation', () => {
  it('higher projection → more', () => {
    expect(paceDeltaRelation(1971385)).toEqual({ absCents: 1971385, relation: 'more' });
  });

  it('lower projection → less', () => {
    expect(paceDeltaRelation(-5000)).toEqual({ absCents: 5000, relation: 'less' });
  });

  it('exact tie is its own relation — not "less" and not green', () => {
    expect(paceDeltaRelation(0)).toEqual({ absCents: 0, relation: 'same' });
  });
});

describe('baselineLabel / moverWindowLabel', () => {
  it('reads a 3-month baseline oldest→newest', () => {
    // Engine order is most-recent-first. formatMonth('short') includes the year.
    expect(baselineLabel(['2026-06', '2026-05', '2026-04'])).toBe("Apr '26–Jun '26");
  });

  it('labels the mover window the way /trends already does', () => {
    expect(moverWindowLabel('2026-07', ['2026-06', '2026-05', '2026-04'])).toBe(
      "Jul '26 vs Apr '26–Jun '26 average",
    );
  });

  it('a gapped baseline must not print as a contiguous range (audit P2)', () => {
    // May had no spend, so the mover baseline skipped it: three months, not four.
    expect(baselineLabel(['2026-06', '2026-04', '2026-03'])).toBe("3 months through Jun '26");
    // Same count the balance-move sentence prints beside the mover list.
    expect(moverWindowLabel('2026-07', ['2026-06', '2026-04', '2026-03'])).toBe(
      "Jul '26 vs 3 months through Jun '26 average",
    );
  });

  it('a contiguous baseline still reads oldest→newest', () => {
    expect(baselineLabel(['2026-06', '2026-05', '2026-04'])).toBe("Apr '26–Jun '26");
  });

  it('refuses a window when there is no compared month', () => {
    expect(moverWindowLabel(null, ['2026-06'])).toBeNull();
  });

  it('shortMonth is formatMonth short', () => {
    expect(shortMonth('2026-08')).toBe("Aug '26");
  });
});

/**
 * C.2 — the assumption sentence has three branches because the projection has
 * three shapes, and each is a different claim about where the number came from.
 * Golden SENTENCES, not `toContain` fragments: a critic swapping two figures
 * into each other's slots passes every fragment assertion (the W.10a lesson).
 */
const COVERAGE =
  'Only bills we can match to a merchant you have spent at are counted here — ' +
  'one charged to a card, paid as a transfer, or that we have not spotted is not.';

describe('paceAssumption', () => {
  it('describes the pure daily rate when no known bill touched the month', () => {
    expect(
      paceAssumption({
        spentSoFarCents: 57879,
        billsStillDueCents: 0,
        discretionarySoFarCents: 57879,
        billsRefusedCount: 0,
      }),
    ).toBe(DAILY_RATE);
  });

  const DAILY_RATE =
    'Assumes spending continues at the current daily rate — a projection, not a prediction.';
  const REFUSED_ZERO =
    'This projection does not add scheduled outflows. ' + DAILY_RATE;

  it('C.21: the refused-all zero is a different sentence from the empty calendar', () => {
    // The engine count selects the branch; the sentence does not print N
    // (cycle 2 P1-2: no surface lists that set). 1 and 3 must be identical.
    expect(
      paceAssumption({
        spentSoFarCents: 57879,
        billsStillDueCents: 0,
        discretionarySoFarCents: 57879,
        billsRefusedCount: 3,
      }),
    ).toBe(REFUSED_ZERO);
    expect(
      paceAssumption({
        spentSoFarCents: 57879,
        billsStillDueCents: 0,
        discretionarySoFarCents: 57879,
        billsRefusedCount: 1,
      }),
    ).toBe(REFUSED_ZERO);
    expect(REFUSED_ZERO.endsWith(DAILY_RATE)).toBe(true);
    expect(REFUSED_ZERO).not.toMatch(/\d/);
    expect(REFUSED_ZERO).not.toContain(' so ');
    expect(REFUSED_ZERO).not.toContain('this month');
    expect(REFUSED_ZERO).not.toContain('as bills');
    expect(REFUSED_ZERO).not.toContain('we have not spotted');
    expect(REFUSED_ZERO).not.toContain(COVERAGE);
  });

  it('names the bills it added, the rate it extrapolated, and what it cannot see', () => {
    expect(
      paceAssumption({
        spentSoFarCents: 57879,
        billsStillDueCents: 620000,
        discretionarySoFarCents: 57879,
        billsRefusedCount: 0,
      }),
    ).toBe(
      'Adds $6,200.00 of bills still due, then assumes the other $578.79 ' +
        'continues at its current daily rate — a projection, not a prediction. ' +
        COVERAGE,
    );
  });

  it('says so when the known bills have already been charged — the rate is the REST', () => {
    // 9,094.00 spent, of which 6,200.00 was the mortgage: a reader who divides
    // spent-so-far by the day count cannot reproduce the projection, so the
    // sentence has to say which figure the rate is taken over.
    expect(
      paceAssumption({
        spentSoFarCents: 909400,
        billsStillDueCents: 0,
        discretionarySoFarCents: 289400,
        billsRefusedCount: 0,
      }),
    ).toBe(
      "Every bill we could match to this month's charges is already counted; the other $2,894.00 " +
        'is what continues at its current daily rate — a projection, not a prediction. ' +
        COVERAGE,
    );
  });

  /**
   * C.2 critic P0 — the branch that says the bills are done may not also imply
   * they were ALL of the bills.
   *
   * Branch B used to open "The bills we can see for this month have already been
   * charged" and carry no coverage clause at all: it was the one branch telling
   * the reader the projection is finished, and the only one that named no
   * limitation. It is false by scope — the engine refuses scheduled rows it can
   * plainly see (an aggregate "Zelle Payment" landlord, a hand-authored label, a
   * transfer-paid obligation), and /calendar renders those same refused rows as
   * bills still due, one click away, off the same array.
   *
   * Both directions are asserted, because a hedge that never appears and a hedge
   * that appears unconditionally are different bugs.
   */
  it('every branch that mentions bills also states what "bills" covers', () => {
    // Branch A — bills still due.
    expect(
      paceAssumption({
        spentSoFarCents: 57879,
        billsStillDueCents: 620000,
        discretionarySoFarCents: 57879,
        billsRefusedCount: 0,
      }),
    ).toContain(COVERAGE);
    // Branch B — bills all charged. The branch the P0 was in.
    expect(
      paceAssumption({
        spentSoFarCents: 909400,
        billsStillDueCents: 0,
        discretionarySoFarCents: 289400,
        billsRefusedCount: 0,
      }),
    ).toContain(COVERAGE);
    // C.21 refused-all — names the refused zero, not a count and not the
    // exclusion list (cycle 2: a qualifier that drops `aggregate` lies).
    const refused = paceAssumption({
      spentSoFarCents: 57879,
      billsStillDueCents: 0,
      discretionarySoFarCents: 57879,
      billsRefusedCount: 3,
    });
    expect(refused).toBe(REFUSED_ZERO);
    expect(refused).not.toContain(COVERAGE);
    expect(refused).not.toContain('we have not spotted');
    // True no-bills mentions no bills, so it makes no claim to qualify. A
    // coverage clause here would assert the app looked and found none.
    expect(
      paceAssumption({
        spentSoFarCents: 57879,
        billsStillDueCents: 0,
        discretionarySoFarCents: 57879,
        billsRefusedCount: 0,
      }),
    ).not.toContain(COVERAGE);
  });

  /**
   * The old clause was an ENUMERATION of exclusions, which is a claim to be
   * complete beside a money figure. Pin that it does not come back: this string
   * is only reachable by re-listing the excluded classes, and the list will be
   * wrong again the moment a refusal is added.
   */
  it('does not enumerate exclusions — an exclusion list beside a figure claims to be whole', () => {
    const all = [
      paceAssumption({
        spentSoFarCents: 57879,
        billsStillDueCents: 620000,
        discretionarySoFarCents: 57879,
        billsRefusedCount: 0,
      }),
      paceAssumption({
        spentSoFarCents: 909400,
        billsStillDueCents: 0,
        discretionarySoFarCents: 289400,
        billsRefusedCount: 0,
      }),
      paceAssumption({
        spentSoFarCents: 57879,
        billsStillDueCents: 0,
        discretionarySoFarCents: 57879,
        billsRefusedCount: 0,
      }),
      paceAssumption({
        spentSoFarCents: 57879,
        billsStillDueCents: 0,
        discretionarySoFarCents: 57879,
        billsRefusedCount: 3,
      }),
    ].join(' ');
    expect(all).not.toContain('are not in that');
    expect(all).not.toContain('we can see');
  });
});

describe('paceBillsPhrase', () => {
  const bill = (merchant: string, amountCents: number) => ({ merchant, amountCents });

  it('returns null when the projection added no bills — an empty list is not a fact', () => {
    expect(paceBillsPhrase({ billsStillDueCents: 0, billsStillDue: [] })).toBeNull();
  });

  it('names one bill', () => {
    expect(
      paceBillsPhrase({ billsStillDueCents: 620000, billsStillDue: [bill('Mr Cooper', 620000)] }),
    ).toBe('$6,200.00 of bill still due: Mr Cooper');
  });

  it('names two with "and"', () => {
    expect(
      paceBillsPhrase({
        billsStillDueCents: 628500,
        billsStillDue: [bill('Mr Cooper', 620000), bill('City Water', 8500)],
      }),
    ).toBe('$6,285.00 of bills still due: Mr Cooper and City Water');
  });

  it('counts the rest rather than listing them', () => {
    expect(
      paceBillsPhrase({
        billsStillDueCents: 634500,
        billsStillDue: [
          bill('Mr Cooper', 620000),
          bill('City Water', 8500),
          bill('Verizon', 4000),
          bill('Netflix', 2000),
        ],
      }),
    ).toBe('$6,345.00 of bills still due: Mr Cooper, City Water and 2 more');
  });
});

describe('PACE_NO_SPEND_YET (C.1)', () => {
  it('names what the app can prove — counted, never "you spent nothing"', () => {
    expect(PACE_NO_SPEND_YET).toBe(
      'No spending counted yet this month — there is no daily rate to project from.',
    );
    expect(PACE_NO_SPEND_YET).not.toMatch(/you (have not|haven't|didn't)/i);
  });

  /**
   * Both surfaces render this sentence, and the dashboard card is where the
   * drift started: it carried its own "Not enough activity yet to spot trends",
   * which C.1 makes false on the first days of most months because the
   * biggest-change row beneath it keeps rendering completed-month facts. One
   * author for the sentence, and the two surfaces locked against each other.
   */
  it('is the single author of the abstention copy on both surfaces', () => {
    const files = [
      'src/components/finance/spending-insights-card.tsx',
      'src/components/finance/trends-view.tsx',
    ];
    for (const f of files) {
      const src = readFileSync(join(process.cwd(), f), 'utf8');
      expect(src, `${f} must render the shared constant`).toContain('PACE_NO_SPEND_YET');
      expect(src, `${f} must not hard-code its own abstention sentence`).not.toContain(
        'Not enough activity yet',
      );
    }
  });

  /**
   * C.2 critic P1-4 — the same scan for the TIE sentence, which was hand-copied
   * on both surfaces while only the helper deciding the branch was shared. The
   * decision was never the part that drifts; the words are.
   */
  it('is the single author of the pace assumption on both surfaces', () => {
    const files = [
      'src/components/finance/spending-insights-card.tsx',
      'src/components/finance/trends-view.tsx',
    ];
    for (const f of files) {
      const src = readFileSync(join(process.cwd(), f), 'utf8');
      expect(src, `${f} must render the shared composer`).toContain('paceAssumption');
    }
  });

  it('is the single author of the tie copy on both surfaces', () => {
    const files = [
      'src/components/finance/spending-insights-card.tsx',
      'src/components/finance/trends-view.tsx',
    ];
    for (const f of files) {
      const src = readFileSync(join(process.cwd(), f), 'utf8');
      expect(src, `${f} must render the shared constant`).toContain('PACE_DELTA_SAME');
      expect(src, `${f} must not hard-code the tie sentence`).not.toContain(
        'on pace with last month',
      );
    }
  });
});

/**
 * O.18e — the new-merchant panel's basis, composed HERE with the RENDERED
 * figure and date embedded (the O.18c contract): a sentence built from strings
 * the surface already prints cannot disagree with the row it describes, and an
 * e2e asserting the full sentence fails the moment the row's money moves.
 */
describe('newMerchantPanelBasis (O.18e)', () => {
  it('names the figure, the month, and the through-date the figure stops at', () => {
    expect(
      newMerchantPanelBasis({
        figure: '$80.00',
        monthLabel: "Jun '26",
        throughLabel: 'Wed, Jun 10, 2026',
        futureDatedCents: 0,
        countedOnHandoverDays: 0,
        statesATally: true,
      }),
    ).toEqual([
      "The $80.00 above is this merchant's spending in Jun '26 through Wed, Jun 10, 2026.",
      BREAKDOWN_BASIS,
    ]);
  });

  it('adds the C.26 not-counted-yet sentence ONLY when future-dated money exists', () => {
    const withFuture = newMerchantPanelBasis({
      figure: '$80.00',
      monthLabel: "Jun '26",
      throughLabel: 'Wed, Jun 10, 2026',
      futureDatedCents: 4000,
      countedOnHandoverDays: 0,
      statesATally: true,
    });
    expect(withFuture).toHaveLength(3);
    expect(withFuture[1]).toBe(
      "$40.00 here is dated after today and isn't counted yet — this figure covers spending through today.",
    );
    const without = newMerchantPanelBasis({
      figure: '$80.00',
      monthLabel: "Jun '26",
      throughLabel: 'Wed, Jun 10, 2026',
      futureDatedCents: 0,
      countedOnHandoverDays: 0,
      statesATally: true,
    });
    expect(without).toHaveLength(2);
  });

  it('a zero or negative future figure is never disclosed (the engine floors upstream)', () => {
    for (const futureDatedCents of [0, -400]) {
      expect(
        newMerchantPanelBasis({
          figure: '$80.00',
          monthLabel: "Jun '26",
          throughLabel: 'Wed, Jun 10, 2026',
          futureDatedCents,
          countedOnHandoverDays: 0,
          statesATally: true,
        }),
      ).toHaveLength(2);
    }
  });

  /**
   * A rule in a .tsx cannot be locked — the basis must be COMPOSED here and
   * rendered on the page, and a local sentence pasted into the view is exactly
   * how two surfaces drift (the CALC_AUDIT lesson this module exists to hold).
   */
  it('trends-view renders the composer, never a local basis sentence', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/finance/trends-view.tsx'), 'utf8');
    expect(src).toContain('newMerchantPanelBasis');
    expect(src).not.toContain("is this merchant's spending in");
    expect(src).not.toContain("isn't counted yet");
  });
});
