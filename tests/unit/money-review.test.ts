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
import {
  buildReviewCandidates,
  selectReview,
  parseReviewOrder,
  REVIEW_CANDIDATE_IDS,
  type ReviewCandidateInput,
} from '@/lib/engine/fi/money-review';

// ── fixtures ─────────────────────────────────────────────────────────────────
const flow = (month: string, incomeCents: number, expensesCents: number, savingsRateBps: number | null): MonthlyFlow => ({
  month,
  incomeCents: cents(incomeCents),
  expensesCents: cents(expensesCents),
  savingsRateBps,
});

const creepOf = (flagged: boolean, spendGrowthBps = 0, incomeGrowthBps = 0, windowMonths = 6): CreepResult => ({
  flagged,
  spendGrowthBps,
  incomeGrowthBps,
  monthlyDiscretionaryCents: [],
  windowMonths,
});

const oppOf = (kind: OpportunityKind, merchant: string, monthlyCents: number): Opportunity => ({
  kind,
  merchant,
  monthlyCents: cents(monthlyCents),
  fv10Cents: cents(monthlyCents * 100),
  fv20Cents: cents(monthlyCents * 300),
  fv30Cents: cents(monthlyCents * 700),
  isEstimate: false,
});

const NO_CREEP = creepOf(false);

// Representative inputs spanning the branch matrix of generateMoneyReview.
const INPUTS: Record<string, ReviewCandidateInput> = {
  rateUpTransfer: {
    flows: [flow('2026-04', 800000, 600000, 2500), flow('2026-05', 800000, 500000, 3750)],
    creep: NO_CREEP,
    opportunities: [oppOf('price-increase', 'Netflix', 300)],
    runwayMonths: 5,
    pendingTransfer: { amountCents: cents(42000), byDate: '2026-06-14' },
  },
  rateDownCreepUnused: {
    flows: [flow('2026-04', 800000, 500000, 3750), flow('2026-05', 800000, 700000, 1250)],
    creep: creepOf(true, 1800, 200),
    opportunities: [oppOf('unused-subscription', 'Peloton', 4400)],
    runwayMonths: 3,
    pendingTransfer: null,
  },
  quietClearAutomate: {
    flows: [flow('2026-04', 800000, 600000, 2500), flow('2026-05', 800000, 600000, 2500)],
    creep: NO_CREEP,
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

  it('deterministic watch = price-increase ?? creep ?? clear', () => {
    expect(selectReview(buildReviewCandidates(INPUTS.rateUpTransfer), null)[1].id).toBe('watch-price-increase');
    expect(selectReview(buildReviewCandidates(INPUTS.rateDownCreepUnused), null)[1].id).toBe('watch-creep');
    expect(selectReview(buildReviewCandidates(INPUTS.quietClearAutomate), null)[1].id).toBe('watch-clear');
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
    const input: ReviewCandidateInput = {
      flows: [flow('2026-03', 800000, 700000, 1250), flow('2026-04', 800000, 650000, 1875), flow('2026-05', 800000, 500000, 3750)],
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
    const input: ReviewCandidateInput = {
      flows: [flow('2026-04', 800000, 500000, 3750), flow('2026-05', 800000, 900000, -1250)],
      creep: NO_CREEP,
      opportunities: [],
      runwayMonths: 2,
      pendingTransfer: null,
    };
    const ids = buildReviewCandidates(input).map((c) => c.id);
    expect(ids).not.toContain('improvement-streak');
    expect(ids).not.toContain('improvement-personal-best');
  });

  it('does not award a personal-best when there is no PRIOR month with a real rate (P2-5)', () => {
    // Only one measurable month (the prior is null) → "best so far" would be a fabricated
    // achievement, so it must not appear.
    const input: ReviewCandidateInput = {
      flows: [flow('2026-04', 0, 500000, null), flow('2026-05', 800000, 500000, 3750)],
      creep: NO_CREEP,
      opportunities: [],
      runwayMonths: 4,
      pendingTransfer: null,
    };
    expect(buildReviewCandidates(input).map((c) => c.id)).not.toContain('improvement-personal-best');
  });
});

describe('degenerate inputs yield an honest minimal recap (A5)', () => {
  it('empty flows fall back to runway / clear / automate with no fabricated positive', () => {
    const input: ReviewCandidateInput = {
      flows: [],
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
