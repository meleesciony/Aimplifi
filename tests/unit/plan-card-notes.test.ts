import { describe, expect, it } from 'vitest';
import type { SpendingPlanDisclosures } from '@/lib/engine/spending-plan/plan';
import type { CardNoteSurface } from '@/lib/engine/spending-plan/row-labels';
import {
  BUDGETS_CARD_NOTE_SURFACE,
  planCardNoteParts,
  planCardNotes,
} from '@/lib/engine/spending-plan/row-labels';

/**
 * O.18f — the excluded-card disclosure has ONE author.
 *
 * Before this slice the same four facts (undated, statement-pending, duplicate,
 * frozen) were written out by hand on four surfaces: the dashboard card, the
 * /spending-plan "What this figure can't see" list, `planCardNotes` for the
 * /budgets strip, and `answer.ts` for Ask — which the residual's own task row did
 * not know about, so the count in that row (three) was wrong.
 *
 * The copies had drifted, and the drift is what these tests pin: the duplicate
 * COUNT (three of the four said "Two" for any number of pairs), whether the cards
 * are named, whether the frozen note carries its since-date, and the modality of
 * the direction clause.
 */

const EMPTY: SpendingPlanDisclosures = {
  undatedCards: [],
  statementPendingCards: [],
  duplicatePairs: [],
  frozenCards: [],
  creditCardCount: 3,
  creditCardsOutsideFigure: 0,
  cardsDatedAfterThisMonth: 0,
  fixedSeries: { detected: 0, counted: 0, onCard: 0, lapsed: 0, uncounted: 0, noCashAccount: 0 },
};

/** The four real surface configurations, so a change to any of them fails here. */
const DASHBOARD: CardNoteSurface = {
  headline: 'left-to-spend',
  container: 'this figure',
  detail: 'compact',
  fixedCostsName: null,
};
const BUDGETS: CardNoteSurface = {
  headline: 'left-to-spend',
  container: 'the card-payments amount',
  detail: 'compact',
  fixedCostsName: 'your real fixed costs',
};
const PLAN: CardNoteSurface = {
  headline: 'left-to-spend',
  container: 'the card-payments line',
  detail: 'named',
  fixedCostsName: null,
};
const ASK_OVERSPENT: CardNoteSurface = {
  headline: 'overage',
  container: 'the card-payments figure',
  detail: 'named',
  fixedCostsName: null,
};

describe('planCardNotes — abstention', () => {
  // A disclosure has two failure modes and a suite that only proves it SPEAKS
  // catches one of them. On money, the false hedge is the expensive direction:
  // a reader told a figure might be wrong when it is not stops trusting the ones
  // that are right.
  it('says NOTHING when there is nothing to disclose, on every surface', () => {
    for (const surface of [DASHBOARD, BUDGETS, PLAN, ASK_OVERSPENT]) {
      expect(planCardNotes(EMPTY, surface)).toEqual([]);
    }
  });

  it('each fact is independently load-bearing — silencing one keeps the others', () => {
    const onlyFrozen: SpendingPlanDisclosures = {
      ...EMPTY,
      frozenCards: [{ label: 'Freedom', frozenSince: '2026-06-01' }],
    };
    const notes = planCardNoteParts(onlyFrozen, DASHBOARD);
    expect(notes.map((n) => n.fact)).toEqual(['frozen']);
    // And the tag is what a surface selects on. Indexing would have put this note
    // in the excluded-card slot, which is the bug the tagged form exists to prevent.
    expect(notes[0].text).toContain('stopped being shared by the bank');
  });
});

