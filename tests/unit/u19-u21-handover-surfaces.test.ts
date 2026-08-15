/**
 * U.19 / U.20 / U.21 / U.22 — the four surfaces U.16's critics proved were still
 * silent about the released handover day, closed as one slice because all four
 * consume the same account-scoped key set.
 *
 *  - U.19: the transactions CSV leaves the app as completely as the tax export
 *    does, and shipped the double with no column and no note.
 *  - U.20: Ask's merchant_spend — the highest-exposure Ask answer — stated a
 *    figure the released day can move, under a trace printing a green
 *    penny-match; and the register's own in/out/net totals sat beneath a caption
 *    that enumerated what moves them and omitted the one rule that counts a
 *    real transaction more than once.
 *  - U.21: a doubled RETURN can drive a category's net to <= 0, the figure then
 *    DROPS the category, and the zero branches print "No spending recorded" — a
 *    stronger claim than any number this engine prints, false precisely because
 *    of the double, and unreachable by `countedOnHandoverDays`, which is summed
 *    from the categories that SURVIVE.
 *  - U.22 rides on U.21's plumbing in the UI (the /reports page total) and its
 *    engine half is the same `uncountedOnHandoverDays` field locked here.
 *
 * Same doctrine as u16-handover-disclosure.test.ts: every test guards a CLAIM.
 * The copy tests assert what each sentence may and may not say (no "twice", no
 * "charge", no asserted cause, no promise about a surface that is not there);
 * the scope tests exist because a disclosure attached to the wrong figure is a
 * new false statement rather than a fix.
 */
import { describe, expect, it } from 'vitest';
import { transactionsToCsv, type ExportTxn } from '@/lib/export';
import {
  answerMerchantSpend,
  answerSpendByCategory,
  answerSpendTotal,
  answerTopCategories,
  merchantSpend,
  type AskTxnRow,
} from '@/lib/engine/assistant/answer';
import { traceMerchantSpend, traceSpendByCategory, traceSpendTotal } from '@/lib/engine/assistant/trace';
import {
  handoverDayAmountsNote,
  handoverDayDetailNote,
  handoverDayRegisterTotalsNote,
  handoverDayUncountedNote,
} from '@/lib/engine/glass-box/category-breakdown';
import { spendingByCategory, type ReportTxn, type SpendWindow } from '@/lib/engine/reports/reports';
import { summarizeTransactions, type TotalableTxn } from '@/lib/engine/transactions/query';
import { handoverKey } from '@/lib/engine/account/reconcile-boundary';
import { CATEGORY_BY_ID } from '@/lib/engine/categorize/categories';
import type { Timeframe } from '@/lib/engine/assistant/intent';

const WINDOW: SpendWindow = { fromYm: '2026-07', toYm: '2026-07' };
const TF: Timeframe = { fromYm: '2026-07', toYm: '2026-07', label: 'this month' };
const TODAY = '2026-07-25';
/** The handover day. Both feeds of one combined pair reported this date. */
const HANDOVER = '2026-07-21';
const PRED = 'acct-retired-feed';
const SUCC = 'acct-live-feed';
/** An account in NO combined pair, whose rows may never be marked. */
const OTHER = 'acct-unrelated';
const KEYS = new Set([handoverKey(PRED, HANDOVER), handoverKey(SUCC, HANDOVER)]);

// ─── U.19: the transactions CSV ──────────────────────────────────────────────

/**
 * U.19's cases are about the changeover disclosure only — this reader has no account the
 * currency guard withholds, so the U.23 note stays silent and these files keep the exact
 * shape U.19 locked. The U.23 locks assert the interaction from the other side.
 */
const NONE_WITHHELD = { count: 0, currencies: [] };

const csvRow = (over: Partial<ExportTxn> = {}): ExportTxn => ({
  date: '2026-07-10',
  account: 'Checking',
  rawDescriptor: 'COSTCO WHSE #0482',
  merchant: 'Costco',
  category: 'Groceries',
  amountCents: -5_000,
  status: 'POSTED',
  onHandoverDay: false,
  excludeFromTotals: false,
  isTransfer: false,
  ...over,
});

