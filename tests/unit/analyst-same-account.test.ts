/**
 * Same-account comparison engine — known-answer tests. Every expected value is derived
 * by hand in tests/edge-cases/ask-same-account-comparison.md (indexed in
 * docs/EDGE_CASES.md); the section letters below are that file's.
 */
import { describe, expect, it } from 'vitest';
import { addDays, compareDates, daysBetween, isoDate, type ISODate } from '@/lib/dates';
import {
  averageSameAccounts,
  compareSameAccounts,
  type AccountRecord,
  type Figure,
  type Period,
} from '@/lib/engine/analyst/same-account';

/** A test row: `cents` positive for money out, a refund negative. */
interface SpendRow {
  accountId: string;
  date: ISODate;
  cents: number;
  key: string;
  label: string;
}

const inPeriod = (x: SpendRow, p: Period) => compareDates(p.start, x.date) <= 0 && compareDates(x.date, p.end) <= 0;

/**
 * The plainest possible figure: add the rows up, by group. (The app passes its own —
 * `spendingByCategory` — which nets within a category and drops a net refund; §J
 * runs a figure of that shape through the engine too.)
 */
const linear = (rows: readonly SpendRow[], p: Period): Figure => {
  const groups = new Map<string, { key: string; label: string; cents: number }>();
  for (const x of rows) {
    if (!inPeriod(x, p)) continue;
    const g = groups.get(x.key) ?? { key: x.key, label: x.label, cents: 0 };
    g.cents += x.cents;
    groups.set(x.key, g);
  }
  return { totalCents: [...groups.values()].reduce((n, g) => n + g.cents, 0), groups: [...groups.values()] };
};

const d = isoDate;
const TODAY = d('2026-10-02');
const AUG: Period = { start: d('2026-08-01'), end: d('2026-08-31') };
const SEP: Period = { start: d('2026-09-01'), end: d('2026-09-30') };

const account = (id: string, name: string, over: Partial<AccountRecord> = {}): AccountRecord => ({
  id,
  name,
  lineageId: id,
  firstRowDate: d('2025-01-03'),
  lastRowDate: d('2026-10-01'),
  completeThrough: d('2026-10-01'),
  feed: 'live',
  startWord: null,
  endWord: null,
  everSpent: true,
  handKept: false,
  ...over,
});

const row = (accountId: string, date: string, cents: number, key: string): SpendRow => ({
  accountId,
  date: d(date),
  cents,
  key,
  label: key[0]!.toUpperCase() + key.slice(1),
});

// §A — the household every case below starts from.
const CHK = account('chk', 'Checking');
const CARD = account('card', 'Sapphire', { firstRowDate: d('2025-02-10'), lastRowDate: d('2026-09-28') });
const OLD = account('old', 'Freedom', {
  firstRowDate: d('2025-01-05'),
  lastRowDate: d('2026-08-14'),
  completeThrough: null,
  feed: 'none',
});
const NEW = account('new', 'Venture', { firstRowDate: d('2026-09-10'), lastRowDate: d('2026-09-29') });
const SAV = account('sav', 'Savings', { everSpent: false });
const ACCOUNTS = [CHK, CARD, OLD, NEW, SAV];

const ROWS: SpendRow[] = [
  row('chk', '2026-08-03', 30000, 'groceries'),
  row('chk', '2026-08-01', 150000, 'rent'),
  row('chk', '2026-09-04', 34500, 'groceries'),
  row('chk', '2026-09-01', 150000, 'rent'),
  row('card', '2026-08-20', 12000, 'dining'),
  row('card', '2026-08-22', 8000, 'groceries'),
  row('card', '2026-09-15', 20550, 'dining'),
  row('card', '2026-09-18', -1550, 'dining'), // a refund nets its own group down
  row('old', '2026-08-10', 4000, 'dining'),
  row('new', '2026-09-12', 7000, 'dining'),
  row('chk', '2026-07-31', 99999, 'groceries'), // outside both periods: ignored
  row('chk', '2026-10-01', 88888, 'groceries'),
];

/** Compares on the given accounts, with the rows that belong to them (a household is its accounts AND their rows). */
const compare = (accounts: AccountRecord[], all: SpendRow[] = ROWS, current = SEP, baseline = AUG, today = TODAY) => {
  const rows = all.filter((x) => accounts.some((a) => a.id === x.accountId));
  const r = compareSameAccounts({ rows, accounts, current, baseline, today, figure: linear });
  if (!r.ok) throw new Error(`refused: ${r.refusal}`);
  return r;
};

