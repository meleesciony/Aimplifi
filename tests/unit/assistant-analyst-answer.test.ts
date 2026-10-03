/**
 * The words of a same-account comparison / average. Figures come from the engine
 * (tested in analyst-same-account.test.ts); this pins what the reader is told about
 * them: the reading, the accounts it is on, every account left out and why, the one
 * assumption, and the questions.
 */
import { describe, expect, it } from 'vitest';
import { isoDate, type ISODate } from '@/lib/dates';
import {
  averageSameAccounts,
  compareSameAccounts,
  type AccountRecord,
  type Period,
} from '@/lib/engine/analyst/same-account';
import type { SpendFigure } from '@/lib/engine/analyst/spend-figure';
import { answerSpendAverage, answerSpendCompare, MAX_ACCOUNT_QUESTIONS } from '@/lib/engine/assistant/answer-analyst';

const d = isoDate;
const TODAY = d('2026-10-12');
const month = (ym: string, last: number): Period => ({ start: d(`${ym}-01`), end: d(`${ym}-${last}`) });
const JUL = month('2026-07', 31);
const AUG = month('2026-08', 31);
const SEP = month('2026-09', 30);

interface Row {
  accountId: string;
  date: ISODate;
  cents: number;
  key: string;
}
const row = (accountId: string, date: string, cents: number, key: string): Row => ({ accountId, date: d(date), cents, key });
const LABEL: Record<string, string> = { dining: 'Dining Out', groceries: 'Groceries', rent: 'Rent' };

/** A figure shaped like the app's: by category, a net refund dropped. `handover` rides along. */
const figure =
  (handover = 0) =>
  (rows: readonly Row[], p: Period): SpendFigure => {
    const by = new Map<string, number>();
    for (const x of rows) if (x.date >= p.start && x.date <= p.end) by.set(x.key, (by.get(x.key) ?? 0) + x.cents);
    const groups = [...by].filter(([, c]) => c > 0).map(([key, cents]) => ({ key, label: LABEL[key] ?? key, cents }));
    return {
      totalCents: groups.reduce((n, g) => n + g.cents, 0),
      groups,
      countedOnHandoverDays: groups.length > 0 ? handover : 0,
      uncountedOnHandoverDays: 0,
    };
  };

const account = (id: string, name: string, over: Partial<AccountRecord> = {}): AccountRecord => ({
  id,
  name,
  lineageId: id,
  firstRowDate: d('2025-01-03'),
  lastRowDate: d('2026-10-10'),
  completeThrough: d('2026-10-11'),
  feed: 'live',
  startWord: null,
  endWord: null,
  everSpent: true,
  handKept: false,
  ...over,
});
const CHK = account('chk', 'Checking');
const CARD = account('card', 'Sapphire');
const OLD = account('old', 'Freedom', { lastRowDate: d('2026-08-14'), completeThrough: null, feed: 'none' });
const NEW = account('new', 'Venture', { firstRowDate: d('2026-09-10') });

const ROWS = [
  row('chk', '2026-08-01', 150000, 'rent'),
  row('chk', '2026-08-03', 30000, 'groceries'),
  row('chk', '2026-09-01', 150000, 'rent'),
  row('chk', '2026-09-04', 34500, 'groceries'),
  row('card', '2026-08-20', 12000, 'dining'),
  row('card', '2026-08-22', 8000, 'groceries'),
  row('card', '2026-09-15', 19000, 'dining'),
  row('old', '2026-08-10', 4000, 'dining'),
  row('new', '2026-09-12', 7000, 'dining'),
];
const rowsOf = (accounts: AccountRecord[]) => ROWS.filter((r) => accounts.some((a) => a.id === r.accountId));

const compare = (accounts: AccountRecord[], opts: { target?: string | null; handover?: number; today?: ISODate; current?: Period; baseline?: Period; ym?: [string, string] } = {}) => {
  const today = opts.today ?? TODAY;
  const result = compareSameAccounts({
    rows: rowsOf(accounts),
    accounts,
    current: opts.current ?? SEP,
    baseline: opts.baseline ?? AUG,
    today,
    figure: figure(opts.handover ?? 0),
  });
  const [currentYm, baselineYm] = opts.ym ?? ['2026-09', '2026-08'];
  return answerSpendCompare({ result, currentYm, baselineYm, targetLabel: opts.target ?? null, today });
};

