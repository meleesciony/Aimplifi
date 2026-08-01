/**
 * Balance-Move Explainer (AI plan §2.3, DECISIONS #240) — the tests ARE the spec.
 *
 * The LLM emits a TEMPLATE of ATOMIC placeholders ({primary}/{second} each fuse a
 * label to its own figure) + purely ADDITIVE connectives; the engine substitutes.
 * The safety battery is two-layered:
 *   - `validateTemplate` enforces the closed grammar (fixed order primary→second→
 *     window, {window} required, additive connectives only, no literal numbers).
 *   - `validateSentence` re-scans the SUBSTITUTED sentence AND the deterministic
 *     fallback (labels are user free text). Adversarial cases are the MAJORITY and
 *     include every bypass three fresh-context hostile-critic cycles found.
 * Hand-verified values live in docs/EDGE_CASES.md §Balance-Move.
 */
import { describe, expect, it } from 'vitest';
import type { CategoryMover, SpendingTrends } from '@/lib/engine/trends/trends';
import {
  buildMovePrompt,
  explainBalanceMove,
  resolveMoveSentence,
  validateSentence,
  validateTemplate,
  type BalanceMoveExplanation,
} from '@/lib/engine/trends/balance-move';

// ── fixtures ─────────────────────────────────────────────────────────────────
const mover = (o: Partial<CategoryMover> & Pick<CategoryMover, 'categoryId' | 'name'>): CategoryMover => ({
  group: 'Food', currentCents: 0, baselineCents: 0, deltaCents: 0, pctChange: null, direction: 'up', ...o,
});
const trendsWith = (movers: CategoryMover[], baselineMonths = ['2026-04', '2026-05', '2026-06']): SpendingTrends => ({
  asOfYm: '2026-07', comparedYm: '2026-06', baselineMonths, pace: null, movers, largest: [], newMerchants: [],
  moverTotal: movers.length, newMerchantTotal: 0,
});
const DINING = mover({ categoryId: 'dining', name: 'Dining', currentCents: 84000, baselineCents: 60000, deltaCents: 24000, pctChange: 0.4, direction: 'up' });
const GAS = mover({ categoryId: 'gas', name: 'Gas', group: 'Transport', currentCents: 24000, baselineCents: 30000, deltaCents: -6000, pctChange: -0.2, direction: 'down' });
const TRAVEL_NEW = mover({ categoryId: 'travel', name: 'Travel', currentCents: 50000, baselineCents: 0, deltaCents: 50000, pctChange: null, direction: 'new' });

const sentenceInput = (e: BalanceMoveExplanation) => ({
  allowedNumberStrings: e.allowedNumberStrings,
  allowedLabelTokens: e.allowedLabelTokens,
  comparisonWindowText: e.comparisonWindowText,
});

// ── explainBalanceMove: reshaping (known-answer) ─────────────────────────────
describe('explainBalanceMove — reshaping', () => {
  it('reshapes movers into atomic, direction-bound factors with engine-derived money', () => {
    const e = explainBalanceMove(trendsWith([DINING, GAS]));
    expect(e.triggered).toBe(true);
    expect(e.primaryDriverId).toBe('dining');
    expect(e.factors[0]).toMatchObject({
      id: 'dining', label: 'Dining', direction: 'up', deltaCents: 24000,
      formattedAbs: '$240.00', formattedSigned: '+$240.00', formattedPct: '+40%',
      deltaPhrase: 'up $240.00', phrase: 'Dining, up $240.00 (+40%)',
    });
    expect(e.factors[1]).toMatchObject({ id: 'gas', phrase: 'Gas, down $60.00 (-20%)' });
  });

  it('caps factors at 3 and preserves the engine order (never re-sorts)', () => {
    const many = ['a', 'b', 'c', 'd'].map((id, i) => mover({ categoryId: id, name: id.toUpperCase(), deltaCents: (4 - i) * 10000, currentCents: (4 - i) * 10000 }));
    const e = explainBalanceMove(trendsWith(many));
    expect(e.factors).toHaveLength(3);
    expect(e.primaryDriverId).toBe('a');
  });

  it('a "new" factor carries no percent and a "new at" atom', () => {
    const f = explainBalanceMove(trendsWith([TRAVEL_NEW])).factors[0];
    expect(f.formattedPct).toBeNull();
    expect(f.phrase).toBe('Travel, new at $500.00');
  });

  it('omits the percent at the ±0 rounding edge (no "+0%"/negative-zero) [critic P2-7]', () => {
    const tiny = mover({ categoryId: 't', name: 'T', currentCents: 20100, baselineCents: 20000, deltaCents: 100, pctChange: 0.004, direction: 'up' });
    expect(explainBalanceMove(trendsWith([tiny])).factors[0].formattedPct).toBeNull();
  });

  it('is not triggered when nothing moved', () => {
    const e = explainBalanceMove(trendsWith([]));
    expect(e.triggered).toBe(false);
    expect(e.primaryDriverId).toBeNull();
    expect(e.deterministicSentence).toBe('');
  });

  it('states the comparison window inline from the baseline count', () => {
    expect(explainBalanceMove(trendsWith([DINING])).comparisonWindowText).toBe('your 3-month average');
    expect(explainBalanceMove(trendsWith([DINING], ['2026-06'])).comparisonWindowText).toBe('your 1-month average');
    expect(explainBalanceMove(trendsWith([DINING], [])).comparisonWindowText).toBe('your earlier months');
  });
});