describe('compareSameAccounts — §A the base household', () => {
  const r = compare(ACCOUNTS);

  it('sums only the accounts whole on both sides', () => {
    expect(r.included.map((a) => a.name)).toEqual(['Checking', 'Sapphire']);
    expect(r.baselineCents).toBe(200000); // 30000 + 150000 + 12000 + 8000
    expect(r.currentCents).toBe(203500); // 34500 + 150000 + 20550 − 1550
    expect(r.deltaCents).toBe(3500);
    expect(r.percent).toBe(2); // 3500 / 200000 = 1.75% → 2
  });

  it('breaks the change down by group, and the groups sum to the change', () => {
    expect(r.drivers).toEqual([
      { key: 'dining', label: 'Dining', currentCents: 19000, baselineCents: 12000, deltaCents: 7000 },
      { key: 'groceries', label: 'Groceries', currentCents: 34500, baselineCents: 38000, deltaCents: -3500 },
      { key: 'rent', label: 'Rent', currentCents: 150000, baselineCents: 150000, deltaCents: 0 },
    ]);
    expect(r.drivers.reduce((n, g) => n + g.deltaCents, 0)).toBe(r.deltaCents);
  });

  it('leaves out — never prices at $0 — an account whose record stops or starts inside the question', () => {
    expect(r.leftOut).toEqual([
      {
        lineageId: 'new',
        name: 'Venture',
        handKept: false,
        currentCents: 7000,
        baselineCents: 0,
        rowsInPeriods: 1, // Sep 12
        reasons: [{ edge: 'start', date: '2026-09-10', told: false }],
        questions: [{ accountId: 'new', accountName: 'Venture', edge: 'start', date: '2026-09-10' }],
      },
      {
        lineageId: 'old',
        name: 'Freedom',
        handKept: false,
        currentCents: 0,
        baselineCents: 4000,
        rowsInPeriods: 1, // Aug 10
        reasons: [{ edge: 'end', through: '2026-08-14', feed: 'none', told: false }],
        questions: [{ accountId: 'old', accountName: 'Freedom', edge: 'end', date: '2026-08-14' }],
      },
    ]);
  });

  it('says nothing about an account that has never spent', () => {
    expect([...r.included, ...r.leftOut].some((a) => a.name === 'Savings')).toBe(false);
  });

  it('accounts for every row in the two periods exactly once', () => {
    const onRecord = [...r.included, ...r.leftOut].reduce((n, a) => n + a.currentCents + a.baselineCents, 0);
    expect(onRecord).toBe(200000 + 203500 + 4000 + 7000);
  });
});

describe('compareSameAccounts — §B the reader\'s word', () => {
  it('lets an account in once the reader says its edge is real', () => {
    const r = compare([
      CHK,
      CARD,
      { ...OLD, endWord: { forDate: d('2026-08-14'), verdict: 'real' } },
      { ...NEW, startWord: { forDate: d('2026-09-10'), verdict: 'real' } },
    ]);
    expect(r.leftOut).toEqual([]);
    expect(r.baselineCents).toBe(204000); // 200000 + Freedom's 4000
    expect(r.currentCents).toBe(210500); // 203500 + Venture's 7000
    expect(r.deltaCents).toBe(6500);
    expect(r.percent).toBe(3); // 6500 / 204000 = 3.19% → 3
    expect(r.drivers[0]).toEqual({ key: 'dining', label: 'Dining', currentCents: 26000, baselineCents: 16000, deltaCents: 10000 });
  });

  it('ignores a word given for a different edge date — a later row voids it — and asks again', () => {
    const r = compare([CHK, CARD, { ...OLD, endWord: { forDate: d('2026-08-10'), verdict: 'real' } }]);
    expect(r.leftOut.map((a) => a.name)).toEqual(['Freedom']);
    expect(r.leftOut[0]!.questions).toHaveLength(1);
  });

  it('keeps an account out, and stops asking, once the reader says records are missing', () => {
    const r = compare([CHK, CARD, { ...OLD, endWord: { forDate: d('2026-08-14'), verdict: 'missing' } }]);
    expect(r.leftOut[0]!.reasons).toEqual([{ edge: 'end', through: '2026-08-14', feed: 'none', told: true }]);
    expect(r.leftOut[0]!.questions).toEqual([]);
    expect(r.baselineCents).toBe(200000);
  });

  it('a start word does not excuse a missing end, nor the reverse', () => {
    const r = compare([CHK, { ...OLD, startWord: { forDate: d('2025-01-05'), verdict: 'real' } }]);
    expect(r.leftOut.map((a) => a.name)).toEqual(['Freedom']);
  });
});

