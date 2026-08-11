/**
 * Monthly Money Review candidate-set + selection (AI plan §2.4).
 * Hand-verified values live in docs/EDGE_CASES.md §Monthly-Money-Review.
 *
 * The load-bearing safety properties under test:
 *  - A1  every candidate id is in the closed set; only the cover-transfer is `material`.
 *  - A2  the deterministic floor reproduces generateMoneyReview byte-for-byte.
 *  - A3  a material action is ALWAYS present, even when the LLM order omits it.
 *  - A4  the LLM order is closed-set-validated — unknown ids never fabricate an entry.
 *  - A5  degenerate inputs yield an honest minimal recap (no fabricated positive/shame).
 *  - A6  every rendered line is a COACH_COPY string built from engine numbers.
 */

import { describe, it, expect } from 'vitest';
import { cents } from '@/lib/money';
import type { MonthlyFlow, CreepResult, Opportunity, OpportunityKind } from '@/lib/engine/fi/insights';
import { generateMoneyReview } from '@/lib/engine/fi/coach-copy';
import { computeSavingsStreak } from '@/lib/engine/fi/savings-streak';
import {
  buildReviewCandidates,
  selectReview,
  parseReviewOrder,
  REVIEW_CANDIDATE_IDS,
  type ReviewCandidateInput,
} from '@/lib/engine/fi/money-review';

// ── fixtures ─────────────────────────────────────────────────────────────────
// Audit P2 / critic F1: the recap's streak + personal-best come from the SAME
// full-history helper the savings-rate card uses, passed in — never re-derived
// from the chart slice. Fixtures derive it from their own flows (the full
// history in these tests); the slice-vs-history divergence is pinned separately
// (the full-history test below).
const streakOf = (flows: MonthlyFlow[]) => computeSavingsStreak(flows);
const flow = (month: string, incomeCents: number, expensesCents: number, savingsRateBps: number | null): MonthlyFlow => ({
  month,
  incomeCents: cents(incomeCents),
  expensesCents: cents(expensesCents),
  savingsRateBps,
});

/**
 * O.20g — the fixture defaults to a MEASURED window (both sides comparable), so
 * every pre-existing case keeps asserting what it always asserted. The
 * unmeasured states are opted into explicitly by the tests that are about them.
 */
const creepOf = (
  flagged: boolean,
  spendGrowthBps = 0,
  incomeGrowthBps = 0,
  windowMonths = 6,
  measured: { incomeMeasured?: boolean; spendMeasured?: boolean } = {},
): CreepResult => ({
  flagged,
  spendGrowthBps,
  incomeGrowthBps,
  incomeMeasured: measured.incomeMeasured ?? true,
  spendMeasured: measured.spendMeasured ?? true,
  incomeBaselineCents: cents(500_000),
  discretionaryBaselineCents: cents(120_000),
  monthlyDiscretionaryCents: [],
  windowMonths,
  loanPaymentsExcluded: false,
});

const oppOf = (kind: OpportunityKind, merchant: string, monthlyCents: number): Opportunity => ({
  kind,
  merchant,
  monthlyCents: cents(monthlyCents),
  todayValue10Cents: cents(monthlyCents * 100),
  todayValue20Cents: cents(monthlyCents * 300),
  todayValue30Cents: cents(monthlyCents * 700),
  isEstimate: false,
});

const NO_CREEP = creepOf(false);

const rateUpFlows = [flow('2026-04', 800000, 600000, 2500), flow('2026-05', 800000, 500000, 3750)];
const rateDownFlows = [flow('2026-04', 800000, 500000, 3750), flow('2026-05', 800000, 700000, 1250)];
const quietFlows = [flow('2026-04', 800000, 600000, 2500), flow('2026-05', 800000, 600000, 2500)];

// Representative inputs spanning the branch matrix of generateMoneyReview.
const INPUTS: Record<string, ReviewCandidateInput> = {
  rateUpTransfer: {
    flows: [flow('2026-04', 800000, 600000, 2500), flow('2026-05', 800000, 500000, 3750)],
    streak: streakOf(rateUpFlows),
    creep: NO_CREEP,
    opportunities: [oppOf('price-increase', 'Netflix', 300)],
    runwayMonths: 5,
    pendingTransfer: { amountCents: cents(42000), byDate: '2026-06-14', frozenFunding: null },
  },
  rateDownCreepUnused: {
    flows: rateDownFlows,
    streak: streakOf(rateDownFlows),
    creep: creepOf(true, 1800, 200),
    opportunities: [oppOf('unused-subscription', 'Peloton', 4400)],
    runwayMonths: 3,
    pendingTransfer: null,
  },
  quietClearAutomate: {
    flows: quietFlows,
    streak: streakOf(quietFlows),
    creep: NO_CREEP,
    opportunities: [],
    runwayMonths: 8,
    pendingTransfer: null,
  },
  // O.20g — the window the app cannot compare. In the INPUTS matrix so the A2
  // byte-for-byte loop below covers it: the first cut of that slice added the
  // `watch-creep-not-comparable` id and left `selectDeterministic`'s watch chain
  // alone, so the floor dropped the watch role entirely and the recap silently
  // shrank to two lines while `generateMoneyReview` still emitted three.
  creepNotComparable: {
    flows: quietFlows,
    streak: streakOf(quietFlows),
    creep: creepOf(false, 1240, 0, 6, { incomeMeasured: false }),
    opportunities: [],
    runwayMonths: 8,
    pendingTransfer: null,
  },
};