// ── the deterministic sentence is re-scanned and clean for system labels ─────
describe('deterministic sentence', () => {
  it('describes the top movers with the window and passes the final scan', () => {
    const e = explainBalanceMove(trendsWith([DINING, GAS]));
    expect(e.deterministicSentence).toBe(
      'The biggest change was Dining, up $240.00, with Gas down $60.00, compared with your 3-month average.',
    );
    expect(validateSentence(e.deterministicSentence, sentenceInput(e)).ok).toBe(true);
  });

  it('a lone "new" category reads cleanly and passes the final scan', () => {
    const e = explainBalanceMove(trendsWith([TRAVEL_NEW]));
    expect(e.deterministicSentence).toBe('Travel is new this period at $500.00.');
    expect(validateSentence(e.deterministicSentence, sentenceInput(e)).ok).toBe(true);
  });
});

// ── validateTemplate: the closed atomic grammar ──────────────────────────────
describe('validateTemplate — closed atomic grammar', () => {
  const e = explainBalanceMove(trendsWith([DINING, GAS]));
  const vt = (t: string) => validateTemplate(t, e);

  it('accepts an atomic placeholder + additive-connective template in order', () => {
    expect(vt('The change was {primary}, with {second}, {window}.').ok).toBe(true);
    expect(vt('{primary}, alongside {second}, {window}.').ok).toBe(true);
    expect(vt('{primary} {window}.').ok).toBe(true); // second optional
  });

  it('rejects placeholder REORDERING — the figure-swap seam (critic cycle-2 P0-1)', () => {
    expect(vt('The change was {second}, and {primary}, {window}.').reason).toBe('missing-primary');
    expect(vt('{primary} {window} and {second}.').reason).toBe('placeholder-order');
  });

  it('rejects the old split placeholders (label separable from its figure)', () => {
    expect(vt('{primary} {primary_delta} {window}.').reason).toBe('placeholder:primary_delta');
  });

  it('rejects a duplicated placeholder and a missing {window}', () => {
    expect(vt('{primary} and {primary} {window}.').reason).toBe('missing-window');
    expect(vt('The change was {primary}, with {second}.').reason).toBe('missing-window');
  });

  it('rejects a template that types a literal number, $, or %', () => {
    expect(vt('{primary} up $240.00 {window}.').reason).toBe('literal-number');
    expect(vt('{primary} rose 240 {window}.').reason).toBe('literal-number');
  });

  it('rejects an unknown placeholder and {second} without a second factor', () => {
    expect(vt('{primary} {total} {window}.').reason).toBe('placeholder:total');
    const solo = explainBalanceMove(trendsWith([DINING]));
    expect(validateTemplate('{primary} with {second} {window}.', solo).reason).toBe('placeholder:second');
  });

  it('rejects merchant / category / advice / magnitude / causal / ranking / RELATIONAL words', () => {
    expect(vt('{primary} with Starbucks {window}.').reason).toBe('non-connective:starbucks');
    expect(vt('{primary} in coffee {window}.').reason).toBe('non-connective:in');
    expect(vt('consider {primary} {window}.').reason).toBe('non-connective:consider');
    expect(vt('{primary} doubled {window}.').reason).toBe('non-connective:doubled');
    expect(vt('{primary} because {window}.').reason).toBe('non-connective:because');
    expect(vt('the new {primary} {window}.').reason).toBe('non-connective:new'); // ranking pruned
    expect(vt('the biggest {primary} {window}.').reason).toBe('non-connective:biggest');
  });

  it('rejects RELATIONAL / flow words that assert a false inter-category flow (critic cycle-3 P1-1)', () => {
    expect(vt('spending shifted from {primary} to {second} {window}.').reason).toBe('non-connective:shifted');
    expect(vt('{primary} compared to {second} {window}.').reason).toBe('non-connective:compared');
    expect(vt('{primary} versus {second} {window}.').reason).toBe('non-connective:versus');
    expect(vt('{primary} moved to {second} {window}.').reason).toBe('non-connective:moved');
  });

  it('rejects non-ASCII (emoji / full-width), multiline, and over-long templates', () => {
    expect(vt('{primary} {window} 😬').reason).toBe('non-ascii');
    expect(vt('{primary}\n{window}').reason).toBe('multiline');
    expect(vt(`{primary} ${'the '.repeat(80)}{window}.`).reason).toBe('too-long');
  });
});