describe('compareSameAccounts — §C the feed', () => {
  it('a live feed that succeeded through the period makes silence real', () => {
    // Sapphire's last row is Sep 28; its feed succeeded Oct 1. Nothing happened Sep 29–30.
    expect(compare([CHK, CARD]).included.map((a) => a.name)).toContain('Sapphire');
  });

  it('a failing feed is left out through its last success, and no question is asked', () => {
    const failing = { ...CARD, lastRowDate: d('2026-09-18'), completeThrough: d('2026-09-20'), feed: 'failing' as const };
    const r = compare([CHK, failing]);
    expect(r.leftOut).toEqual([
      {
        lineageId: 'card',
        name: 'Sapphire',
        handKept: false,
        currentCents: 19000,
        baselineCents: 20000,
        rowsInPeriods: 4, // Aug 20, Aug 22, Sep 15, Sep 18
        reasons: [{ edge: 'end', through: '2026-09-20', feed: 'failing', told: false }],
        questions: [],
      },
    ]);
    expect(r.currentCents).toBe(184500); // Checking alone: 34500 + 150000
    expect(r.baselineCents).toBe(180000); // 30000 + 150000
  });

  it('a live feed that has not yet succeeded past the period end is left out, unasked', () => {
    const early = { ...CARD, completeThrough: d('2026-09-29') };
    const r = compare([CHK, early]);
    expect(r.leftOut[0]!.reasons).toEqual([{ edge: 'end', through: '2026-09-29', feed: 'live', told: false }]);
    expect(r.leftOut[0]!.questions).toEqual([]);
  });
});

describe('compareSameAccounts — §D the edges, to the day', () => {
  const only = (over: Partial<AccountRecord>) => compare([account('a', 'A', { completeThrough: null, feed: 'none', ...over })], []);

  it('a first row on the first day of the earlier period is in; one day later is out', () => {
    expect(only({ firstRowDate: d('2026-08-01') }).included).toHaveLength(1);
    expect(only({ firstRowDate: d('2026-08-02') }).leftOut[0]!.reasons).toEqual([{ edge: 'start', date: '2026-08-02', told: false }]);
  });

  it('a last row on the last day of the later period is in; one day earlier is out', () => {
    expect(only({ lastRowDate: d('2026-09-30') }).included).toHaveLength(1);
    expect(only({ lastRowDate: d('2026-09-29') }).leftOut[0]!.reasons).toEqual([
      { edge: 'end', through: '2026-09-29', feed: 'none', told: false },
    ]);
  });

  it('an account can fail both edges: two reasons, two questions', () => {
    const r = only({ firstRowDate: d('2026-08-05'), lastRowDate: d('2026-09-20') });
    expect(r.leftOut[0]!.reasons.map((x) => x.edge)).toEqual(['start', 'end']);
    expect(r.leftOut[0]!.questions.map((x) => x.edge)).toEqual(['start', 'end']);
  });

  it('asks nothing of the months between the two periods', () => {
    // May against March. An account with no row at all in April is whole for both.
    const may: Period = { start: d('2026-05-01'), end: d('2026-05-31') };
    const mar: Period = { start: d('2026-03-01'), end: d('2026-03-31') };
    const quiet = account('q', 'Quiet', { firstRowDate: d('2026-02-27'), lastRowDate: d('2026-06-01'), completeThrough: null, feed: 'none' });
    const rows = [row('q', '2026-03-15', 5000, 'fuel'), row('q', '2026-05-15', 6500, 'fuel')];
    const r = compare([quiet], rows, may, mar);
    expect([r.baselineCents, r.currentCents, r.deltaCents, r.percent]).toEqual([5000, 6500, 1500, 30]);
  });

  it('gives no percent against a baseline of zero or less', () => {
    expect(compare([CHK], [row('chk', '2026-09-05', 100, 'x')]).percent).toBeNull();
    expect(compare([CHK], [row('chk', '2026-08-05', -100, 'x'), row('chk', '2026-09-05', 100, 'x')]).percent).toBeNull();
  });

  it('rounds the percent half away from zero', () => {
    // +1 on 200 = 0.5% → 1; −1 on 200 = −0.5% → −1; +1 on 201 = 0.4975% → 0.
    expect(compare([CHK], [row('chk', '2026-08-05', 200, 'x'), row('chk', '2026-09-05', 201, 'x')]).percent).toBe(1);
    expect(compare([CHK], [row('chk', '2026-08-05', 200, 'x'), row('chk', '2026-09-05', 199, 'x')]).percent).toBe(-1);
    expect(compare([CHK], [row('chk', '2026-08-05', 201, 'x'), row('chk', '2026-09-05', 202, 'x')]).percent).toBe(0);
  });
});