describe('planCardNotes — the duplicate count (O.18f regression)', () => {
  const TWO_PAIRS: SpendingPlanDisclosures = {
    ...EMPTY,
    // Reachable: `src/server/spending-plan.ts` applies no cap over a nested-loop
    // detector, so one card can pair with two others (A↔B and A↔C).
    duplicatePairs: [
      { aName: 'Sapphire', bName: 'Sapphire Reserve', confidence: 'high' as const },
      { aName: 'Freedom', bName: 'Freedom Flex', confidence: 'medium' as const },
    ],
  };

  it('test_regression__duplicate_pairs_not_hardcoded_two — compact counts PAIRS', () => {
    // The defect: three of the four pre-O.18f authors said "Two of the cards"
    // regardless of how many pairs the detector returned.
    const [note] = planCardNotes(TWO_PAIRS, DASHBOARD);
    expect(note).toContain('2 pairs of cards behind this figure');
    expect(note).not.toContain('Two of the cards');
    // And it does not open with a bare numeral (critic P2-4).
    expect(note.startsWith('We found ')).toBe(true);
  });

  it('counts pairs, never cards — two pairs may share a card', () => {
    // "four cards" would be a claim this channel cannot support: the pairs above
    // could be A↔B and A↔C, which is three cards, not four.
    const [note] = planCardNotes(TWO_PAIRS, BUDGETS);
    expect(note).not.toMatch(/\b(four|4) cards\b/i);
  });

  it('a single pair still reads "Two of the cards"', () => {
    const onePair: SpendingPlanDisclosures = {
      ...EMPTY,
      duplicatePairs: [{ aName: 'A', bName: 'B', confidence: 'high' as const }],
    };
    expect(planCardNotes(onePair, DASHBOARD)[0]).toContain('Two of the cards behind this figure');
  });

  it('named surfaces emit ONE sentence per pair, each naming its own cards', () => {
    // Ask's pre-O.18f copy said "Two cards ... (A and B; C and D)" — a count of two
    // beside four names, in one sentence.
    const notes = planCardNoteParts(TWO_PAIRS, PLAN).filter((n) => n.fact === 'duplicate');
    expect(notes).toHaveLength(2);
    expect(notes[0].text).toContain('Sapphire and Sapphire Reserve');
    expect(notes[0].text).toContain('strong match');
    expect(notes[1].text).toContain('Freedom and Freedom Flex');
    expect(notes[1].text).toContain('possible match');
    for (const n of notes) expect(n.text).not.toContain('Two cards');
  });
});

describe('planCardNotes — direction is the surface’s fact, not the plan’s', () => {
  const EXCLUDED: SpendingPlanDisclosures = {
    ...EMPTY,
    undatedCards: [{ cardName: 'Venture', frozenSince: null }],
  };

  it('an exclusion makes left-to-spend SMALLER and an overage BIGGER', () => {
    expect(planCardNotes(EXCLUDED, DASHBOARD)[0]).toContain(
      'the real amount free to spend may be lower than shown',
    );
    expect(planCardNotes(EXCLUDED, ASK_OVERSPENT)[0]).toContain(
      'the real overage may be higher than shown',
    );
  });

  it('a duplicate points the OTHER way, and states it definitely under "if so"', () => {
    const dup: SpendingPlanDisclosures = {
      ...EMPTY,
      duplicatePairs: [{ aName: 'A', bName: 'B', confidence: 'high' as const }],
    };
    // Definite, not hedged: the clause is governed by an antecedent that has already
    // taken the duplicate as given. Collapsing it to "may be" under-states it.
    expect(planCardNotes(dup, DASHBOARD)[0]).toContain(
      'the real amount free to spend is higher than shown',
    );
    expect(planCardNotes(dup, ASK_OVERSPENT)[0]).toContain('the real overage is smaller than shown');
  });

  it('the no-figure state replaces BOTH directions rather than defaulting to one', () => {
    // The dashboard's no-data branch prints no figure at all, so neither "lower" nor
    // "higher" is true. Naming the ignorance beats defaulting to a direction.
    const noFigure: CardNoteSurface = { ...DASHBOARD, headline: 'none' };
    const notes = planCardNotes({ ...EMPTY, undatedCards: [{ cardName: 'V', frozenSince: null }] }, noFigure);
    expect(notes[0]).toContain('so there is no figure to show for it here');
    expect(notes[0]).not.toContain('may be lower');
    expect(notes[0]).not.toContain('may be higher');
  });

  it('the no-figure state drops the "if so" consequence rather than voiding it (critic P2-3)', () => {
    // "…may be the same card counted twice; if so there is no figure to show for it
    // here" is a non-sequitur: the figure's absence does not follow from the pair.
    const noFigure: CardNoteSurface = { ...DASHBOARD, headline: 'none' };
    const dup: SpendingPlanDisclosures = {
      ...EMPTY,
      duplicatePairs: [{ aName: 'A', bName: 'B', confidence: 'high' as const }],
    };
    const [note] = planCardNotes(dup, noFigure);
    expect(note).not.toContain('if so');
    expect(note).toContain('Nothing was adjusted');
  });

  it('the fixed-costs clause is omitted where the surface prints no fixed-costs figure', () => {
    // The dashboard card shows only the headline, so "your real fixed costs" would
    // point at nothing there — the trap `uncountedFixedNote`'s `lineName` exists for.
    expect(planCardNotes(EXCLUDED, DASHBOARD)[0]).not.toContain('fixed costs');
    expect(planCardNotes(EXCLUDED, BUDGETS)[0]).toContain(
      'your real fixed costs are higher than shown',
    );
  });

  it('and it is suppressed in the no-figure state — nothing is “higher than shown” when nothing is shown', () => {
    const noFigure: CardNoteSurface = { ...BUDGETS, headline: 'none' };
    expect(planCardNotes(EXCLUDED, noFigure)[0]).not.toContain('higher than shown');
  });
});