// ── validateSentence: the final defense-in-depth scan ────────────────────────
describe('validateSentence — final scan', () => {
  const e = explainBalanceMove(trendsWith([DINING, GAS]));
  const vs = (s: string) => validateSentence(s, sentenceInput(e));

  it('accepts a clean substituted sentence', () => {
    expect(vs('The biggest change was Dining, up $240.00, with Gas down $60.00 compared with your 3-month average.').ok).toBe(true);
  });

  it('rejects stray bare numerals, fabricated windows, and trailing precision (critic P0-1/P2-9)', () => {
    expect(vs('Dining moved up 240.00 vs your average.').reason).toBe('stray-number');
    expect(vs('Dining is up 999 vs your average.').reason).toBe('stray-number');
    expect(vs('Dining is up $240.00 compared with your 12-month average.').reason).toBe('stray-number');
    expect(vs('Dining is up $240.001 vs your average.').ok).toBe(false);
  });

  it('rejects word-form numbers and full-width currency (critic P0-1)', () => {
    expect(vs('Dining rose two hundred dollars vs your average.').reason).toContain('banned:');
    expect(vs('Dining is up forty percent vs your average.').reason).toContain('banned:');
    expect(vs('Dining is up ＄999.00 vs your average.').reason).toBe('non-ascii');
  });

  it('rejects a fabricated $ figure not in the payload', () => {
    expect(vs('Dining rose $999.00 vs your average.').reason).toBe('stray-number');
  });

  it('rejects an invented merchant — sentence-initial or parenthesized (critic P0-3)', () => {
    expect(vs('Starbucks pushed Dining up $240.00 vs your average.').reason).toBe('proper-noun:Starbucks');
    expect(vs('Dining rose $240.00 (Netflix) vs your average.').reason).toBe('proper-noun:Netflix');
  });

  it('rejects magnitude verbs, advice, habit-framing, causal, and double-space evasion (critic P1-4)', () => {
    expect(vs('Dining outpaced everything, up $240.00.').ok).toBe(false);
    expect(vs('Consider Dining, up $240.00.').reason).toContain('banned:');
    expect(vs('Dining is up $240.00 again.').reason).toContain('banned:');
    expect(vs('Dining rose $240.00 because of meals.').ok).toBe(false);
    expect(vs('Dining rose $240.00 due  to meals.').reason).toBe('banned:due to');
  });

  it('rejects multi-sentence, multiline, and empty', () => {
    expect(vs('Dining is up $240.00. Gas is down $60.00.').reason).toBe('multi-sentence');
    expect(vs('Dining is up $240.00\nGas down.').reason).toBe('multiline');
    expect(vs('   ').reason).toBe('empty');
  });
});

// ── buildMovePrompt ──────────────────────────────────────────────────────────
describe('buildMovePrompt', () => {
  const prompt = buildMovePrompt(explainBalanceMove(trendsWith([DINING, GAS])));
  it('pins the driver id, forbids typed figures/ranking/relational words, states the JSON contract', () => {
    expect(prompt).toContain('primaryDriverId MUST be exactly "dining"');
    expect(prompt).toMatch(/Do NOT type any digit/i);
    expect(prompt).toMatch(/ADDITIVE connective/i);
    expect(prompt).toMatch(/assert a flow/i);
    expect(prompt).toContain('{"primaryDriverId": "...", "template": "..."}');
    expect(prompt).toContain('{primary}');
    expect(prompt).not.toContain('{primary_delta}');
  });
});