describe('compareSameAccounts — §E one account, two records', () => {
  // Freedom's old connection stopped Aug 14; the connection that replaced it has rows from
  // Aug 12. The reader confirmed they are the same card, so they share a lineage.
  const successor = account('old2', 'Freedom Unlimited', {
    lineageId: 'old',
    firstRowDate: d('2026-08-12'),
    lastRowDate: d('2026-09-30'),
  });
  const rows = [...ROWS, row('old2', '2026-08-25', 2500, 'dining'), row('old2', '2026-09-09', 3100, 'dining')];
  const r = compare([CHK, CARD, OLD, successor], rows);

  it('reads the two as one whole record, under the name it carries now', () => {
    expect(r.leftOut).toEqual([]);
    const freedom = r.included.find((a) => a.lineageId === 'old')!;
    // Rows in Aug/Sep: Aug 10 (old), Aug 25 and Sep 9 (old2).
    expect(freedom).toEqual({ lineageId: 'old', name: 'Freedom Unlimited', handKept: false, currentCents: 3100, baselineCents: 6500, rowsInPeriods: 3 });
    expect(r.baselineCents).toBe(206500); // 200000 + 4000 + 2500
    expect(r.currentCents).toBe(206600); // 203500 + 3100
  });

  it('asks about the member that holds the edge', () => {
    const late = { ...successor, lastRowDate: d('2026-09-12'), completeThrough: null, feed: 'none' as const };
    const q = compare([CHK, OLD, late], rows).leftOut[0]!.questions;
    expect(q).toEqual([{ accountId: 'old2', accountName: 'Freedom Unlimited', edge: 'end', date: '2026-09-12' }]);
  });
});