describe('U.19 — the transactions CSV carries the changeover column and, when it applies, the note', () => {
  it('the column is UNCONDITIONAL: one schema for every reader', () => {
    // A column that appears only for readers with a combined pair is a file
    // whose shape depends on who exported it — anything automated against it
    // breaks silently, and only for some readers.
    const out = transactionsToCsv([csvRow()], NONE_WITHHELD);
    const lines = out.split('\r\n');
    expect(lines[0]).toBe(
      'date,account,description,merchant,category,amount,status,changeover_day,' +
        'excluded_from_totals,transfer',
    );
    // Unmarked row: the field is present and empty. U.26 added two more columns
    // of the same kind, so an unmarked row now ends in three empty fields.
    expect(lines[1].endsWith(',,,')).toBe(true);
    expect(lines[1]).not.toContain('yes');
  });

  it('a reader with no combined accounts gets no CHANGEOVER note — U.25 gave every file a basis note', () => {
    const out = transactionsToCsv([csvRow(), csvRow({ date: '2026-07-11' })], NONE_WITHHELD);
    const lines = out.split('\r\n');
    // header + 2 rows + the unconditional basis note + trailing '' from the final
    // CRLF. This test asserted 4 lines and no 'Note:' at all until U.25, which
    // traded U.19's byte-identical-file property for a file that says what it is;
    // what U.19 still owns is that the CHANGEOVER note stays silent here.
    expect(lines).toHaveLength(5);
    expect(out).not.toContain('changeover_day fall on a day');
    expect(lines[3].startsWith('"Note: this file lists transactions')).toBe(true);
  });

  it('a released row is marked yes, and the note rides the END of the file, rectangular', () => {
    const out = transactionsToCsv([csvRow(), csvRow({ date: HANDOVER, onHandoverDay: true })], NONE_WITHHELD);
    const lines = out.split('\r\n');
    // The released row's changeover field is the 8th of ten; the two U.26
    // columns follow it, empty on a row that is neither excluded nor a transfer.
    expect(lines[2].endsWith(',yes,,')).toBe(true);
    const note = lines[lines.length - 2];
    expect(note.startsWith('"Note: rows marked yes in changeover_day')).toBe(true);
    // Rectangular: the prose occupies field 1 and the remaining fields follow
    // empty, so a parser reading the file as a table sees one row of the declared
    // width, never a ragged tail. Nine commas since U.26 widened the schema — the
    // padding is derived from the header now, so the two cannot drift apart.
    expect(note.endsWith(',,,,,,,,,')).toBe(true);
  });

  it('the note says only what is true in every shape', () => {
    const out = transactionsToCsv([csvRow({ date: HANDOVER, onHandoverDay: true })], NONE_WITHHELD);
    // regression__u16_tax_csv_said_twice: "counted twice" is false at
    // multiplicity >= 3 (a chain sharing one cutover releases the date at every
    // generation). "Once for each" is true at every multiplicity.
    expect(out).toContain('once for each');
    expect(out).not.toMatch(/\btwice\b/);
    // regression__u16_handover_noun_covers_a_refund: a released row can be a
    // refund, which is not a charge in either sense.
    expect(out).not.toMatch(/charge/i);
    // No asserted cause, no asserted duplication — both unprovable from dates.
    expect(out).toContain('neither can be shown to have covered the whole of it');
    expect(out).toContain('if more than one of them reported the same transaction');
    // The engine's stated failure direction, in the reader's file too.
    expect(out).toContain('Nothing has been adjusted');
  });
});

// ─── U.20: merchant_spend — answer and trace ─────────────────────────────────

const askRow = (over: Partial<AskTxnRow> = {}): AskTxnRow => ({
  date: '2026-07-10',
  amountCents: -3_000,
  categoryId: 'groceries',
  merchant: 'Costco',
  status: 'POSTED',
  merchantCategoryId: null,
  aggregateMerchant: false,
  accountId: OTHER,
  ...over,
});