describe('answerSpendCompare', () => {
  it('more: the figure, the difference, the other month, the percent', () => {
    const a = compare([CHK, CARD]);
    expect(a.kind).toBe('spend_compare');
    // Aug 150000 + 30000 + 12000 + 8000 = 200000; Sep 150000 + 34500 + 19000 = 203500; +3500 = 1.75% → 2
    expect(a.headline).toBe('You spent $2,035.00 in September 2026 — $35.00 more than in August 2026 ($2,000.00). That is 2% higher.');
    expect(a.detail).toBe(
      "Reading: All spending, September 2026 against August 2026, on all 2 accounts you spend from. Purchases only — transfers and income are excluded. It assumes each account's record has no gaps between its first and last transaction.",
    );
    expect(a.accountQuestions).toBeUndefined();
  });

  it('lists the groups that moved, largest change first, and not the one that did not', () => {
    // The change in the figure's place; its two months in the label, which can wrap on a phone.
    expect(compare([CHK, CARD]).facts).toEqual([
      { label: 'Dining Out ($190.00 vs $120.00)', value: '+$70.00' },
      { label: 'Groceries ($345.00 vs $380.00)', value: '-$35.00' },
    ]);
  });

  it('less, and a percent of zero is not printed', () => {
    const less = compareSameAccounts({ rows: rowsOf([CHK, CARD]), accounts: [CHK, CARD], current: AUG, baseline: SEP, today: TODAY, figure: figure() });
    const a = answerSpendCompare({ result: less, currentYm: '2026-08', baselineYm: '2026-09', targetLabel: null, today: TODAY });
    expect(a.headline).toBe('You spent $2,000.00 in August 2026 — $35.00 less than in September 2026 ($2,035.00). That is 2% lower.');
    const tiny = [row('chk', '2026-08-05', 100000, 'rent'), row('chk', '2026-09-05', 100001, 'rent')];
    const r = compareSameAccounts({ rows: tiny, accounts: [CHK], current: SEP, baseline: AUG, today: TODAY, figure: figure() });
    expect(answerSpendCompare({ result: r, currentYm: '2026-09', baselineYm: '2026-08', targetLabel: null, today: TODAY }).headline).toBe(
      'You spent $1,000.01 in September 2026 — $0.01 more than in August 2026 ($1,000.00).',
    );
  });

  it('the same, nothing against something, and nothing at all', () => {
    const run = (rows: Row[], target: string | null = 'Dining Out') =>
      answerSpendCompare({
        result: compareSameAccounts({ rows, accounts: [CHK], current: SEP, baseline: AUG, today: TODAY, figure: figure() }),
        currentYm: '2026-09',
        baselineYm: '2026-08',
        targetLabel: target,
        today: TODAY,
      }).headline;
    expect(run([row('chk', '2026-08-05', 5000, 'dining'), row('chk', '2026-09-05', 5000, 'dining')])).toBe(
      'You spent $50.00 on Dining Out in September 2026 — the same as in August 2026.',
    );
    // No percent against a baseline of zero.
    expect(run([row('chk', '2026-09-05', 5000, 'dining')])).toBe(
      'You spent $50.00 on Dining Out in September 2026 — $50.00 more than in August 2026 ($0.00).',
    );
    expect(run([])).toBe('No spending on Dining Out in September 2026 or August 2026.');
    expect(run([], null)).toBe('No spending in September 2026 or August 2026.');
  });

  it('names every account left out, with what it has on record and why, and asks the questions that would let it in', () => {
    const a = compare([CHK, CARD, OLD, NEW]);
    // The figures are unchanged — the left-out accounts are in neither side — but the
    // headline says whose they are: it is not the reader's total (critic cycle 1, P1-1).
    expect(a.headline).toBe(
      'On the 2 accounts with complete records, you spent $2,035.00 in September 2026 — $35.00 more than in August 2026 ($2,000.00). That is 2% higher.',
    );
    expect(a.detail).toContain('on the 2 accounts with complete records for both months.');
    // Each one in the sentence, with what it has on record and why — never as a fact row,
    // whose figure slot cannot hold a reason on a phone (it ran off a 380px screen).
    expect(a.detail).toContain(
      'Left out of both months, because their records do not cover both: ' +
        'Venture ($70.00 in September 2026, $0.00 in August 2026; its records start Sep 10, 2026); ' +
        'Freedom ($0.00 in September 2026, $40.00 in August 2026; nothing on record after Aug 14, 2026).',
    );
    expect(a.facts.map((f) => f.label)).toEqual(['Dining Out ($190.00 vs $120.00)', 'Groceries ($345.00 vs $380.00)']);
    expect(a.facts.some((f) => /Left out/.test(f.label) || /—/.test(f.value))).toBe(false);
    expect(a.accountQuestions).toEqual([
      {
        accountId: 'new',
        edge: 'start',
        date: '2026-09-10',
        prompt: 'Is Sep 10, 2026 when you opened Venture? That is its first transaction on record.',
        yesLabel: 'Yes, that is when it began',
        noLabel: 'No, I had it before',
      },
      {
        accountId: 'old',
        edge: 'end',
        date: '2026-08-14',
        prompt: 'Is Aug 14, 2026 the last time Freedom was used? That is its last transaction on record.',
        yesLabel: 'Yes, nothing since',
        noLabel: 'No, there is more',
      },
    ]);
  });

  it('says why without asking when a question cannot settle it', () => {
    const failing = { ...CARD, lastRowDate: d('2026-09-18'), completeThrough: d('2026-09-20'), feed: 'failing' as const };
    const a = compare([CHK, failing]);
    expect(a.detail).toContain(
      'Left out of both months, because their records do not cover both: ' +
        'Sapphire ($190.00 in September 2026, $200.00 in August 2026; its bank connection is not updating — on record through Sep 20, 2026).',
    );
    expect(a.accountQuestions).toBeUndefined();
    const told = { ...OLD, endWord: { forDate: d('2026-08-14'), verdict: 'missing' as const } };
    const b = compare([CHK, told]);
    expect(b.detail).toContain(
      'Freedom ($0.00 in September 2026, $40.00 in August 2026; nothing on record after Aug 14, 2026, and you told us there is more).',
    );
    expect(b.accountQuestions).toBeUndefined();
  });

  it('when no account is whole it prints no figure at all', () => {
    const a = compare([OLD, NEW]);
    expect(a.headline).toBe("I can't compare September 2026 with August 2026 yet — no account has complete records for both months.");
    expect(a.headline).not.toMatch(/\$/);
    expect(a.accountQuestions).toHaveLength(2);
  });

  it(`asks at most ${MAX_ACCOUNT_QUESTIONS} questions, only about the accounts it names, and counts the ones it does not list`, () => {
    // Five new cards, each with one charge in September (largest first: Card 4 … Card 0).
    const many = Array.from({ length: 5 }, (_, i) => account(`n${i}`, `Card ${i}`, { firstRowDate: d('2026-09-10') }));
    const rows = [...rowsOf([CHK]), ...many.map((m, i) => row(m.id, '2026-09-12', 1000 * (i + 1), 'dining'))];
    const result = compareSameAccounts({ rows, accounts: [CHK, ...many], current: SEP, baseline: AUG, today: TODAY, figure: figure() });
    const a = answerSpendCompare({ result, currentYm: '2026-09', baselineYm: '2026-08', targetLabel: null, today: TODAY });
    expect(a.accountQuestions!.map((q) => q.accountId)).toEqual(['n4', 'n3', 'n2']);
    expect(a.detail).toContain(
      'Card 4 ($50.00 in September 2026, $0.00 in August 2026; its records start Sep 10, 2026); ' +
        'Card 3 ($40.00 in September 2026, $0.00 in August 2026; its records start Sep 10, 2026); ' +
        'Card 2 ($30.00 in September 2026, $0.00 in August 2026; its records start Sep 10, 2026); and 2 more.',
    );
    expect(a.detail).not.toContain('Card 1');
  });

  it('a left-out account holding only a refund is not "nothing on record", and is asked about', () => {
    // critic cycle 2, P2-2: its own figure is $0 (a net refund drops), but letting it in moves the figure.
    const refunded = account('rf', 'Old Card', { lastRowDate: d('2026-09-08'), completeThrough: null, feed: 'none' });
    const rows = [...rowsOf([CHK]), row('rf', '2026-09-08', -4000, 'dining')];
    const result = compareSameAccounts({ rows, accounts: [CHK, refunded], current: SEP, baseline: AUG, today: TODAY, figure: figure() });
    const a = answerSpendCompare({ result, currentYm: '2026-09', baselineYm: '2026-08', targetLabel: null, today: TODAY });
    expect(a.detail).toContain('Old Card ($0.00 in September 2026, $0.00 in August 2026; nothing on record after Sep 8, 2026)');
    expect(a.accountQuestions!.map((q) => [q.accountId, q.edge])).toEqual([['rf', 'end']]);
  });

  it('asks nothing about an account whose answer could not change the figure', () => {
    // Nothing on record in either month: whatever the reader says, it would come in at $0.
    const idle = account('idle', 'Idle Card', { firstRowDate: d('2026-09-10') });
    const a = compare([CHK, idle]);
    expect(a.detail).toContain('Idle Card (no spending on record in either month; its records start Sep 10, 2026)');
    expect(a.accountQuestions).toBeUndefined();
  });

  it('names a stretch that is on neither of a combined card\'s two records', () => {
    const f1 = account('f1', 'Freedom (old)', { lineageId: 'f', lastRowDate: d('2026-08-14'), completeThrough: null, feed: 'none' });
    const f2 = account('f2', 'Freedom Unlimited', { lineageId: 'f', firstRowDate: d('2026-09-05') });
    const rows = [...rowsOf([CHK]), row('f1', '2026-08-10', 4000, 'dining'), row('f2', '2026-09-09', 3100, 'dining')];
    const result = compareSameAccounts({ rows, accounts: [CHK, f1, f2], current: SEP, baseline: AUG, today: TODAY, figure: figure() });
    const a = answerSpendCompare({ result, currentYm: '2026-09', baselineYm: '2026-08', targetLabel: null, today: TODAY });
    expect(a.detail).toContain(
      'Freedom Unlimited ($31.00 in September 2026, $40.00 in August 2026; nothing on record from Aug 15, 2026 to Sep 4, 2026, between Freedom (old) and Freedom Unlimited).',
    );
    expect(a.accountQuestions!.map((q) => [q.accountId, q.edge])).toEqual([
      ['f2', 'start'],
      ['f1', 'end'],
    ]);
  });

  it('a month in progress, compared day for day: says which days, and that the newest can still grow', () => {
    // Today Oct 12: the first 11 days of October against the first 11 of September.
    const OCT11: Period = { start: d('2026-10-01'), end: d('2026-10-11') };
    const SEP11: Period = { start: d('2026-09-01'), end: d('2026-09-11') };
    const rows = [row('chk', '2026-09-01', 150000, 'rent'), row('chk', '2026-09-04', 34500, 'groceries'), row('chk', '2026-10-01', 150000, 'rent')];
    const result = compareSameAccounts({ rows, accounts: [CHK], current: OCT11, baseline: SEP11, today: TODAY, figure: figure() });
    const a = answerSpendCompare({ result, currentYm: '2026-10', baselineYm: '2026-09', soFarDays: 11, targetLabel: null, today: TODAY });
    expect(a.headline).toBe(
      'You spent $1,500.00 in the first 11 days of October 2026 — $345.00 less than in the first 11 days of September 2026 ($1,845.00). That is 19% lower.',
    );
    expect(a.detail).toContain(
      'October 2026 is not over, so this compares its first 11 days with the same days of September 2026. Charges from the last few days can still post.',
    );
    expect(a.detail).not.toMatch(/ended/);
  });

  it('says so when an included account is kept by hand, and when the later month has only just ended', () => {
    const cash = account('cash', 'Cash', { handKept: true, feed: 'none', completeThrough: null });
    expect(compare([CHK, cash]).detail).toContain('Cash is kept by hand, so its part of this counts what has been entered.');
    expect(compare([CHK, CARD]).detail).not.toMatch(/ended/);
    const soon = compare([account('chk', 'Checking', { lastRowDate: d('2026-10-02'), completeThrough: d('2026-10-02') })], { today: d('2026-10-03') });
    expect(soon.detail).toContain('September 2026 ended 3 days ago — charges that post late can still land in it.');
  });

  it('carries the app’s own note when a combined pair of accounts may have counted a charge twice', () => {
    expect(compare([CHK, CARD], { handover: 1 }).detail).toContain('2 transactions in this figure fall');
  });

  it('a month still in progress, or the same month twice: says so, with no figure', () => {
    const live = compareSameAccounts({ rows: [], accounts: [CHK], current: month('2026-10', 31), baseline: SEP, today: TODAY, figure: figure() });
    const a = answerSpendCompare({ result: live, currentYm: '2026-10', baselineYm: '2026-09', targetLabel: null, today: TODAY });
    expect(a).toEqual({ kind: 'spend_compare', headline: 'October 2026 has no finished day yet — from tomorrow I can compare it day for day.', facts: [] });
    // …whichever side the unfinished month is on.
    const b = compareSameAccounts({ rows: [], accounts: [CHK], current: SEP, baseline: month('2026-10', 31), today: TODAY, figure: figure() });
    expect(answerSpendCompare({ result: b, currentYm: '2026-09', baselineYm: '2026-10', targetLabel: null, today: TODAY }).headline).toContain('October 2026 has no finished day yet');
    const same = compareSameAccounts({ rows: [], accounts: [CHK], current: SEP, baseline: SEP, today: TODAY, figure: figure() });
    expect(answerSpendCompare({ result: same, currentYm: '2026-09', baselineYm: '2026-09', targetLabel: null, today: TODAY }).headline).toBe(
      'Those are the same month — name two different months and I will compare them.',
    );
  });
});