describe('compareSameAccounts — §E2 two records of one card that do not meet', () => {
  // The old record (no feed) stops Jun 14; the new connection's history starts Aug 25.
  // Jun 15 … Aug 24 is on NEITHER record (critic cycle 1, P0-1: it used to be read as $0).
  const JUN: Period = { start: d('2026-06-01'), end: d('2026-06-30') };
  const JUL: Period = { start: d('2026-07-01'), end: d('2026-07-31') };
  const MAY: Period = { start: d('2026-05-01'), end: d('2026-05-31') };
  const f1 = account('f1', 'Freedom (old)', {
    lineageId: 'f',
    firstRowDate: d('2025-01-05'),
    lastRowDate: d('2026-06-14'),
    completeThrough: null,
    feed: 'none',
  });
  const f2 = account('f2', 'Freedom Unlimited', { lineageId: 'f', firstRowDate: d('2026-08-25'), lastRowDate: d('2026-09-30') });
  const fRows = [
    row('f1', '2026-05-10', 20000, 'dining'),
    row('f1', '2026-06-10', 30000, 'dining'),
    row('f1', '2026-06-14', 500, 'dining'),
    row('f2', '2026-08-25', 30000, 'dining'),
    row('f2', '2026-09-10', 30000, 'dining'),
  ];
  const gapOf = (r: ReturnType<typeof compare>) => r.leftOut.find((a) => a.lineageId === 'f');
  const GAP = {
    edge: 'gap',
    from: '2026-06-15',
    to: '2026-08-24',
    before: 'Freedom (old)',
    after: 'Freedom Unlimited',
    told: false,
    dropped: false,
  };

  it('is left out of a comparison the hole touches, named with the hole, and both halves are asked', () => {
    const r = compare([f1, f2], fRows, JUL, JUN);
    expect(r.included).toEqual([]);
    const f = gapOf(r)!;
    expect(f.reasons).toEqual([GAP]);
    expect(f.currentCents).toBe(0); // July: on no record
    expect(f.baselineCents).toBe(30500); // June: 30000 + 500
    expect(f.questions).toEqual([
      { accountId: 'f2', accountName: 'Freedom Unlimited', edge: 'start', date: '2026-08-25' },
      { accountId: 'f1', accountName: 'Freedom (old)', edge: 'end', date: '2026-06-14' },
    ]);
  });

  it('a comparison that does not touch the hole is answered as one record', () => {
    const r = compare([f1, f2], fRows, SEP, MAY);
    expect(r.leftOut).toEqual([]);
    expect([r.currentCents, r.baselineCents]).toEqual([30000, 20000]);
  });

  it('an average whose run crosses the hole leaves the card out', () => {
    const months = [MAY, JUN, JUL, AUG, SEP];
    const r = averageSameAccounts({ rows: fRows, accounts: [f1, f2], months, today: TODAY, figure: linear });
    if (!r.ok) throw new Error(r.refusal);
    expect(r.included).toEqual([]);
    expect(r.leftOut[0]!.reasons).toEqual([GAP]);
  });

  it('is a real stretch of nothing only when the new record began there AND the old one ended there', () => {
    const began = { ...f2, startWord: { forDate: d('2026-08-25'), verdict: 'real' as const } };
    const ended = { ...f1, endWord: { forDate: d('2026-06-14'), verdict: 'real' as const } };
    const both = compare([ended, began], fRows, JUL, JUN);
    expect(both.leftOut).toEqual([]);
    expect([both.currentCents, both.baselineCents]).toEqual([0, 30500]);
    // One half alone is not enough — and only the open half is asked.
    const half = gapOf(compare([f1, began], fRows, JUL, JUN))!;
    expect(half.reasons).toEqual([GAP]);
    expect(half.questions).toEqual([{ accountId: 'f1', accountName: 'Freedom (old)', edge: 'end', date: '2026-06-14' }]);
  });

  it("the old record's own feed, delivered through the hole, stands in for its word", () => {
    const fed = { ...f1, feed: 'live' as const, completeThrough: d('2026-08-24') };
    const unasked = gapOf(compare([fed, f2], fRows, JUL, JUN))!;
    expect(unasked.questions).toEqual([{ accountId: 'f2', accountName: 'Freedom Unlimited', edge: 'start', date: '2026-08-25' }]);
    const began = { ...f2, startWord: { forDate: d('2026-08-25'), verdict: 'real' as const } };
    expect(compare([fed, began], fRows, JUL, JUN).leftOut).toEqual([]);
    // A feed that stops one day short of the hole's end does not.
    const short = { ...fed, completeThrough: d('2026-08-23') };
    expect(gapOf(compare([short, began], fRows, JUL, JUN))!.reasons).toEqual([GAP]);
  });

  it('records that overlap or touch leave no hole', () => {
    const overlap = { ...f2, firstRowDate: d('2026-06-10') };
    expect(compare([f1, overlap], fRows, JUL, JUN).leftOut).toEqual([]);
    const touch = { ...f2, firstRowDate: d('2026-06-15') }; // the day after the old last row
    expect(compare([f1, touch], fRows, JUL, JUN).leftOut).toEqual([]);
    const oneDay = { ...f2, firstRowDate: d('2026-06-16') }; // Jun 15 alone is on neither
    expect(gapOf(compare([f1, oneDay], fRows, JUL, JUN))!.reasons).toEqual([{ ...GAP, to: '2026-06-15' }]);
  });

  it('once the reader says some of it is missing, it stays out and is not asked again', () => {
    const had = { ...f2, startWord: { forDate: d('2026-08-25'), verdict: 'missing' as const } };
    const f = gapOf(compare([f1, had], fRows, JUL, JUN))!;
    expect(f.reasons).toEqual([{ ...GAP, told: true }]);
    expect(f.questions).toEqual([]);
  });

  it('a hole the boundary made (a cutover before the old record\'s last row) cannot be proven, and nothing is asked', () => {
    // critic cycles 2-3: the old record runs to Aug 20, but the reader's cutover (Jun 14) drops
    // everything after it. Its own row span is NOT where it stops counting.
    const cut = { ...f1, lastRowDate: d('2026-08-20'), dropped: [{ from: d('2026-06-15'), to: d('9999-12-31') }] };
    const began = { ...f2, startWord: { forDate: d('2026-08-25'), verdict: 'real' as const } };
    const f = gapOf(compare([cut, began], fRows, JUL, JUN))!;
    expect(f.reasons).toEqual([{ ...GAP, dropped: true }]);
    expect(f.questions).toEqual([]);
    // ...and its own feed does not stand in for days it no longer counts.
    const fedCut = { ...cut, feed: 'live' as const, completeThrough: d('2026-10-01') };
    expect(gapOf(compare([fedCut, began], fRows, JUL, JUN))!.reasons).toEqual([{ ...GAP, dropped: true }]);
  });

  it('a record whose rows were ALL dropped still counts as activity — those days are not a real $0', () => {
    // critic cycle 3, C3: the new record's rows (Aug 25 … Sep 30) all fall inside the old one's claim.
    const swallowed = { ...f2, dropped: [{ from: d('2025-01-05'), to: d('2026-10-01') }] };
    const ended = { ...f1, endWord: { forDate: d('2026-06-14'), verdict: 'real' as const } };
    const f = gapOf(compare([ended, swallowed], fRows, SEP, AUG))!;
    expect(f.reasons.some((r) => r.edge === 'gap' && r.dropped)).toBe(true);
    // No question can bring dropped rows back, so none is asked — not even the old record's end.
    expect(f.questions).toEqual([]);
  });

  it('a tie on the latest row goes to the account that carries the lineage now, whatever the ids', () => {
    // critic cycle 2, P2-1: both records hold Sep 28; the old one (no feed) used to win on id order.
    const old = account('a-old', 'Sapphire (old)', { lineageId: 'z-new', lastRowDate: d('2026-09-28'), feed: 'none', completeThrough: null });
    const cur = account('z-new', 'Sapphire', { lineageId: 'z-new', firstRowDate: d('2026-09-01'), lastRowDate: d('2026-09-28') });
    const rows = [row('a-old', '2026-08-15', 5000, 'dining'), row('z-new', '2026-09-28', 1400, 'dining')];
    const r = compare([old, cur], rows, SEP, AUG);
    expect(r.leftOut).toEqual([]);
    expect(r.included[0]!.name).toBe('Sapphire');
  });

  it("vouches for the record's end with the feed of the account that carries it NOW, not an older one's", () => {
    // critic cycle 1, P2-2: the old record's live feed used to vouch for the new one's silence.
    const oldFed = { ...f1, lastRowDate: d('2026-08-10'), feed: 'live' as const, completeThrough: d('2026-10-01') };
    const newUnfed = { ...f2, firstRowDate: d('2026-08-05'), lastRowDate: d('2026-08-14'), feed: 'none' as const, completeThrough: null };
    const f = gapOf(compare([oldFed, newUnfed], fRows, SEP, AUG))!;
    expect(f.reasons).toEqual([{ edge: 'end', through: '2026-08-14', feed: 'none', told: false }]);
  });
});