const MATCHED: AskTxnRow[] = [
  // The pair's two copies of one real purchase, on the released day.
  askRow({ date: HANDOVER, amountCents: -5_000, accountId: PRED }),
  askRow({ date: HANDOVER, amountCents: -5_000, accountId: SUCC }),
  // An ordinary purchase, another day, unrelated account.
  askRow(),
];

describe('U.20 — merchantSpend counts and marks its released-day rows off ONE predicate', () => {
  it('counts the matched rows on released (account, day) keys, and flags the same rows', () => {
    const res = merchantSpend(MATCHED, TF, 'costco', TODAY, undefined, undefined, KEYS);
    expect(res.totalCents).toBe(13_000);
    expect(res.countedOnHandoverDays).toBe(2);
    // The trace is a second selector over these same rows; the flag riding the
    // row is what keeps the two from diverging.
    expect(res.items.filter((i) => i.onHandoverDay)).toHaveLength(2);
    expect(res.items.find((i) => i.date === '2026-07-10')?.onHandoverDay).toBe(false);
  });

  it('scopes to the PAIR, not the date: another account on the released day carries no claim', () => {
    // The U.16 second-cycle defect, held out of this surface: a released day is
    // an ordinary shopping day on every other account the reader owns.
    const rows = [...MATCHED, askRow({ date: HANDOVER, amountCents: -1_100, accountId: OTHER })];
    const res = merchantSpend(rows, TF, 'costco', TODAY, undefined, undefined, KEYS);
    expect(res.countedOnHandoverDays).toBe(2);
    expect(res.items.filter((i) => i.onHandoverDay)).toHaveLength(2);
  });

  it('a row with no accountId answers FALSE — an unprovable claim about money is not made', () => {
    // The reverse failure is U.16's `toTrendTxns` lesson: a missing account
    // field must degrade to silence about the pair, never to a guess. The row
    // stays counted in the figure either way.
    const rows = [askRow({ date: HANDOVER, accountId: undefined })];
    const res = merchantSpend(rows, TF, 'costco', TODAY, undefined, undefined, KEYS);
    expect(res.totalCents).toBe(3_000);
    expect(res.countedOnHandoverDays).toBe(0);
    expect(res.items[0].onHandoverDay).toBe(false);
  });

  it('regression__u20_zero_hold_is_neither_flagged_nor_counted', () => {
    // Critic cycle (both critics): a released $0 verification hold was flagged
    // and counted, so a CORRECT figure carried a sentence saying it may be
    // wrong — about a row whose doubling moves nothing. The engine comment
    // claimed this exclusion existed before the predicate had it.
    const rows = [...MATCHED, askRow({ date: HANDOVER, amountCents: 0, accountId: PRED })];
    const res = merchantSpend(rows, TF, 'costco', TODAY, undefined, undefined, KEYS);
    expect(res.countedOnHandoverDays).toBe(2);
    expect(res.items.find((i) => i.amountCents === 0)?.onHandoverDay).toBe(false);
    // ...and a hold-only match still gets no note at all.
    const holdOnly = merchantSpend(
      [askRow({ date: HANDOVER, amountCents: 0, accountId: PRED })],
      TF,
      'costco',
      TODAY,
      undefined,
      undefined,
      KEYS,
    );
    expect(holdOnly.countedOnHandoverDays).toBe(0);
  });

  it('regression__u20_negative_net_branches_state_no_direction', () => {
    // Claims critic P1-1, executed against the pre-fix tree: two copies of one
    // $50.00 return rendered "$100.00 came back in refunds" — a figure the
    // doubling made too HIGH — beside "...too LOW when they are returns". The
    // negative-net branches print gross amounts a doubling can only inflate
    // plus an exceedance net a doubled purchase deflates, so their author
    // states the counting rule and no direction at all.
    const refundOnly = merchantSpend(
      [
        askRow({ date: HANDOVER, amountCents: 5_000, accountId: PRED }),
        askRow({ date: HANDOVER, amountCents: 5_000, accountId: SUCC }),
      ],
      TF,
      'costco',
      TODAY,
      undefined,
      undefined,
      KEYS,
    );
    const a = answerMerchantSpend(refundOnly, TF);
    expect(a.headline).toContain('No purchases at');
    expect(a.detail).toContain('2 transactions behind these amounts fall');
    expect(a.detail).toContain('count it once for each');
    expect(a.detail ?? '').not.toContain('too high');
    expect(a.detail ?? '').not.toContain('too LOW');
    expect(a.detail ?? '').not.toContain('in this figure');

    const exceeded = merchantSpend(
      [
        askRow({ date: '2026-07-08', amountCents: -5_000 }),
        askRow({ date: HANDOVER, amountCents: 4_000, accountId: PRED }),
        askRow({ date: HANDOVER, amountCents: 4_000, accountId: SUCC }),
      ],
      TF,
      'costco',
      TODAY,
      undefined,
      undefined,
      KEYS,
    );
    const b = answerMerchantSpend(exceeded, TF);
    expect(b.headline).toContain('exceeded');
    expect(b.detail).toContain('behind these amounts fall');
    expect(b.detail ?? '').not.toContain('too LOW');
  });

  it('with no keys every existing caller keeps byte-identical output', () => {
    const res = merchantSpend(MATCHED, TF, 'costco', TODAY);
    expect(res.countedOnHandoverDays).toBe(0);
    expect(res.items.every((i) => i.onHandoverDay === false)).toBe(true);
  });

  it('the ANSWER qualifies the figure it states, in the answer wording, and only when it applies', () => {
    const marked = merchantSpend(MATCHED, TF, 'costco', TODAY, undefined, undefined, KEYS);
    const a = answerMerchantSpend(marked, TF);
    expect(a.detail).toContain('both connections’ records are kept');
    // The answer author, never the panel's: this list is capped at five with no
    // tally printed beneath it, so "rows here" and the tally clause would both
    // be claims about things that are not on screen.
    expect(a.detail).toContain('in this figure');
    expect(a.detail ?? '').not.toContain('rows here');

    const clean = merchantSpend(MATCHED, TF, 'costco', TODAY);
    expect(answerMerchantSpend(clean, TF).detail ?? '').not.toContain('both connections’ records are kept');
  });

  it('the TRACE marks the rows and states the panel sentence — the U.16 split, closed here', () => {
    // Both U.16 critics independently found the category traces listing the two
    // identical rows unmarked under "✓ N transactions add up to …". This is the
    // same surface shape for merchant_spend, locked from the start.
    const res = merchantSpend(MATCHED, TF, 'costco', TODAY, undefined, undefined, KEYS);
    const t = traceMerchantSpend(res);
    expect(t.reconciled).toBe(true);
    expect(t.rows.filter((r) => r.onHandoverDay)).toHaveLength(2);
    expect(t.basis.some((b) => b.includes('rows here fall'))).toBe(true);

    const clean = traceMerchantSpend(merchantSpend(MATCHED, TF, 'costco', TODAY));
    expect(clean.basis.some((b) => b.includes('both connections’ records are kept'))).toBe(false);
  });
});

