/**
 * U.16 — the released handover day is DISCLOSED wherever it is counted.
 *
 * U.13 (DECISIONS #454) made the one handover day between a retired feed and the
 * live one that continued it belong to BOTH sides, because a handover happens at
 * an instant INSIDE a day and a business date here carries no time. That is a
 * deliberate, measured over-count: releasing the day loses nothing, where either
 * whole-day award silently lost real money ($2,086.40 one way, $25,574.13 the
 * other). Its cost is 9 rows / $374.40 of VISIBLE duplication.
 *
 * "Visible" was the part that was not true yet. Every spending surface counted
 * those rows and said nothing, and the glass-box panel — the screen a suspicious
 * reader opens to AUDIT a figure — listed both copies and ticked "matched to the
 * penny" over them. A penny-match beside two identical lines does not read as
 * "the arithmetic is consistent"; it reads as "both of these belong". That is
 * the same shape `cardDuplicateTraceBasis` exists to answer for card payments,
 * and these tests lock its handover-day equivalent.
 *
 * What each test is really guarding is a CLAIM, not a code path: every sentence
 * here was written against a specific way of being false (see the copy tests),
 * and the scope tests exist because a disclosure attached to the wrong figure is
 * a new false statement rather than a fix.
 */
import { describe, expect, it } from 'vitest';
import {
  BREAKDOWN_BASIS,
  breakdownHandoverDayCopy,
  buildCategoryBreakdowns,
  categoryPanelBasis,
  handoverDayAnswerNote,
} from '@/lib/engine/glass-box/category-breakdown';
import { spendingByCategory, type ReportTxn, type SpendWindow } from '@/lib/engine/reports/reports';
import { handoverKey } from '@/lib/engine/account/reconcile-boundary';
import { answerSpendByCategory, answerSpendTotal, answerTopCategories } from '@/lib/engine/assistant/answer';
import { cents } from '@/lib/money';

const WINDOW: SpendWindow = { fromYm: '2026-07', toYm: '2026-07' };
/** The handover day. Both feeds of one combined pair reported this date. */
const HANDOVER = '2026-07-21';
/** The two sides of the combined pair — and ONLY those two. */
const PRED = 'acct-retired-feed';
const SUCC = 'acct-live-feed';
/** An account in NO combined pair, whose rows may never be marked. */
const OTHER = 'acct-unrelated';
const DATES = new Set([handoverKey(PRED, HANDOVER), handoverKey(SUCC, HANDOVER)]);

/**
 * The shape U.13 actually produces: ONE real −$50.00 purchase that both the
 * retired feed and the live one reported on the handover day, so the boundary
 * keeps both rows — plus an ordinary purchase on another day.
 */
const TXNS: ReportTxn[] = [
  { id: 'a', date: '2026-07-10', accountId: PRED, amountCents: -3_000, categoryId: 'groceries' },
  { id: 'b-old', date: HANDOVER, accountId: PRED, amountCents: -5_000, categoryId: 'groceries' },
  { id: 'b-new', date: HANDOVER, accountId: SUCC, amountCents: -5_000, categoryId: 'groceries' },
];