describe('compareSameAccounts — §F what it will not answer', () => {
  const ask = (current: Period, baseline: Period, today = TODAY) =>
    compareSameAccounts({ rows: ROWS, accounts: ACCOUNTS, current, baseline, today, figure: linear });

  it('a period that has not finished', () => {
    expect(ask(SEP, AUG, d('2026-09-30'))).toEqual({ ok: false, refusal: 'unfinished' });
    expect(ask(SEP, AUG, d('2026-10-01')).ok).toBe(true); // finished yesterday
  });

  it('periods that share a day', () => {
    const augPlus: Period = { start: d('2026-08-01'), end: d('2026-09-01') };
    expect(ask(SEP, augPlus)).toEqual({ ok: false, refusal: 'overlap' });
    expect(ask(SEP, SEP)).toEqual({ ok: false, refusal: 'overlap' });
    expect(ask(SEP, AUG).ok).toBe(true); // adjacent is not overlapping
  });

  it('a period that ends before it starts', () => {
    expect(ask({ start: d('2026-09-30'), end: d('2026-09-01') }, AUG)).toEqual({ ok: false, refusal: 'order' });
  });

  it('a row for an account nobody described is a caller bug, not a silent zero', () => {
    const rows = [row('ghost', '2026-09-05', 100, 'x')];
    expect(() => compareSameAccounts({ rows, accounts: [CHK], current: SEP, baseline: AUG, today: TODAY, figure: linear })).toThrow(/not described/);
  });
});

describe('compareSameAccounts — §G hand-kept accounts', () => {
  it('carries the flag through so the caller can say nothing vouches for the middle', () => {
    const cash = account('cash', 'Cash', { completeThrough: null, feed: 'none', handKept: true });
    expect(compare([cash], []).included[0]!.handKept).toBe(true);
  });
});

describe('averageSameAccounts — §H', () => {
  const JUN: Period = { start: d('2026-06-01'), end: d('2026-06-30') };
  const JUL: Period = { start: d('2026-07-01'), end: d('2026-07-31') };
  const rows = [
    row('chk', '2026-06-10', 100000, 'groceries'),
    row('chk', '2026-07-10', 110001, 'groceries'),
    row('chk', '2026-08-10', 120000, 'groceries'),
    row('mid', '2026-07-20', 5000, 'dining'),
    row('mid', '2026-08-20', 6000, 'dining'),
  ];
  // First row Jul 5: whole for August on its own, but not for the run June–August.
  const MID = account('mid', 'Midyear', { firstRowDate: d('2026-07-05') });

  it('averages the months on the accounts whole across the entire run', () => {
    const r = averageSameAccounts({ rows, accounts: [CHK, MID], months: [JUN, JUL, AUG], today: TODAY, figure: linear });
    if (!r.ok) throw new Error(r.refusal);
    expect(r.months.map((m) => m.cents)).toEqual([100000, 110001, 120000]);
    expect(r.totalCents).toBe(330001);
    expect(r.meanCents).toBe(110000); // 330001 / 3 = 110000.33
    expect(r.included).toEqual([{ lineageId: 'chk', name: 'Checking', handKept: false, totalCents: 330001, rowsInPeriods: 3 }]);
    expect(r.leftOut).toEqual([
      {
        lineageId: 'mid',
        name: 'Midyear',
        handKept: false,
        totalCents: 11000,
        rowsInPeriods: 2,
        reasons: [{ edge: 'start', date: '2026-07-05', told: false }],
        questions: [{ accountId: 'mid', accountName: 'Midyear', edge: 'start', date: '2026-07-05' }],
      },
    ]);
  });

  it('rounds the mean half away from zero', () => {
    const mean = (a: number, b: number) => {
      const r = averageSameAccounts({
        rows: [row('chk', '2026-07-10', a, 'x'), row('chk', '2026-08-10', b, 'x')],
        accounts: [CHK],
        months: [JUL, AUG],
        today: TODAY,
        figure: linear,
      });
      if (!r.ok) throw new Error(r.refusal);
      return r.meanCents;
    };
    expect(mean(100, 101)).toBe(101); // 100.5
    expect(mean(-100, -101)).toBe(-101); // −100.5
    expect(mean(100, 100)).toBe(100);
  });

  it('refuses one month, an unfinished month, and months out of order', () => {
    const avg = (months: Period[], today = TODAY) => averageSameAccounts({ rows, accounts: [CHK], months, today, figure: linear });
    expect(avg([AUG])).toEqual({ ok: false, refusal: 'too-few' });
    expect(avg([AUG, SEP], d('2026-09-30'))).toEqual({ ok: false, refusal: 'unfinished' });
    expect(avg([AUG, JUL])).toEqual({ ok: false, refusal: 'overlap' });
    expect(avg([JUL, JUL])).toEqual({ ok: false, refusal: 'overlap' });
  });
});