// ─── U.20: the register totals ───────────────────────────────────────────────

describe('U.20 — the register summary counts exactly the rows its money figures are summed from', () => {
  const rows: TotalableTxn[] = [
    { isTransfer: false, amountCents: -5_000, onHandoverDay: true }, // counted
    { isTransfer: false, amountCents: -500 }, // ordinary; flag absent
    { isTransfer: true, amountCents: -2_000, onHandoverDay: true }, // transfer: moves no total
    { isTransfer: false, amountCents: -1_000, excludeFromTotals: true, onHandoverDay: true }, // excluded: moves no total
  ];

  it('a released row the totals do not count is not disclosed as moving them', () => {
    const s = summarizeTransactions(rows);
    // A marked transfer and a marked excluded row are facts about DATES; the
    // caption's sentence is about the tiles, and only one marked row reaches
    // them. Disclosing three would be a claim about money that did not move.
    expect(s.countedOnHandoverDays).toBe(1);
    expect(s.count).toBe(4);
    expect(s.outflowCents).toBe(5_500);
  });

  it('the flag is optional on the lean shapes and its absence means NOT released', () => {
    // /calendar totals its days through this same function over rows that never
    // carry the flag; absence must read as "no claim", never as a crash or a
    // guess.
    const s = summarizeTransactions([{ isTransfer: false, amountCents: -700 }]);
    expect(s.countedOnHandoverDays).toBe(0);
  });

  it('the register note names no tile and no direction — the register prints three totals AND counts income', () => {
    const s = handoverDayRegisterTotalsNote(2);
    expect(s).toContain('2 rows counted in these totals fall');
    // regression__u20_register_note_enumeration_missed_deposits (critic cycle,
    // P2-4): the first draft enumerated "in Money out when they are purchases,
    // in Money in when they are returns" — and the register is the one surface
    // that also counts INCOME, so a paycheck both feeds reported doubled Money
    // in while being neither. The exhaustive-by-construction clause replaced it.
    expect(s).toContain('in whichever of these totals its amount feeds');
    expect(s).not.toContain('when they are purchases');
    expect(s).not.toContain('this figure');
    expect(s).not.toMatch(/\btwice\b/);
    expect(s).not.toMatch(/charge/i);
    expect(s).toContain('neither can be shown to have covered the whole of it');
    expect(handoverDayRegisterTotalsNote(1)).toContain('1 row counted in these totals falls');
  });

  it('regression__u20_zero_hold_moves_no_tile_and_gets_no_sentence', () => {
    // Critic cycle (both critics): a $0 verification hold on a released day
    // passes the transfer and excluded gates and is summed — adding zero — so
    // the caption warned about a row whose doubling cannot move any tile.
    const s = summarizeTransactions([
      { isTransfer: false, amountCents: 0, onHandoverDay: true },
      { isTransfer: false, amountCents: -5_000, onHandoverDay: true },
    ]);
    expect(s.countedOnHandoverDays).toBe(1);
    expect(s.count).toBe(2);
  });
});