describe('buildReviewCandidates — closed set & grounding (A1, A6)', () => {
  it('every candidate carries an in-set id and a non-empty COACH_COPY line', () => {
    for (const input of Object.values(INPUTS)) {
      const candidates = buildReviewCandidates(input);
      expect(candidates.length).toBeGreaterThan(0);
      for (const c of candidates) {
        expect(REVIEW_CANDIDATE_IDS).toContain(c.id);
        expect(typeof c.line).toBe('string');
        expect(c.line.length).toBeGreaterThan(0);
      }
    }
  });

  it('only the cover-transfer is material, and only when a pending transfer exists', () => {
    const withTransfer = buildReviewCandidates(INPUTS.rateUpTransfer);
    const materials = withTransfer.filter((c) => c.material);
    expect(materials.map((c) => c.id)).toEqual(['action-transfer']);

    const noTransfer = buildReviewCandidates(INPUTS.quietClearAutomate);
    expect(noTransfer.some((c) => c.material)).toBe(false);
  });

  it('every candidate id is unique within a build', () => {
    for (const input of Object.values(INPUTS)) {
      const ids = buildReviewCandidates(input).map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe('deterministic floor reproduces generateMoneyReview byte-for-byte (A2, A9)', () => {
  for (const [name, input] of Object.entries(INPUTS)) {
    it(`matches for ${name}`, () => {
      const review = generateMoneyReview({
        flows: [...input.flows],
        creep: input.creep,
        opportunities: [...input.opportunities],
        runwayMonths: input.runwayMonths,
        pendingTransfer: input.pendingTransfer ?? null,
      });
      const lines = selectReview(buildReviewCandidates(input), null).map((c) => c.line);
      expect(lines).toEqual([review.improvement, review.creep, review.nextAction]);
    });
  }

  it('picks improvement-savings-rate on an up month and improvement-runway on a down month', () => {
    const up = selectReview(buildReviewCandidates(INPUTS.rateUpTransfer), null);
    expect(up[0].id).toBe('improvement-savings-rate');

    const down = selectReview(buildReviewCandidates(INPUTS.rateDownCreepUnused), null);
    expect(down[0].id).toBe('improvement-runway');
  });

  it('deterministic watch = price-increase ?? creep ?? not-comparable ?? clear', () => {
    expect(selectReview(buildReviewCandidates(INPUTS.rateUpTransfer), null)[1].id).toBe('watch-price-increase');
    expect(selectReview(buildReviewCandidates(INPUTS.rateDownCreepUnused), null)[1].id).toBe('watch-creep');
    expect(selectReview(buildReviewCandidates(INPUTS.quietClearAutomate), null)[1].id).toBe('watch-clear');
    expect(selectReview(buildReviewCandidates(INPUTS.creepNotComparable), null)[1].id).toBe(
      'watch-creep-not-comparable',
    );
  });

  it('O.20g — an unmeasurable window keeps its watch line, and it is not the all-clear', () => {
    const candidates = buildReviewCandidates(INPUTS.creepNotComparable);
    const ids = candidates.map((c) => c.id);
    expect(ids).toContain('watch-creep-not-comparable');
    // `watch-clear` carries "no lifestyle drift detected" — a claim this state
    // cannot make — so it must be SUPPRESSED, not merely outranked.
    expect(ids).not.toContain('watch-clear');
    expect(ids).not.toContain('watch-creep');
    // The floor must still return all three roles. It returned two before the
    // chain was widened, which is invisible to every other assertion here.
    const floor = selectReview(candidates, null);
    expect(floor).toHaveLength(3);
    expect(floor.map((c) => c.role)).toEqual(['improvement', 'watch', 'action']);
    expect(floor[1].line).toContain("What we can't tell yet");
    expect(floor[1].line).not.toContain('no lifestyle drift detected');
    // …and the LLM path backfills from the floor, so it recovers the line too.
    const viaModel = selectReview(candidates, ['improvement-runway', 'action-automate']);
    expect(viaModel.map((c) => c.id)).toContain('watch-creep-not-comparable');
  });

  it('every id in the frozen set is producible by some input (a dead id is invisible otherwise)', () => {
    // The reverse of A1. Without it, an id can be added to the closed set,
    // never emitted, and never selected — exactly how the dropped watch role
    // survived a green gate.
    const produced = new Set(
      Object.values(INPUTS).flatMap((i) => buildReviewCandidates(i).map((c) => c.id)),
    );
    // Not every id is reachable from this matrix (the streak/personal-best pair
    // needs its own flows), so pin the ones that ARE and name the rest.
    for (const id of ['watch-price-increase', 'watch-creep', 'watch-creep-not-comparable', 'watch-clear'] as const) {
      expect(produced, `${id} is in REVIEW_CANDIDATE_IDS but no INPUT produces it`).toContain(id);
    }
  });

  it('deterministic action = transfer ?? cancel-sub ?? automate', () => {
    expect(selectReview(buildReviewCandidates(INPUTS.rateUpTransfer), null)[2].id).toBe('action-transfer');
    expect(selectReview(buildReviewCandidates(INPUTS.rateDownCreepUnused), null)[2].id).toBe('action-cancel-sub');
    expect(selectReview(buildReviewCandidates(INPUTS.quietClearAutomate), null)[2].id).toBe('action-automate');
  });
});

describe('material pin — the cash-needed action is never dropped (A3)', () => {
  it('is appended when the LLM order omits it', () => {
    const candidates = buildReviewCandidates(INPUTS.rateUpTransfer);
    const chosen = selectReview(candidates, ['improvement-savings-rate', 'watch-price-increase']);
    expect(chosen.some((c) => c.id === 'action-transfer')).toBe(true);
  });

  it('survives truncation to max even when listed last', () => {
    const candidates = buildReviewCandidates(INPUTS.rateUpTransfer);
    const chosen = selectReview(
      candidates,
      ['improvement-savings-rate', 'improvement-runway', 'watch-price-increase', 'action-transfer'],
      { max: 2 },
    );
    expect(chosen.length).toBe(2);
    expect(chosen.some((c) => c.id === 'action-transfer')).toBe(true);
  });
});

describe('LLM order is closed-set-validated (A4)', () => {
  it('drops unknown ids and duplicates, then backfills the floor (never fabricates an entry)', () => {
    const candidates = buildReviewCandidates(INPUTS.quietClearAutomate);
    const chosen = selectReview(candidates, [
      'totally-made-up',
      'improvement-runway',
      'improvement-runway',
      'watch-clear',
    ]);
    // The two valid listed ids lead; the untouched action role is backfilled from the floor
    // so the recap is never poorer than the deterministic baseline.
    expect(chosen.map((c) => c.id)).toEqual(['improvement-runway', 'watch-clear', 'action-automate']);
    const builtIds = new Set(candidates.map((c) => c.id));
    for (const c of chosen) expect(builtIds.has(c.id)).toBe(true);
  });

  it('respects LLM role ordering for the ids it lists, backfilling the rest', () => {
    const candidates = buildReviewCandidates(INPUTS.rateDownCreepUnused);
    const chosen = selectReview(candidates, ['action-cancel-sub', 'watch-creep'], { max: 3 });
    // LLM-led roles first (action, watch), then the improvement role backfilled from the floor.
    expect(chosen.map((c) => c.id)).toEqual(['action-cancel-sub', 'watch-creep', 'improvement-runway']);
  });

  it('a valid-vocabulary reply naming an absent id can never shrink the recap below the floor (P1-2)', () => {
    // quietClearAutomate has NO material candidate; the model names an in-vocabulary id that
    // is NOT among the built candidates. Old behaviour returned []; now it backfills the floor.
    const candidates = buildReviewCandidates(INPUTS.quietClearAutomate);
    const floor = selectReview(candidates, null).map((c) => c.id);
    const chosen = selectReview(candidates, ['action-transfer']); // not present (no pending transfer)
    expect(chosen.length).toBe(3);
    expect(chosen.map((c) => c.id)).toEqual(floor);
    // An empty array likewise falls back to the full floor, never an empty recap.
    expect(selectReview(candidates, []).map((c) => c.id)).toEqual(floor);
  });

  it('parseReviewOrder keeps only in-set ids, else null', () => {
    expect(parseReviewOrder(['bogus', 'improvement-runway', 'watch-creep'])).toEqual([
      'improvement-runway',
      'watch-creep',
    ]);
    expect(parseReviewOrder('not-an-array')).toBeNull();
    expect(parseReviewOrder([])).toBeNull();
    expect(parseReviewOrder(['bogus', 42, null])).toBeNull();
  });
});

describe('richer pool exposes streak & personal-best for the LLM only (not the floor)', () => {
  it('builds streak and personal-best candidates when the data supports them', () => {
    // Three ascending months, each a new positive-rate high → streak 3 and a personal best.
    const full = [flow('2026-03', 800000, 700000, 1250), flow('2026-04', 800000, 650000, 1875), flow('2026-05', 800000, 500000, 3750)];
    const input: ReviewCandidateInput = {
      flows: full,
      streak: streakOf(full),
      creep: NO_CREEP,
      opportunities: [],
      runwayMonths: 6,
      pendingTransfer: null,
    };
    const ids = buildReviewCandidates(input).map((c) => c.id);
    expect(ids).toContain('improvement-streak');
    expect(ids).toContain('improvement-personal-best');
    // But the deterministic floor still leads with the plain rate-up line, unchanged from today.
    expect(selectReview(buildReviewCandidates(input), null)[0].id).toBe('improvement-savings-rate');
  });

  it('does not award a personal-best when the last month is not the strict high', () => {
    // 37.5% → 12.5%: still positive (so a 2-month streak is real and honest), but NOT a best.
    const ids = buildReviewCandidates(INPUTS.rateDownCreepUnused).map((c) => c.id);
    expect(ids).toContain('improvement-streak');
    expect(ids).not.toContain('improvement-personal-best');
  });

  it('does not fabricate a streak when the latest month is non-positive', () => {
    const full = [flow('2026-04', 800000, 500000, 3750), flow('2026-05', 800000, 900000, -1250)];
    const input: ReviewCandidateInput = {
      flows: full,
      streak: streakOf(full),
      creep: NO_CREEP,
      opportunities: [],
      runwayMonths: 2,
      pendingTransfer: null,
    };
    const ids = buildReviewCandidates(input).map((c) => c.id);
    expect(ids).not.toContain('improvement-streak');
    expect(ids).not.toContain('improvement-personal-best');
  });

  it('a single measurable month is a personal best "so far" — the unified full-history helper', () => {
    // The recap no longer keeps a stricter private gate: the streak comes from the
    // SAME helper the savings-rate card uses (critic F1 — one basis, never a
    // re-derived slice claim). The card ships "X is a personal best so far" for a
    // first measurable month (prior best null); "so far" is the literal truth, so
    // the recap now agrees instead of abstaining (old P2-5 gate, superseded by
    // the F1 unification in DECISIONS #435).
    const full = [flow('2026-04', 0, 500000, null), flow('2026-05', 800000, 500000, 3750)];
    const input: ReviewCandidateInput = {
      flows: full,
      streak: streakOf(full),
      creep: NO_CREEP,
      opportunities: [],
      runwayMonths: 4,
      pendingTransfer: null,
    };
    expect(buildReviewCandidates(input).map((c) => c.id)).toContain('improvement-personal-best');
  });

  it('a full-history best older than the slice suppresses the personal-best candidate (critic F1)', () => {
    // The 12-month chart slice shows a rate-up (3750 > 2500) — but the FULL
    // history holds a better month (5000 in 2026-02), so "personal best so far"
    // over the slice would be false. The passed-in full-history streak must
    // suppress the candidate. The streak itself (2 trailing positives) is still
    // honest and stays.
    const slice = [
      flow('2026-03', 800000, 550000, 2500),
      flow('2026-04', 800000, 550000, 2500),
      flow('2026-05', 800000, 500000, 3750),
    ];
    const fullHistory = [flow('2026-02', 800000, 400000, 5000), ...slice];
    const input: ReviewCandidateInput = {
      flows: slice,
      streak: streakOf(fullHistory),
      creep: NO_CREEP,
      opportunities: [],
      runwayMonths: 6,
      pendingTransfer: null,
    };
    const ids = buildReviewCandidates(input).map((c) => c.id);
    expect(ids).toContain('improvement-savings-rate'); // the slice's rate-up is real
    expect(ids).not.toContain('improvement-personal-best'); // but the old month beats it
    expect(ids).toContain('improvement-streak'); // trailing positives are a full-history fact
  });
});

describe('degenerate inputs yield an honest minimal recap (A5)', () => {
  it('empty flows fall back to runway / clear / automate with no fabricated positive', () => {
    const input: ReviewCandidateInput = {
      flows: [],
      streak: streakOf([]),
      creep: NO_CREEP,
      opportunities: [],
      runwayMonths: 0,
      pendingTransfer: null,
    };
    const candidates = buildReviewCandidates(input);
    const ids = candidates.map((c) => c.id);
    expect(ids).not.toContain('improvement-savings-rate');
    expect(ids).not.toContain('improvement-personal-best');
    expect(ids).not.toContain('improvement-streak');
    const chosen = selectReview(candidates, null);
    expect(chosen.map((c) => c.id)).toEqual(['improvement-runway', 'watch-clear', 'action-automate']);
  });
});