describe('answerSpendAverage', () => {
  const rows = [
    row('chk', '2026-07-10', 100000, 'groceries'),
    row('chk', '2026-08-10', 110001, 'groceries'),
    row('chk', '2026-09-10', 120000, 'groceries'),
    row('new', '2026-09-12', 7000, 'dining'),
  ];
  const average = (accounts: AccountRecord[], target: string | null = null) =>
    answerSpendAverage({
      result: averageSameAccounts({
        rows: rows.filter((r) => accounts.some((a) => a.id === r.accountId)),
        accounts,
        months: [JUL, AUG, SEP],
        today: TODAY,
        figure: figure(),
      }),
      fromYm: '2026-07',
      toYm: '2026-09',
      months: 3,
      targetLabel: target,
      today: TODAY,
    });

  it('the mean, the months it is made of, and its reading', () => {
    const a = average([CHK]);
    // (100000 + 110001 + 120000) / 3 = 110000.33 → 110000
    expect(a.headline).toBe('You spent an average of $1,100.00 a month over the last 3 months (July 2026 to September 2026).');
    expect(a.facts).toEqual([
      { label: 'July 2026', value: '$1,000.00' },
      { label: 'August 2026', value: '$1,100.01' },
      { label: 'September 2026', value: '$1,200.00' },
    ]);
    expect(a.detail).toContain('Reading: All spending, the monthly average over the 3 finished months July 2026 to September 2026, on the 1 account you spend from.');
  });

  it('leaves out an account whose record does not cover the whole run, and asks', () => {
    const a = average([CHK, NEW], 'Groceries');
    expect(a.headline).toBe(
      'On the 1 account with complete records, you spent an average of $1,100.00 a month on Groceries over the last 3 months (July 2026 to September 2026).',
    );
    expect(a.detail).toContain(
      'Left out, because their records do not cover all 3 months: Venture ($70.00 on record across these months; its records start Sep 10, 2026).',
    );
    // The fact list is the months the mean is made of, and nothing else.
    expect(a.facts.map((f) => f.label)).toEqual(['July 2026', 'August 2026', 'September 2026']);
    expect(a.accountQuestions).toHaveLength(1);
  });

  it('nothing spent, and no account whole', () => {
    expect(answerSpendAverage({
      result: averageSameAccounts({ rows: [], accounts: [CHK], months: [JUL, AUG, SEP], today: TODAY, figure: figure() }),
      fromYm: '2026-07',
      toYm: '2026-09',
      months: 3,
      targetLabel: 'Dining Out',
      today: TODAY,
    }).headline).toBe('No spending on Dining Out from July 2026 to September 2026.');
    const none = average([NEW]);
    expect(none.headline).toBe("I can't average July 2026 to September 2026 yet — no account has complete records for all 3 months.");
    expect(none.headline).not.toMatch(/\$/);
  });

  it('says "the last N months" only while they are, and refuses an unfinished month as an average', () => {
    // The same answer re-asked in November (an account question answered later): its months
    // are no longer the latest, so it names them instead (critic cycle 1, P2-4).
    const later = answerSpendAverage({
      result: averageSameAccounts({ rows: rows.filter((r) => r.accountId === 'chk'), accounts: [CHK], months: [JUL, AUG, SEP], today: TODAY, figure: figure() }),
      fromYm: '2026-07',
      toYm: '2026-09',
      months: 3,
      targetLabel: null,
      today: d('2026-11-03'),
    });
    expect(later.headline).toBe('You spent an average of $1,100.00 a month over the 3 months July 2026 to September 2026.');
    const unfinished = answerSpendAverage({
      result: averageSameAccounts({ rows: [], accounts: [CHK], months: [AUG, SEP], today: d('2026-09-20'), figure: figure() }),
      fromYm: '2026-08',
      toYm: '2026-09',
      months: 2,
      targetLabel: null,
      today: d('2026-09-20'),
    });
    expect(unfinished.headline).toBe('I can only average months that have finished, and September 2026 is still in progress.');
  });
});