// ── resolveMoveSentence: substitution + fallbacks ────────────────────────────
describe('resolveMoveSentence', () => {
  const e = explainBalanceMove(trendsWith([DINING, GAS]));
  const tpl = 'The change was {primary}, with {second}, {window}.';

  it('renders a validated atomic template with engine values and flags it interpreted', () => {
    const r = resolveMoveSentence(e, { primaryDriverId: 'dining', template: tpl });
    expect(r.interpreted).toBe(true);
    expect(r.sentence).toBe(
      'The change was Dining, up $240.00 (+40%), with Gas, down $60.00 (-20%), compared with your 3-month average.',
    );
  });

  it('a reordered template cannot swap figures — rejected, template stands (critic cycle-2 P0-1)', () => {
    const r = resolveMoveSentence(e, { primaryDriverId: 'dining', template: 'The change was {second}, and {primary}, {window}.' });
    expect(r).toMatchObject({ interpreted: false, sentence: e.deterministicSentence, rejectedReason: 'missing-primary' });
  });

  it('a relational template cannot assert a false flow — rejected (critic cycle-3 P1-1)', () => {
    const r = resolveMoveSentence(e, { primaryDriverId: 'dining', template: 'spending shifted from {primary} to {second} {window}.' });
    expect(r.interpreted).toBe(false);
    expect(r.sentence).toBe(e.deterministicSentence);
  });

  it('falls back when the LLM echoes the wrong driver (rework rail 1)', () => {
    const r = resolveMoveSentence(e, { primaryDriverId: 'gas', template: tpl });
    expect(r).toMatchObject({ interpreted: false, sentence: e.deterministicSentence, rejectedReason: 'driver-mismatch' });
  });

  it('uses the deterministic template when no LLM draft is present; empty when nothing moved', () => {
    expect(resolveMoveSentence(e, null)).toEqual({ sentence: e.deterministicSentence, interpreted: false });
    expect(resolveMoveSentence(explainBalanceMove(trendsWith([])), null)).toEqual({ sentence: '', interpreted: false });
  });

  it('SUPPRESSES the surface when a hostile custom-category label would breach the guardrail (critic cycle-2 P1-3)', () => {
    const shameName = mover({ categoryId: 'x', name: 'Because You Overspent', currentCents: 30000, baselineCents: 6000, deltaCents: 24000, pctChange: 4, direction: 'up' });
    const rShame = resolveMoveSentence(explainBalanceMove(trendsWith([shameName])), null);
    expect(rShame.sentence).toBe('');
    expect(rShame.rejectedReason).toContain('fallback-banned');

    const moneyName = mover({ categoryId: 'y', name: 'Save $500 Fund', currentCents: 30000, baselineCents: 6000, deltaCents: 24000, pctChange: 4, direction: 'up' });
    expect(resolveMoveSentence(explainBalanceMove(trendsWith([moneyName])), null).sentence).toBe('');
  });

  it('does NOT suppress a benign custom-category name that shares a word with the sentence (critic cycle-3 P1-2)', () => {
    // "Spare Change" (never a mover) must not nuke the surface via the word "change".
    const e2 = explainBalanceMove(trendsWith([DINING, GAS]));
    // the deterministic sentence contains "change"; with no foreign-category scan it renders fine
    expect(resolveMoveSentence(e2, null).sentence).toBe(e2.deterministicSentence);
  });

  it('does NOT suppress a benign digit-bearing finance label (critic cycle-4 P2-1)', () => {
    // "401k Contributions" carries a digit that is the label, not a fabricated figure.
    const retire = mover({ categoryId: 'r', name: '401k Contributions', currentCents: 30000, baselineCents: 6000, deltaCents: 24000, pctChange: 4, direction: 'up' });
    const eRetire = explainBalanceMove(trendsWith([retire]));
    const r = resolveMoveSentence(eRetire, null);
    expect(r.sentence).toBe(eRetire.deterministicSentence);
    expect(r.sentence).toContain('401k Contributions');
  });
});