// ─── U.21: the zero branches ─────────────────────────────────────────────────

/**
 * The shape the U.16 critic executed: one real $30.00 purchase, and one return
 * both feeds reported — so the return is subtracted twice, groceries nets to
 * <= 0, and the figure drops the category entirely.
 */
const ZEROED: ReportTxn[] = [
  { id: 'p', date: '2026-07-05', accountId: OTHER, amountCents: -3_000, categoryId: 'groceries' },
  { id: 'r-old', date: HANDOVER, accountId: PRED, amountCents: 5_000, categoryId: 'groceries' },
  { id: 'r-new', date: HANDOVER, accountId: SUCC, amountCents: 5_000, categoryId: 'groceries' },
];

/** An ordinary refunded purchase — dropped for reasons that are nobody's fault
 *  and MUST NOT be disclosed as a changeover. */
const ORDINARY_DROP: ReportTxn[] = [
  { id: 'd1', date: '2026-07-03', accountId: OTHER, amountCents: -1_000, categoryId: 'dining' },
  { id: 'd2', date: '2026-07-04', accountId: OTHER, amountCents: 2_000, categoryId: 'dining' },
];

describe('U.21 — the engine records the released rows the figure DROPPED, per category', () => {
  it('a category driven to <= 0 that holds released rows appears, with its count and group', () => {
    const b = spendingByCategory(ZEROED, WINDOW, undefined, undefined, KEYS);
    expect(b.totalCents).toBe(0);
    expect(b.byCategory).toHaveLength(0);
    expect(b.countedOnHandoverDays).toBe(0); // summed from survivors — structurally blind here
    expect(b.uncountedOnHandoverDays).toEqual([
      { categoryId: 'groceries', group: CATEGORY_BY_ID.get('groceries')!.group, count: 2 },
    ]);
  });

  it('an ordinary refund-dropped category is NOT in the set — nets hit zero for ordinary reasons too', () => {
    const b = spendingByCategory([...ZEROED, ...ORDINARY_DROP], WINDOW, undefined, undefined, KEYS);
    expect(b.uncountedOnHandoverDays.map((u) => u.categoryId)).toEqual(['groceries']);
  });

  it('a SURVIVING category never appears — its released rows are already in countedOnHandoverDays', () => {
    const survives: ReportTxn[] = [
      { id: 'g1', date: HANDOVER, accountId: PRED, amountCents: -5_000, categoryId: 'groceries' },
      { id: 'g2', date: HANDOVER, accountId: SUCC, amountCents: -5_000, categoryId: 'groceries' },
    ];
    const b = spendingByCategory(survives, WINDOW, undefined, undefined, KEYS);
    expect(b.countedOnHandoverDays).toBe(2);
    expect(b.uncountedOnHandoverDays).toHaveLength(0);
  });

  it('with no combined accounts the field is empty and every zero branch stays clean', () => {
    const b = spendingByCategory([...ZEROED, ...ORDINARY_DROP], WINDOW);
    expect(b.uncountedOnHandoverDays).toHaveLength(0);
    expect(answerSpendTotal(b, TF).detail).toBeUndefined();
  });
});