/**
 * §I — the property the engine exists for: an account that is IN is never wrong.
 *
 * Build a true household (every row that really happened), then damage what is "on
 * record" the ways records are really damaged — a connection that stopped while the card
 * went on being used, a card linked after it was opened — and hand the engine only the
 * damaged record plus facts that are true. Whatever it includes must match the truth for
 * that account, to the cent, on both sides. (It may leave anything out.)
 */
describe('compareSameAccounts — §I included accounts match the truth', () => {
  // A small seeded generator: the same households on every run.
  const rng = (seed: number) => () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const START = d('2026-01-01');
  const END = d('2026-10-01');
  const span = 273; // days from START to END

  it('across 300 damaged households', () => {
    let includedChecked = 0;
    let leftOutSeen = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const next = rng(seed);
      const pick = (n: number) => Math.floor(next() * n);
      const truth: SpendRow[] = [];
      const onRecord: SpendRow[] = [];
      const accounts: AccountRecord[] = [];
      for (let a = 0; a < 4; a++) {
        const id = `a${a}`;
        // The account really lived from `born` to `died` (inclusive), spending every few days.
        const born = pick(3) === 0 ? pick(200) : 0;
        const died = pick(3) === 0 ? born + 30 + pick(span - born - 30 + 1) : span;
        const rowsTrue: SpendRow[] = [];
        for (let day = born; day <= Math.min(died, span); day += 1 + pick(6)) {
          rowsTrue.push({ accountId: id, date: addDays(START, day), cents: 100 + pick(20000), key: `k${pick(3)}`, label: 'K' });
        }
        if (rowsTrue.length === 0) continue;
        // Damage: the record may start late and/or stop early.
        const cutStart = pick(3) === 0 ? born + pick(120) : born;
        const cutEnd = pick(3) === 0 ? died - pick(120) : died;
        const kept = rowsTrue.filter((r) => {
          const day = daysBetween(START, r.date);
          return day >= cutStart && day <= cutEnd;
        });
        truth.push(...rowsTrue);
        if (kept.length === 0) continue;
        onRecord.push(...kept);
        const first = kept[0]!.date;
        const last = kept[kept.length - 1]!.date;
        const trueFirst = rowsTrue[0]!.date;
        const trueLast = rowsTrue[rowsTrue.length - 1]!.date;
        // Facts handed to the engine are TRUE ones only: a live feed only when the record
        // really runs to the end; the reader's word only as the truth would have them say.
        const liveToEnd = cutEnd === span && died === span;
        const word = (edge: ISODate, real: boolean) =>
          pick(2) === 0 ? null : { forDate: edge, verdict: real ? ('real' as const) : ('missing' as const) };
        accounts.push({
          id,
          name: id.toUpperCase(),
          lineageId: id,
          firstRowDate: first,
          lastRowDate: last,
          completeThrough: liveToEnd ? END : null,
          feed: liveToEnd ? 'live' : 'none',
          startWord: word(first, compareDates(first, trueFirst) === 0),
          endWord: liveToEnd ? null : word(last, compareDates(last, trueLast) === 0),
          everSpent: true,
          handKept: false,
        });
      }
      for (const [current, baseline] of [
        [SEP, AUG],
        [SEP, { start: d('2026-03-01'), end: d('2026-03-31') }],
        [{ start: d('2026-06-01'), end: d('2026-06-30') }, { start: d('2026-02-01'), end: d('2026-02-28') }],
      ] as [Period, Period][]) {
        const r = compareSameAccounts({ rows: onRecord, accounts, current, baseline, today: TODAY, figure: linear });
        if (!r.ok) throw new Error(r.refusal);
        const sumOf = (rows: SpendRow[], id: string, p: Period) =>
          rows.filter((x) => x.accountId === id && inPeriod(x, p)).reduce((n, x) => n + x.cents, 0);
        for (const inc of r.included) {
          expect(inc.currentCents, `seed ${seed} ${inc.name} current`).toBe(sumOf(truth, inc.lineageId, current));
          expect(inc.baselineCents, `seed ${seed} ${inc.name} baseline`).toBe(sumOf(truth, inc.lineageId, baseline));
          includedChecked++;
        }
        leftOutSeen += r.leftOut.length;
        // …and nothing on record is dropped: in or out, every row is in someone's figure.
        const all = [...r.included, ...r.leftOut].reduce((n, x) => n + x.currentCents + x.baselineCents, 0);
        const raw = accounts.reduce((n, acc) => n + sumOf(onRecord, acc.id, current) + sumOf(onRecord, acc.id, baseline), 0);
        expect(all, `seed ${seed} conservation`).toBe(raw);
        expect(r.drivers.reduce((n, g) => n + g.deltaCents, 0), `seed ${seed} drivers`).toBe(r.deltaCents);
        // …and each side is the truth for the included accounts taken together.
        const ids = new Set(r.included.map((x) => x.lineageId));
        const together = (p: Period) => truth.filter((x) => ids.has(x.accountId) && inPeriod(x, p)).reduce((n, x) => n + x.cents, 0);
        expect(r.currentCents, `seed ${seed} current side`).toBe(together(current));
        expect(r.baselineCents, `seed ${seed} baseline side`).toBe(together(baseline));
      }
    }
    // The generator must actually exercise both outcomes, or the property proves nothing.
    expect(includedChecked).toBeGreaterThan(500);
    expect(leftOutSeen).toBeGreaterThan(500);
  });
});