describe('U.16 — the copy says only what is true in every shape', () => {
  it('never says "twice": a chain sharing one cutover releases the date at every generation', () => {
    // U.13 measured one $999.99 charge at $3,999.96 on a four-link chain, and
    // recorded "the only date that may be counted twice" as a sentence that was
    // simply false. "Once for each" is true at every multiplicity.
    const s = breakdownHandoverDayCopy(4, true);
    expect(s).toContain('once for each');
    expect(s).not.toMatch(/\btwice\b/);
  });

  it('states the doubling as a CONDITION, never as a fact about these rows', () => {
    // The boundary releases the day; whether both connections actually reported
    // a given charge is not knowable from the dates, and `buildTaxExport`
    // records why guessing from the rows cannot settle it. A row on a handover
    // day where only one feed reported is marked too — so the sentence may not
    // assert that anything IS duplicated.
    const s = breakdownHandoverDayCopy(2, true);
    expect(s).toContain('if more than one of them reported the same transaction');
    expect(s).not.toMatch(/is counted twice|has been counted twice|these are duplicates/i);
  });

  it('asserts no CAUSE for the date — the clause U.13 proved false is absent', () => {
    // "That's the day one connection stopped" is false whenever the reader drags
    // the cutover input, and false by sixteen months for a dormant feed (U.17).
    // U.13 replaced it with a clause that holds in every shape; this reuses it.
    const s = breakdownHandoverDayCopy(1, true);
    expect(s).toContain('neither can be shown to have covered the whole of it');
    expect(s).not.toMatch(/the day (one|your) connection stopped/i);
  });

  it('agrees with the panel it sits under: the tally clause appears only while the tally holds', () => {
    // The whole point of U.16 is that a penny-match reads as confirmation. Saying
    // "these still add up" is honest only while they do — on a panel already
    // reporting a mismatch it would be the false sentence.
    expect(breakdownHandoverDayCopy(2, true)).toContain('still add up to the figure above');
    expect(breakdownHandoverDayCopy(2, false)).not.toContain('still add up');
    // …and the fact itself survives either way.
    expect(breakdownHandoverDayCopy(2, false)).toContain('once for each');
  });

  it('counts in the reader’s grammar', () => {
    expect(breakdownHandoverDayCopy(1, true)).toContain('1 row here falls');
    expect(breakdownHandoverDayCopy(3, true)).toContain('3 rows here fall');
  });

  it('the ANSWER note never says "rows here", because an answer has no rows', () => {
    // `a-disclosure-written-for-a-page-is-false-in-an-email`: a qualifying
    // sentence carries an implicit claim about where the reader is standing.
    // Ask prints one figure and nothing else.
    const s = handoverDayAnswerNote(2);
    expect(s).not.toContain('rows here');
    expect(s).not.toContain('add up to the figure above');
    expect(s).toContain('2 transactions in this figure fall');
    // regression__u16_answer_note_promises_no_surface_it_cannot_deliver: the
    // first draft ended "Spending in Reports lists those rows and marks them."
    // /reports' category table is ALWAYS the current month (`spentSoFarWindow`,
    // and its only URL parameter sets the CHART range), while an Ask timeframe
    // is whatever the reader said — "last month", "last quarter". So the pointer
    // was false for every answer that was not about this month, and it sent the
    // reader to a page that could not show them the rows it promised.
    expect(s).not.toMatch(/Reports/);
    expect(handoverDayAnswerNote(1)).toContain('1 transaction in this figure falls');
  });

  it('regression__u16_states_both_directions: a repeated RETURN makes a figure too LOW', () => {
    // Critic P0, executed: the slice's premise — written into a code comment as
    // "a released day can only make a figure too high" — is false. The release is
    // a rule about a DATE, not a sign, and `spendContributionCents` negates, so a
    // return both feeds reported SUBTRACTS twice. A reader auditing a suspiciously
    // low number was being steered away from the cause by the only sentence
    // beside it.
    for (const s of [breakdownHandoverDayCopy(2, true), handoverDayAnswerNote(2)]) {
      expect(s).toContain('too high when they are purchases');
      expect(s).toContain('too LOW when they are returns');
    }
  });

  it('regression__u16_tally_clause_needs_a_tally_on_screen', () => {
    // Critic finding: at exactly one row `BreakdownPanel` prints "This amount is
    // the whole figure." and deliberately suppresses the penny-match, so a basis
    // sentence claiming "the rows still add up" describes a line the panel just
    // declined to print — and says "rows" over a single row.
    expect(breakdownHandoverDayCopy(1, false)).not.toContain('still add up');
    expect(breakdownHandoverDayCopy(2, true)).toContain('The rows in this panel still add up');
    // The antecedent is the PANEL's rows, never the marked subset: in a 5-row
    // panel with 1 marked row, "these rows" would read as the marked one alone
    // summing to the figure.
    expect(breakdownHandoverDayCopy(1, true)).not.toContain('These rows');
  });

  it('regression__u16_handover_noun_covers_a_refund: never calls a released row a "charge"', () => {
    // Critic attack 3: a REFUND can fall on a handover day too, and a duplicated
    // refund pushes the figure DOWN rather than up. "Charge" is false of it in
    // both directions — it is not a charge, and the reader would look for a
    // purchase that is not there. "Transaction" is true of every row that can
    // reach this sentence, which is the only noun that can be.
    for (const s of [breakdownHandoverDayCopy(2, true), handoverDayAnswerNote(2)]) {
      expect(s).not.toMatch(/charge/i);
      expect(s).toContain('transaction');
    }
  });
});