describe('U.21 — the zero branches disclose what their figure cannot see', () => {
  it('"No spending recorded" over a dropped released category carries the note', () => {
    // This branch's old justification — "a released day can only make a figure
    // too high" — was disproved by the U.16 critic with exactly this shape, and
    // a doubled return is the ONLY way the release reaches this branch.
    const b = spendingByCategory(ZEROED, WINDOW, undefined, undefined, KEYS);
    const a = answerSpendTotal(b, TF);
    expect(a.headline).toBe('No spending recorded this month.');
    expect(a.detail).toContain('both connections’ records are kept');
    expect(a.detail).toContain('2 transactions fall');
  });

  it('the per-target zero branch is scoped to the SUBJECT of the answer', () => {
    const b = spendingByCategory([...ZEROED, ...ORDINARY_DROP], WINDOW, undefined, undefined, KEYS);
    // Groceries was dropped BY released rows: the note fires, named to the subject.
    const groceries = answerSpendByCategory(
      b,
      { type: 'category', categoryId: 'groceries', label: 'groceries' },
      TF,
    );
    expect(groceries.headline).toBe('No groceries spending this month.');
    expect(groceries.detail).toContain('2 transactions in groceries fall');
    // Dining was dropped by an ORDINARY refund: qualifying it with groceries'
    // count would point the reader at rows that have nothing to do with what
    // they asked. Silence is the true answer.
    const dining = answerSpendByCategory(b, { type: 'category', categoryId: 'dining', label: 'dining' }, TF);
    expect(dining.detail).toBeUndefined();
  });

  it('the GROUP zero branch can still find its dropped category — the record carries its own group', () => {
    // A dropped category is absent from `byGroup` as well as `byCategory`, so
    // without the group riding the record this branch had nothing to resolve
    // against.
    const b = spendingByCategory(ZEROED, WINDOW, undefined, undefined, KEYS);
    const a = answerSpendByCategory(
      b,
      { type: 'group', group: CATEGORY_BY_ID.get('groceries')!.group, label: 'food & dining' },
      TF,
    );
    expect(a.detail).toContain('both connections’ records are kept');
  });

  it('top_categories over an emptied breakdown makes the same claim and needs the same note', () => {
    const b = spendingByCategory(ZEROED, WINDOW, undefined, undefined, KEYS);
    const a = answerTopCategories(b, TF, 3);
    expect(a.headline).toBe('No spending recorded this month.');
    expect(a.detail).toContain('both connections’ records are kept');
  });

  it('the TRACE under a zero answer tells the same story through the same predicate', () => {
    // `handoverBasis` counts the CITED rows and a zero answer cites none — a
    // dropped category's rows are exactly what the trace does not list. Without
    // the mirrored note the drawer printed "0 transactions add up to $0.00"
    // while the answer above said rows may be hidden: the answer-path/
    // trace-path split U.16's second cycle caught, one surface over.
    const b = spendingByCategory(ZEROED, WINDOW, undefined, undefined, KEYS);
    const total = traceSpendTotal(b, [], WINDOW, CATEGORY_BY_ID);
    expect(total.rows).toHaveLength(0);
    expect(total.basis.some((s) => s.includes('both connections’ records are kept'))).toBe(true);

    const scoped = traceSpendByCategory(
      b,
      { type: 'category', categoryId: 'groceries', label: 'groceries' },
      [],
      WINDOW,
      CATEGORY_BY_ID,
    );
    expect(scoped.basis.some((s) => s.includes('in groceries'))).toBe(true);

    // …and an ordinary-dropped subject stays clean in the trace too.
    const withDining = spendingByCategory([...ZEROED, ...ORDINARY_DROP], WINDOW, undefined, undefined, KEYS);
    const dining = traceSpendByCategory(
      withDining,
      { type: 'category', categoryId: 'dining', label: 'dining' },
      [],
      WINDOW,
      CATEGORY_BY_ID,
    );
    expect(dining.basis.some((s) => s.includes('both connections’ records are kept'))).toBe(false);
  });
});