/**
 * §J — the engine adds nothing up itself. The app's figure nets refunds within a category
 * and DROPS a category whose net is zero or less, so two accounts' figures need not add
 * up to the figure for both. The sides must be the caller's figure over the included
 * rows TOGETHER — never a sum of per-account figures.
 */
describe('compareSameAccounts — §J a figure that does not add up across accounts', () => {
  const floored = (rows: readonly SpendRow[], p: Period): Figure => {
    const groups = linear(rows, p).groups.filter((g) => g.cents > 0);
    return { totalCents: groups.reduce((n, g) => n + g.cents, 0), groups };
  };
  // September: Checking bought 5000 of dining; Sapphire got a 2000 dining refund and
  // bought 3000 of groceries. August: Checking bought 1000 of dining.
  const rows = [
    row('chk', '2026-09-05', 5000, 'dining'),
    row('card', '2026-09-06', -2000, 'dining'),
    row('card', '2026-09-07', 3000, 'groceries'),
    row('chk', '2026-08-05', 1000, 'dining'),
  ];
  const r = compareSameAccounts({ rows, accounts: [CHK, CARD], current: SEP, baseline: AUG, today: TODAY, figure: floored });
  if (!r.ok) throw new Error(r.refusal);

  it('each side is the figure over both accounts together', () => {
    // Dining nets 5000 − 2000 = 3000; groceries 3000. Total 6000.
    expect(r.currentCents).toBe(6000);
    expect(r.baselineCents).toBe(1000);
    expect(r.deltaCents).toBe(5000);
    expect(r.currentFigure.totalCents).toBe(6000);
  });

  it('while each account alone shows its own figure — which here do not sum to the side', () => {
    // Checking alone: 5000. Sapphire alone: dining nets −2000 and is dropped; groceries 3000.
    const own = Object.fromEntries(r.included.map((a) => [a.name, a.currentCents]));
    expect(own).toEqual({ Checking: 5000, Sapphire: 3000 });
    expect(5000 + 3000).not.toBe(r.currentCents);
  });

  it('and the groups still sum to the change', () => {
    expect(r.drivers).toEqual([
      { key: 'groceries', label: 'Groceries', currentCents: 3000, baselineCents: 0, deltaCents: 3000 },
      { key: 'dining', label: 'Dining', currentCents: 3000, baselineCents: 1000, deltaCents: 2000 },
    ]);
    expect(r.drivers.reduce((n, g) => n + g.deltaCents, 0)).toBe(r.deltaCents);
  });
});