describe('planCardNotes — the compact surfaces’ fact set is closed (critic P2-5)', () => {
  // The dashboard card selects notes by fact name and handles exactly three of
  // them. If `detail: 'compact'` ever emitted `undated`/`statement-pending`, that
  // card would silently drop its exclusion disclosure — the L.15 silent-failure
  // class, which neither tsc nor the render can catch.
  it('compact emits only excluded | duplicate | frozen, never the split facts', () => {
    const everything: SpendingPlanDisclosures = {
      ...EMPTY,
      undatedCards: [{ cardName: 'Venture', frozenSince: null }],
      statementPendingCards: [{ cardName: 'Bonvoy', dueDate: '2026-06-28' }],
      duplicatePairs: [{ aName: 'A', bName: 'B', confidence: 'high' as const }],
      frozenCards: [{ label: 'Freedom', frozenSince: '2026-06-01' }],
    };
    for (const surface of [DASHBOARD, BUDGETS]) {
      const facts = planCardNoteParts(everything, surface).map((n) => n.fact);
      expect(facts).toEqual(['excluded', 'duplicate', 'frozen']);
    }
  });

  it('the /budgets surface is ONE declaration, shared by the strip and the trace', () => {
    // Two callers whose text must stay identical (the panel bases the share
    // snapshot exports, and the visible notes beside the bar).
    expect(BUDGETS_CARD_NOTE_SURFACE).toEqual(BUDGETS);
  });
});

describe('planCardNotes — named surfaces carry what compact ones cannot', () => {
  const FROZEN_TWO: SpendingPlanDisclosures = {
    ...EMPTY,
    frozenCards: [
      { label: 'Freedom', frozenSince: '2026-06-01' },
      { label: 'Venture', frozenSince: '2026-05-14' },
    ],
  };

  it('every frozen card carries its since-date, at any count', () => {
    // Pre-O.18f /spending-plan carried the date only in the singular branch, so a
    // second frozen card silently cost BOTH of them their provenance.
    const [note] = planCardNotes(FROZEN_TWO, PLAN);
    expect(note).toContain('Freedom, since 2026-06-01');
    expect(note).toContain('Venture, since 2026-05-14');
    expect(note).toContain('their amounts');
  });

  it('compact surfaces merge the two exclusion mechanisms; named ones split them', () => {
    const both: SpendingPlanDisclosures = {
      ...EMPTY,
      undatedCards: [{ cardName: 'Venture', frozenSince: null }],
      statementPendingCards: [{ cardName: 'Bonvoy', dueDate: '2026-06-28' }],
    };
    // Compact: one sentence, one count of two.
    const compact = planCardNoteParts(both, DASHBOARD);
    expect(compact.map((n) => n.fact)).toEqual(['excluded']);
    expect(compact[0].text).toContain('2 cards with a balance but no statement or due date yet');
    // Named: one sentence each, and the reason differs, so merging them would state
    // a wrong reason for one of the two cards.
    const named = planCardNoteParts(both, PLAN);
    expect(named.map((n) => n.fact)).toEqual(['undated', 'statement-pending']);
    expect(named[0].text).toContain('no due date yet (Venture)');
    expect(named[1].text).toContain('Bonvoy (due around 2026-06-28)');
  });
});