describe('U.21 — the no-figure sentence says only what is true', () => {
  it('locates the rows OUTSIDE the figure — the rows are precisely what the figure does not contain', () => {
    const s = handoverDayUncountedNote(2);
    expect(s).toContain('2 transactions fall');
    expect(s).not.toContain('in this figure');
    expect(s).not.toContain('rows here');
  });

  it('names the only direction that can reach a zero branch, as a possibility and never a fact', () => {
    const s = handoverDayUncountedNote(1);
    // Doubling a purchase RAISES a net; only a doubled return can produce this
    // branch — so the sentence names subtraction, and only subtraction.
    expect(s).toContain('subtracted once for each');
    expect(s).toContain('pull a category to zero or below');
    // A category can net to zero for entirely ordinary reasons; asserting the
    // doubling would be the fabrication `buildTaxExport` refuses.
    expect(s).toContain('there may be spending they are not showing');
    expect(s).not.toMatch(/\btwice\b/);
    expect(s).not.toMatch(/charge/i);
  });

  it('regression__u21_note_is_referent_free: no "this figure", because its standings disagree about one', () => {
    // Claims critic P2-1: the first draft said "This figure leaves out…" — no
    // referent under Ask's "No spending recorded" (nothing is printed there),
    // and a wrong one beside the positive totals the rescope added. The
    // sentence now names "Spending figures", true in every standing.
    const s = handoverDayUncountedNote(2);
    expect(s).toContain('Spending figures leave out');
    expect(s).not.toContain('This figure');
    expect(s).not.toContain('rows here');
  });

  it('counts in the reader’s grammar and can name its subject', () => {
    expect(handoverDayUncountedNote(1)).toContain('1 transaction falls');
    expect(handoverDayUncountedNote(3, 'groceries')).toContain('3 transactions in groceries fall');
  });

  it('the AMOUNTS note and the DETAIL note follow the family rules', () => {
    const amounts = handoverDayAmountsNote(1);
    expect(amounts).toContain('1 transaction behind these amounts falls');
    expect(handoverDayAmountsNote(2)).toContain('2 transactions behind these amounts fall');
    expect(amounts).toContain('once for each');
    const detail = handoverDayDetailNote();
    expect(detail).toContain('This transaction is dated on a day');
    // "if both reported" — the doubling stays a conditional on the one surface
    // that shows a single row and could most easily be read as accusing it.
    expect(detail).toContain('if both reported this transaction');
    for (const s of [amounts, detail]) {
      expect(s).not.toMatch(/\btwice\b/);
      expect(s).not.toMatch(/charge/i);
      expect(s).toContain('neither can be shown to have covered the whole of it');
      expect(s).toContain('Nothing has been adjusted');
    }
  });
});