describe('U.16 — the breakdown marks the rows and counts them', () => {
  it('marks every listed row dated on a released day, and only those', () => {
    const out = buildCategoryBreakdowns(TXNS, WINDOW, new Map([['groceries', 13_000]]), undefined, undefined, DATES);
    const g = out.groceries;
    expect(g.rows.map((r) => [r.date, r.onHandoverDay])).toEqual([
      ['2026-07-10', false],
      [HANDOVER, true],
      [HANDOVER, true],
    ]);
    expect(g.countedOnHandoverDays).toBe(2);
  });

  it('the penny-match still holds — the disclosure does NOT hide the double by dropping it', () => {
    // The failure direction this engine chose: a visible, advisory-covered
    // double, never a silent loss. So both rows stay counted, and `reconciles`
    // stays true against the figure that counted both.
    const out = buildCategoryBreakdowns(TXNS, WINDOW, new Map([['groceries', 13_000]]), undefined, undefined, DATES);
    expect(out.groceries.reconciles).toBe(true);
    expect(out.groceries.sumCents).toBe(cents(13_000));
    expect(out.groceries.rows).toHaveLength(3);
  });

  it('regression__u16_marker_is_scoped_to_the_pair_not_the_date', () => {
    // Critic finding, executed: the first draft tested `handoverDates.has(t.date)`
    // — a bare DATE match. A released day is an ordinary shopping day on every
    // other account the reader owns, so the panel marked every row posted that
    // day and announced "6 rows here fall on a day one of your combined accounts
    // was changing connections" when at most two of them could be doubled. The
    // marker is the affordance that lets a reader FIND the two identical lines;
    // marking four unrelated rows destroys exactly that.
    const sameDayElsewhere: ReportTxn[] = [
      ...TXNS,
      { id: 'x1', date: HANDOVER, accountId: OTHER, amountCents: -1_100, categoryId: 'groceries' },
      { id: 'x2', date: HANDOVER, accountId: OTHER, amountCents: -1_200, categoryId: 'groceries' },
    ];
    const out = buildCategoryBreakdowns(
      sameDayElsewhere,
      WINDOW,
      new Map([['groceries', 15_300]]),
      undefined,
      undefined,
      DATES,
    );
    // Five rows listed, and exactly the pair's two marked.
    expect(out.groceries.rows).toHaveLength(5);
    expect(out.groceries.countedOnHandoverDays).toBe(2);
    expect(out.groceries.rows.filter((r) => r.onHandoverDay).map((r) => r.key.length > 0)).toHaveLength(2);
    // The unrelated account's rows on that very date carry no claim.
    const unrelated = out.groceries.rows.filter((r) => r.amountCents === cents(1_100) || r.amountCents === cents(1_200));
    expect(unrelated).toHaveLength(2);
    expect(unrelated.every((r) => r.onHandoverDay === false)).toBe(true);
  });

  it('with no combined accounts the output is byte-identical to pre-U.16', () => {
    const withNone = buildCategoryBreakdowns(TXNS, WINDOW, new Map([['groceries', 13_000]]));
    expect(withNone.groceries.countedOnHandoverDays).toBe(0);
    expect(withNone.groceries.rows.every((r) => r.onHandoverDay === false)).toBe(true);
  });

  it('a row the figure does NOT count is not reported as counted twice in it', () => {
    // `isSpendRow` drops transfers. A transfer dated on the handover day is in
    // neither the figure nor the rows, so counting it here would attribute a
    // doubling to money the panel never showed.
    const withTransfer: ReportTxn[] = [
      ...TXNS,
      { id: 't', date: HANDOVER, accountId: PRED, amountCents: -9_900, categoryId: 'groceries', isTransfer: true },
    ];
    const out = buildCategoryBreakdowns(withTransfer, WINDOW, new Map([['groceries', 13_000]]), undefined, undefined, DATES);
    expect(out.groceries.countedOnHandoverDays).toBe(2);
    expect(out.groceries.rows).toHaveLength(3);
  });
});

describe('U.16 — the panel prints the sentence exactly when it applies', () => {
  it('adds it when rows fall on a released day, after the shared basis', () => {
    const basis = categoryPanelBasis({ notCountedYetCents: cents(0), countedOnHandoverDays: 2, reconciles: true, rows: [] as never });
    expect(basis[0]).toBe(BREAKDOWN_BASIS);
    expect(basis.some((b) => b.includes('changing connections'))).toBe(true);
  });

  it('says nothing to a reader whose rows fall nowhere near one', () => {
    // The `dataDerived` gate (C.11/#407): a sentence that fired on the mere
    // existence of a combined pair would nag every reader about a rule that
    // never touched their money.
    const basis = categoryPanelBasis({ notCountedYetCents: cents(0), countedOnHandoverDays: 0, reconciles: true, rows: [] as never });
    expect(basis).toEqual([BREAKDOWN_BASIS]);
  });
});

describe('U.16 — the figure and its disclosure are scoped to each other', () => {
  const MIXED: ReportTxn[] = [
    { id: 'g1', date: HANDOVER, accountId: PRED, amountCents: -5_000, categoryId: 'groceries' },
    { id: 'g2', date: HANDOVER, accountId: SUCC, amountCents: -5_000, categoryId: 'groceries' },
    { id: 'd1', date: '2026-07-02', accountId: OTHER, amountCents: -2_000, categoryId: 'dining' },
  ];

  it('counts per category, not just per breakdown', () => {
    const b = spendingByCategory(MIXED, WINDOW, undefined, undefined, DATES);
    expect(b.countedOnHandoverDays).toBe(2);
    expect(b.byCategory.find((c) => c.categoryId === 'groceries')?.countedOnHandoverDays).toBe(2);
    expect(b.byCategory.find((c) => c.categoryId === 'dining')?.countedOnHandoverDays).toBe(0);
  });

  it('Ask qualifies the TOTAL when any counted row lands on a released day', () => {
    const b = spendingByCategory(MIXED, WINDOW, undefined, undefined, DATES);
    const a = answerSpendTotal(b, { label: 'this month' } as never);
    expect(a.detail).toContain('changing connections');
    // The pre-existing rule sentence is kept, never replaced.
    expect(a.detail).toContain('Purchases only');
  });

  it('Ask does NOT qualify a category figure that contains none of it', () => {
    // The defect this guards: attaching the breakdown-wide count to a single
    // category's answer would claim a doubling inside a figure that has none —
    // a new false statement dressed as a fix.
    const b = spendingByCategory(MIXED, WINDOW, undefined, undefined, DATES);
    const dining = answerSpendByCategory(
      b,
      { type: 'category', categoryId: 'dining', label: 'dining' } as never,
      { label: 'this month' } as never,
    );
    expect(dining.detail ?? '').not.toContain('changing connections');

    const groceries = answerSpendByCategory(
      b,
      { type: 'category', categoryId: 'groceries', label: 'groceries' } as never,
      { label: 'this month' } as never,
    );
    expect(groceries.detail ?? '').toContain('changing connections');
  });

  it('regression__u16_count_excludes_categories_the_figure_drops', () => {
    // Critic attack 1, executed against the real engine: `spendingByCategory`
    // drops any category whose net is <= 0, so a handover-day purchase more than
    // cancelled by a refund leaves the figure entirely. Counting it in the raw
    // pass made Ask qualify a $20.00 total — containing NO released row — with
    // "2 … fall on a day…". The count is now summed from the surviving
    // categories, which is the same array `totalCents` is summed from.
    const txns: ReportTxn[] = [
      { id: 'd1', date: '2026-07-02', accountId: OTHER, amountCents: -2_000, categoryId: 'dining' },
      { id: 's1', date: HANDOVER, accountId: PRED, amountCents: -5_000, categoryId: 'shopping' },
      { id: 's2', date: HANDOVER, accountId: SUCC, amountCents: 6_000, categoryId: 'shopping' },
    ];
    const b = spendingByCategory(txns, WINDOW, undefined, undefined, DATES);
    expect(b.totalCents).toBe(2_000);
    expect(b.byCategory.map((c) => c.categoryId)).toEqual(['dining']);
    expect(b.countedOnHandoverDays).toBe(0);
    // U.21 rescope (the U.19–U.22 critic cycle): the COUNTED note ("N
    // transactions in this figure") must still not fire — no released row is IN
    // this figure, which is what this regression always guarded — but the
    // figure is no longer silent either: the dropped category's released rows
    // now surface through the UNCOUNTED note, because this exact shape (a $20
    // total that silently lost a category to a doubled return) was the money
    // critic's P1-1 exhibit one slice later.
    const detail = answerSpendTotal(b, { label: 'this month' } as never).detail ?? '';
    expect(detail).not.toContain('in this figure');
    expect(detail).toContain('Spending figures leave out');
  });

  it('regression__u16_top_categories_qualifies_the_total_it_prints', () => {
    // Critic attack 2: this answer states a period TOTAL that a released day can
    // inflate, and said nothing about it — the same silence U.16 exists to
    // remove, one answer over.
    const txns: ReportTxn[] = [
      { id: 'g1', date: HANDOVER, accountId: PRED, amountCents: -5_000, categoryId: 'groceries' },
      { id: 'g2', date: HANDOVER, accountId: SUCC, amountCents: -5_000, categoryId: 'groceries' },
      { id: 'd1', date: '2026-07-02', accountId: OTHER, amountCents: -2_000, categoryId: 'dining' },
    ];
    const b = spendingByCategory(txns, WINDOW, undefined, undefined, DATES);
    const a = answerTopCategories(b, { label: 'this month' } as never, 3);
    expect(a.detail).toContain('Total this month:');
    expect(a.detail).toContain('changing connections');
    // …and stays silent for a reader with no combined accounts.
    const clean = spendingByCategory(txns, WINDOW);
    expect(answerTopCategories(clean, { label: 'this month' } as never, 3).detail).toBe('Total this month: $120.00.');
  });

  it('a reader with no combined accounts gets the pre-U.16 answer, unchanged', () => {
    const b = spendingByCategory(MIXED, WINDOW);
    expect(b.countedOnHandoverDays).toBe(0);
    const a = answerSpendTotal(b, { label: 'this month' } as never);
    expect(a.detail).toBe(
      "Purchases only — transfers and income are excluded, and anything dated after today isn't counted yet.",
    );
  });
});