// ─── Critic cycle P1-1: the POSITIVE figures disclose their dropped rows ─────

describe('U.21 rescope — a positive figure over a partially-cancelled breakdown discloses what it lost', () => {
  /** dining survives; groceries is dropped by a doubled released return. The
   *  money critic's executed exhibit: the group answer printed an UNDERSTATED
   *  "You spent $50.00 on Food & Dining" with no note anywhere. */
  const PARTIAL: ReportTxn[] = [
    { id: 'd', date: '2026-07-02', accountId: OTHER, amountCents: -5_000, categoryId: 'dining' },
    { id: 'p', date: '2026-07-05', accountId: OTHER, amountCents: -3_000, categoryId: 'groceries' },
    { id: 'r-old', date: HANDOVER, accountId: PRED, amountCents: 3_500, categoryId: 'groceries' },
    { id: 'r-new', date: HANDOVER, accountId: SUCC, amountCents: 3_500, categoryId: 'groceries' },
  ];

  it('the TOTAL answer qualifies its positive figure', () => {
    const b = spendingByCategory(PARTIAL, WINDOW, undefined, undefined, KEYS);
    expect(b.totalCents).toBe(5_000);
    expect(b.uncountedOnHandoverDays.map((u) => u.categoryId)).toEqual(['groceries']);
    const a = answerSpendTotal(b, TF);
    expect(a.headline).toBe('You spent $50.00 this month.');
    expect(a.detail).toContain('Spending figures leave out');
    expect(a.detail).toContain('2 transactions fall');
  });

  it('the GROUP answer — the executed exhibit — qualifies the figure its dropped member understates', () => {
    const b = spendingByCategory(PARTIAL, WINDOW, undefined, undefined, KEYS);
    const group = CATEGORY_BY_ID.get('groceries')!.group; // dining shares Food & Dining
    const a = answerSpendByCategory(b, { type: 'group', group, label: 'Food & Dining' }, TF);
    expect(a.headline).toContain('You spent $50.00 on Food & Dining');
    expect(a.detail).toContain('2 transactions in Food & Dining fall');
    // ...and an unrelated target still hears nothing (scope, as ever).
    const shopping = answerSpendByCategory(
      b,
      { type: 'category', categoryId: 'dining', label: 'dining' },
      TF,
    );
    expect(shopping.detail ?? '').not.toContain('both connections’ records are kept');
  });

  it('top_categories and the TRACES carry the same fact to the same standings', () => {
    const b = spendingByCategory(PARTIAL, WINDOW, undefined, undefined, KEYS);
    expect(answerTopCategories(b, TF, 3).detail).toContain('Spending figures leave out');
    // The trace is only rendered for a STATED figure (traces attach on
    // headlineCents), so the reachable case is exactly this one — the first
    // draft gated the mirror on the zero conditions, which made it dead code
    // (claims critic P2-2).
    const t = traceSpendTotal(b, [], WINDOW, CATEGORY_BY_ID);
    expect(t.basis.some((s) => s.includes('Spending figures leave out'))).toBe(true);
    const g = traceSpendByCategory(
      b,
      { type: 'group', group: CATEGORY_BY_ID.get('groceries')!.group, label: 'Food & Dining' },
      [],
      WINDOW,
      CATEGORY_BY_ID,
    );
    expect(g.basis.some((s) => s.includes('in Food & Dining'))).toBe(true);
  });

  it('a breakdown with no dropped released rows keeps its pre-slice positive answers, byte-identical', () => {
    const clean = spendingByCategory(PARTIAL, WINDOW);
    const a = answerSpendTotal(clean, TF);
    expect(a.detail).toBe(
      "Purchases only — transfers and income are excluded, and anything dated after today isn't counted yet.",
    );
  });
});
