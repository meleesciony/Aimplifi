/**
 * DECISIONS #796 — Ask answers a savings rate over the period the reader names.
 *
 * Before: "what was my effective savings rate over last year?" matched the savings-rate
 * route, which dropped "last year" and answered the most recent complete month — a true
 * figure under a different window, with nothing saying so. "How much did I save last
 * year?" was not understood at all, and "what percent of my income did I save last year"
 * answered the year's INCOME.
 *
 * Acceptance (each a describe block below):
 *   A. Routing reads the period on every path that makes a savings intent (parser,
 *      follow-up frame, the LLM's kind, the echoed-intent validator), and ABSTAINS on a
 *      period it cannot read — never the standing last-month answer under it.
 *   B. The engine pools (Σ income − Σ spending) ÷ Σ income over finished, on-record
 *      months; a month still in progress and months before the first full month on
 *      record are left out and reported; a month lived on savings keeps its spending.
 *   C. The words name the months measured, every month left out, and the basis.
 *   D. The derivation panel recomputes the headline's rate from the period's sums.
 *
 * Hand-verified figures: tests/edge-cases/savings-rate-over-a-period.md. All amounts
 * are invented.
 */
import { describe, expect, it } from 'vitest';
import { isoDate } from '@/lib/dates';
import { cents } from '@/lib/money';
import type { MonthlyFlow } from '@/lib/engine/fi/insights';
import { pooledSavingsRateBps } from '@/lib/engine/fi/fi';
import { firstFullMonthOnRecord, savingsOverPeriod, type SavingsPeriod } from '@/lib/engine/fi/savings-period';
import {
  parseAssistantQuery,
  parseExplicitTimeframe,
  readSavingsWindow,
  validateIntent,
  type AssistantIntent,
} from '@/lib/engine/assistant/intent';
import { intentFromKind } from '@/lib/engine/assistant/llm';
import { frameFromIntent, resolveEllipsis } from '@/lib/engine/assistant/frame';
import { answerSavingsRatePeriod, savingsPeriodPhrase } from '@/lib/engine/assistant/answer';
import { traceSavingsRateDerivation } from '@/lib/engine/assistant/derivation';
import { RATE_FLOOR_BPS, bpsToPct1dp, derivationView, savingsRatePct } from '@/lib/engine/assistant/trace-view';
import { formatSavingsRateBps } from '@/components/coach/savings-rate-format';
import { followUpQuestions } from '@/lib/engine/assistant/follow-ups';

const TODAY = isoDate('2026-10-07');
const parse = (q: string) => parseAssistantQuery(q, TODAY);
const windowOf = (q: string) => {
  const i = parse(q);
  return i.kind === 'savings_rate' ? (i.timeframe ?? null) : undefined;
};

// ─── fixture (invented; hand-computed in the edge-case file) ─────────────────
//
// Records start 2025-03-14, so March 2025 is only partly on record: the first full
// month is April 2025. June 2025 has spending and no income; July 2025 has no counted
// row at all. October 2026 is the month in progress on TODAY.
const flow = (month: string, income: number, expenses: number): MonthlyFlow => ({
  month,
  incomeCents: cents(income),
  expensesCents: cents(expenses),
  savingsRateBps: income > 0 ? Math.round(((income - expenses) / income) * 10000) : null,
});
const FLOWS: MonthlyFlow[] = [
  flow('2025-03', 100_000, 20_000),
  flow('2025-04', 500_000, 400_000),
  flow('2025-05', 500_000, 450_000),
  flow('2025-06', 0, 210_000),
  // 2025-07: no counted row
  flow('2025-08', 520_000, 300_000),
  ...['2025-09', '2025-10', '2025-11', '2025-12'].map((m) => flow(m, 500_000, 400_000)),
  ...['01', '02', '03', '04', '05', '06', '07', '08', '09'].map((m) => flow(`2026-${m}`, 600_000, 450_000)),
  flow('2026-10', 300_000, 100_000),
];
const RECORDS_START = isoDate('2025-03-14');
const measure = (fromYm: string, toYm: string, recordsStart: string | null = RECORDS_START) =>
  savingsOverPeriod({ flows: FLOWS, fromYm, toYm, today: TODAY, recordsStart: recordsStart === null ? null : isoDate(recordsStart) });
const ok = (p: SavingsPeriod) => {
  if (!p.ok) throw new Error(`expected a measured period, got ${p.reason}`);
  return p;
};

// ─── A. routing ───────────────────────────────────────────────────────────────

describe('A. a savings question keeps the period it names', () => {
  it('test_regression__ask_savings_rate_honours_the_named_period — "over last year" is 2025, never last month', () => {
    expect(parse('what was my effective saving rate over last year')).toEqual({
      kind: 'savings_rate',
      timeframe: { fromYm: '2025-01', toYm: '2025-12', label: '2025' },
    });
    expect(parse('What was my effective savings rate over last year?')).toMatchObject({
      kind: 'savings_rate',
      timeframe: { fromYm: '2025-01', toYm: '2025-12' },
    });
  });

  it('no period named → the standing last-complete-month answer (unchanged)', () => {
    for (const q of [
      "what's my savings rate?",
      'what is my savings rate',
      'how much of my income do I save',
      'how much do I save a month',
      "what's my monthly savings rate",
      "what's my savings rate these days",
      'what percentage of my income am I saving',
      'am I spending more than I make',
    ]) {
      expect(parse(q), q).toEqual({ kind: 'savings_rate' });
    }
  });

  it('calendar periods are the parser\'s own windows', () => {
    expect(windowOf('savings rate in 2025')).toMatchObject({ fromYm: '2025-01', toYm: '2025-12' });
    expect(windowOf('what was my savings rate for 2025')).toMatchObject({ fromYm: '2025-01', toYm: '2025-12' });
    expect(windowOf('savings rate this year')).toMatchObject({ fromYm: '2026-01', toYm: '2026-10' });
    expect(windowOf('savings rate year to date')).toMatchObject({ fromYm: '2026-01', toYm: '2026-10' });
    expect(windowOf('savings rate since march')).toMatchObject({ fromYm: '2026-03', toYm: '2026-10' });
    expect(windowOf('savings rate in august 2025')).toMatchObject({ fromYm: '2025-08', toYm: '2025-08' });
    expect(windowOf('savings rate last month')).toMatchObject({ fromYm: '2026-09', toYm: '2026-09' });
    expect(windowOf('savings rate from 2024 to 2025')).toMatchObject({ fromYm: '2024-01', toYm: '2025-12' });
  });

  it('a trailing period is that many FINISHED months — the month in progress is never one of them', () => {
    const last12 = { fromYm: '2025-10', toYm: '2026-09' };
    for (const q of [
      'what was my savings rate over the last 12 months',
      'savings rate past 12 months',
      'my savings rate over the past year',
      'savings rate for the last twelve months',
      'what is my annual savings rate',
      'yearly savings rate',
    ]) {
      expect(windowOf(q), q).toMatchObject(last12);
    }
    expect(windowOf('savings rate the last 6 months')).toMatchObject({ fromYm: '2026-04', toYm: '2026-09' });
    expect(windowOf('savings rate over the past six months')).toMatchObject({ fromYm: '2026-04', toYm: '2026-09' });
    // "annual" beside a named year is that year.
    expect(windowOf('what is my annual savings rate for 2025')).toMatchObject({ fromYm: '2025-01', toYm: '2025-12' });
  });

  it('how much was saved, what share of pay was kept, whether spending outran income', () => {
    expect(windowOf('how much did I save last year')).toMatchObject({ fromYm: '2025-01', toYm: '2025-12' });
    expect(windowOf('how much money did I save in 2025?')).toMatchObject({ fromYm: '2025-01', toYm: '2025-12' });
    expect(windowOf('how much have I saved this year so far')).toMatchObject({ fromYm: '2026-01', toYm: '2026-10' });
    expect(windowOf('so how much did I actually save over the last 12 months')).toMatchObject({ fromYm: '2025-10', toYm: '2026-09' });
    expect(windowOf('what percent of my income did I save last year')).toMatchObject({ fromYm: '2025-01', toYm: '2025-12' });
    expect(windowOf('what share of my pay did I keep last year')).toMatchObject({ fromYm: '2025-01', toYm: '2025-12' });
    expect(windowOf('how much of my income did I save in 2025')).toMatchObject({ fromYm: '2025-01', toYm: '2025-12' });
    expect(windowOf('did I spend more than I earned last year')).toMatchObject({ fromYm: '2025-01', toYm: '2025-12' });
    expect(windowOf('did I make more than I spent in 2025')).toMatchObject({ fromYm: '2025-01', toYm: '2025-12' });
  });

  it('ABSTAINS on a period it cannot read — never the standing last-month figure under it', () => {
    for (const q of [
      'savings rate over the past two years', // years it does not count
      'savings rate last quarter',
      'savings rate in the last 30 days',
      'savings rate last week',
      'savings rate in 2030', // a future year
      'savings rate in 2025 vs 2024', // a comparison
      'was my savings rate higher in 2025 than 2024',
      'savings rate 2024 and 2025',
      'savings rate from january to june', // two months the parser would read as one
      'savings rate between march and may',
      'savings rate over the last 12 months of 2025', // two periods at once
      'savings rate over the last 36 months', // past the 24-month cap
      'how did my savings rate change since last year',
      'how much did I save over the past two years',
      'how much did I save on groceries last year', // a discount question, not spending
      'how much did I save at costco',
      'how much did i save with coupons in 2025',
    ]) {
      expect(parse(q).kind, q).toBe('unknown');
    }
  });

  it('critic cycle 1 F1: a word that changes WHICH part of the period abstains — never the whole year or one month', () => {
    for (const q of [
      'savings rate for the first half of 2025',
      'savings rate for the second half of 2025',
      'savings rate in h1 2025',
      'savings rate in early 2025',
      'savings rate in late 2025',
      'savings rate at the end of 2025',
      'savings rate at the start of 2025',
      'savings rate in the middle of 2025',
      'savings rate before 2025',
      'savings rate after 2025',
      'savings rate until 2025',
      'savings rate excluding 2025',
      'savings rate except december 2025',
      'savings rate not counting may 2025',
      'what was my savings rate may-june 2025', // the parser reads only June
      'what was my savings rate may and june',
      'savings rate in 2025 over 3 months',
    ]) {
      expect(parse(q).kind, q).toBe('unknown');
    }
    // The LLM path reads with the same rules.
    expect(intentFromKind('savings_rate', 'my stash ratio for the first half of 2025', TODAY)).toBeNull();
    expect(intentFromKind('savings_rate', 'my stash ratio in 2025 without rent', TODAY)).toBeNull();
  });

  it('critic cycle 1 F2: a savings phrasing it cannot read whole abstains — never spending, income or this month', () => {
    for (const q of [
      'how much did I save in 2025 on groceries', // was: "You spent $… on Groceries in 2025."
      'how much did I save last year on groceries',
      'did I spend more than I earned lately', // was: "You spent $… this month."
      'what percent of my income did I save in the first half of 2025', // was: the year's income
      'what percent of my income did I save lately', // was: "No income recorded this month."
      'how much did I save in the first half of 2025',
    ]) {
      expect(parse(q).kind, q).toBe('unknown');
    }
  });

  it('critic cycle 1 F7: "savings rate" with a store, a condition or a goal is a different question', () => {
    for (const q of [
      'savings rate on groceries last year',
      'what would my savings rate be in 2025 without rent',
      'how much am I saving for my vacation goal this year',
      'what savings rate do I need to retire at 60',
      'what should my savings rate be',
      "what's my savings rate on groceries",
      'what was my real savings rate in 2024 and 2025',
    ]) {
      expect(parse(q).kind, q).toBe('unknown');
    }
    // …while the ways people actually ask still answer.
    expect(windowOf('can you tell me my savings rate for 2025')).toMatchObject({ fromYm: '2025-01', toYm: '2025-12' });
    expect(windowOf('how is my savings rate looking this year')).toMatchObject({ fromYm: '2026-01', toYm: '2026-10' });
    expect(windowOf('may I see my savings rate for 2025')).toMatchObject({ fromYm: '2025-01', toYm: '2025-12' });
    expect(windowOf('what was my savings rate in may')).toMatchObject({ fromYm: '2026-05', toYm: '2026-05' });
    expect(parse("what's my current savings rate")).toEqual({ kind: 'savings_rate' });
  });

  it('leaves questions it does not own to their routes', () => {
    expect(parse('how much did I save').kind).not.toBe('savings_rate'); // no period: likely a balance
    expect(parse('how much have I saved').kind).not.toBe('savings_rate');
    expect(parse('how much have I saved for my trip this year').kind).not.toBe('savings_rate');
    expect(parse('how much did i save by cancelling netflix last year').kind).not.toBe('savings_rate');
    expect(parse('how much should I save each month to have $20,000 by December 2027').kind).toBe('savings_goal_by_date');
    expect(parse('how much is in my savings?').kind).toBe('account_balance');
    expect(parse('how much did I make last year').kind).toBe('income');
    expect(parse('is my spending outpacing my income').kind).toBe('lifestyle_creep');
    expect(parse('how much did I spend last year').kind).toBe('spend_total');
  });

  it('"the past year" is the last 12 months for every route, not the silent this-month default', () => {
    expect(parseExplicitTimeframe('over the past year', TODAY)).toEqual({
      fromYm: '2025-11',
      toYm: '2026-10',
      label: 'the last 12 months',
    });
    expect(parse('how much did I spend over the past year')).toEqual({
      kind: 'spend_total',
      timeframe: { fromYm: '2025-11', toYm: '2026-10', label: 'the last 12 months' },
    });
    expect(parseExplicitTimeframe('past years', TODAY)).toBeNull();
    // The standing creep verdict reads its own window; "over the past year" now abstains
    // there exactly as "over the last 12 months" already did (critic cycle 1, P3).
    expect(parse('is my lifestyle creeping over the past year').kind).toBe(parse('is my lifestyle creeping over the last 12 months').kind);
  });

  it('one reader for every path: the LLM\'s kind re-reads the period from the reader\'s words', () => {
    expect(intentFromKind('savings_rate', 'what fraction of my paycheck did i stash away in 2025', TODAY)).toEqual({
      kind: 'savings_rate',
      timeframe: { fromYm: '2025-01', toYm: '2025-12', label: 'in 2025' },
    });
    expect(intentFromKind('savings_rate', 'how is my saving going lately', TODAY)).toBeNull();
    expect(intentFromKind('savings_rate', 'my stash ratio in 2031', TODAY)).toBeNull();
    expect(intentFromKind('savings_rate', 'what portion of pay do i keep', TODAY)).toEqual({ kind: 'savings_rate' });
  });

  it('the follow-up frame swaps the period with the same reader, and abstains where it does', () => {
    const prior = parse('what was my savings rate last year') as AssistantIntent;
    const frame = frameFromIntent(prior);
    expect(frame).toEqual({ kind: 'savings_rate', timeframe: { fromYm: '2025-01', toYm: '2025-12', label: '2025' } });
    expect(resolveEllipsis('what about 2024?', TODAY, frame)).toMatchObject({
      kind: 'savings_rate',
      timeframe: { fromYm: '2024-01', toYm: '2024-12' },
    });
    // Asked whole, "the last 6 months" is six FINISHED months; as a follow-up it is the same.
    expect(resolveEllipsis('what about the last 6 months?', TODAY, frame)).toMatchObject({
      kind: 'savings_rate',
      timeframe: { fromYm: '2026-04', toYm: '2026-09' },
    });
    expect(resolveEllipsis('and the last 12 months of 2025?', TODAY, frame)).toBeNull();
    expect(resolveEllipsis('what about groceries?', TODAY, frame)).toBeNull();
    // The standing answer carries its kind, so a period can be named next.
    const standing = frameFromIntent({ kind: 'savings_rate' });
    expect(resolveEllipsis('what about last year?', TODAY, standing)).toMatchObject({
      kind: 'savings_rate',
      timeframe: { fromYm: '2025-01', toYm: '2025-12' },
    });
  });

  it('an echoed intent: a period is checked, a malformed one rejects the intent', () => {
    expect(validateIntent({ kind: 'savings_rate' })).toEqual({ kind: 'savings_rate' });
    const tf = { fromYm: '2025-01', toYm: '2025-12', label: '2025' };
    expect(validateIntent({ kind: 'savings_rate', timeframe: tf })).toEqual({ kind: 'savings_rate', timeframe: tf });
    expect(validateIntent({ kind: 'savings_rate', timeframe: { fromYm: '2025-13', toYm: '2025-12', label: 'x' } })).toBeNull();
    expect(validateIntent({ kind: 'savings_rate', timeframe: { fromYm: '2025-06', toYm: '2025-01', label: 'x' } })).toBeNull();
    expect(validateIntent({ kind: 'savings_rate', timeframe: 'last year' })).toBeNull();
  });

  it('readSavingsWindow: a unit is not a period, and a time word it cannot read is not "none"', () => {
    expect(readSavingsWindow('how much do i save per month', TODAY)).toEqual({ kind: 'none' });
    expect(readSavingsWindow('my savings rate lately', TODAY)).toEqual({ kind: 'unreadable' });
    expect(readSavingsWindow('so far', TODAY)).toEqual({ kind: 'unreadable' });
  });
});

// ─── B. engine ────────────────────────────────────────────────────────────────

describe('B. the period engine', () => {
  it('the first full month on record starts on a 1st, or the month after', () => {
    expect(firstFullMonthOnRecord(isoDate('2025-03-14'))).toBe('2025-04');
    expect(firstFullMonthOnRecord(isoDate('2025-03-01'))).toBe('2025-03');
    expect(firstFullMonthOnRecord(isoDate('2025-12-31'))).toBe('2026-01');
  });

  it('2025: April–December only (records start mid-March); June keeps its spending; July is empty', () => {
    const p = ok(measure('2025-01', '2025-12'));
    expect([p.fromYm, p.toYm]).toEqual(['2025-04', '2025-12']);
    expect(p.months).toHaveLength(9);
    expect(p.incomeCents).toBe(3_520_000);
    expect(p.expensesCents).toBe(2_960_000);
    expect(p.keptCents).toBe(560_000);
    expect(p.rateBps).toBe(1591); // 560,000 ÷ 3,520,000 = 15.909…%
    expect(p.beforeRecords).toEqual({ recordsStart: '2025-03-14', firstFullYm: '2025-04' });
    expect(p.inProgressYm).toBeNull();
    expect(p.months.find((m) => m.month === '2025-07')).toEqual({ month: '2025-07', incomeCents: 0, expensesCents: 0, hasActivity: false });
    // The coach card's average drops June's spending — 21.875%. Over a period that flatters.
    expect(pooledSavingsRateBps(p.months.filter((m) => m.hasActivity))?.rateBps).toBe(2188);
  });

  it('the last 12 finished months', () => {
    const p = ok(measure('2025-10', '2026-09'));
    expect(p.incomeCents).toBe(6_900_000);
    expect(p.expensesCents).toBe(5_250_000);
    expect(p.rateBps).toBe(2391); // 1,650,000 ÷ 6,900,000 = 23.913…%
    expect(p.beforeRecords).toBeNull();
    expect(p.inProgressYm).toBeNull();
  });

  it('this year: the month in progress is left out and reported', () => {
    const p = ok(measure('2026-01', '2026-10'));
    expect([p.fromYm, p.toYm]).toEqual(['2026-01', '2026-09']);
    expect(p.inProgressYm).toBe('2026-10');
    expect(p.rateBps).toBe(2500);
    expect(p.incomeCents).toBe(5_400_000);
  });

  it('refusals: unfinished, before the records, nothing on record', () => {
    expect(measure('2026-10', '2026-10')).toEqual({ ok: false, reason: 'unfinished', firstYm: '2026-10' });
    expect(measure('2027-01', '2027-12')).toEqual({ ok: false, reason: 'unfinished', firstYm: '2027-01' });
    expect(measure('2024-01', '2024-12')).toEqual({
      ok: false,
      reason: 'before-records',
      recordsStart: '2025-03-14',
      firstFullYm: '2025-04',
    });
    // March 2025 is on record only from the 14th: no FULL month of it.
    expect(measure('2025-03', '2025-03')).toMatchObject({ ok: false, reason: 'before-records' });
    expect(measure('2025-01', '2025-12', null)).toEqual({ ok: false, reason: 'no-records' });
  });

  it('records from the 1st: that month counts', () => {
    const p = ok(measure('2025-03', '2025-03', '2025-03-01'));
    expect(p.rateBps).toBe(8000);
    expect(p.beforeRecords).toBeNull();
  });

  it('spending above income is a negative rate, never clamped', () => {
    const p = ok(measure('2025-05', '2025-06'));
    expect(p.keptCents).toBe(-160_000);
    expect(p.rateBps).toBe(-3200);
  });

  it('no income in the period: no rate, the spending still reported', () => {
    const p = ok(measure('2025-06', '2025-07'));
    expect(p.rateBps).toBeNull();
    expect(p.expensesCents).toBe(210_000);
  });
});

// ─── C. words ─────────────────────────────────────────────────────────────────

const words = (fromYm: string, toYm: string, nearest: SavingsPeriod | null = null) =>
  answerSavingsRatePeriod({ period: measure(fromYm, toYm), asked: { fromYm, toYm: toYm < '2026-09' ? toYm : '2026-09' }, nearest });

describe('C. the answer names what it measured and what it left out', () => {
  it('period phrases', () => {
    expect(savingsPeriodPhrase('2025-01', '2025-12')).toBe('in 2025');
    expect(savingsPeriodPhrase('2026-09', '2026-09')).toBe('in September 2026');
    expect(savingsPeriodPhrase('2026-05', '2026-09')).toBe('from May to September 2026');
    expect(savingsPeriodPhrase('2025-10', '2026-09')).toBe('from October 2025 to September 2026');
  });

  it('2025 with records starting mid-March: the scope is in the headline', () => {
    const a = words('2025-01', '2025-12');
    expect(a.headline).toBe(
      'Your records start Mar 14, 2025, so this covers April to December 2025: your savings rate was 15.9% — you kept $5,600.00 of the $35,200.00 you brought in.',
    );
    expect(a.headlineBps).toBe(1591);
    expect(a.detail).toContain('No income or spending is on record for July 2025.');
    expect(a.detail).toContain('No income is on record for June 2025; its spending is counted.');
    expect(a.detail).toContain('Income minus expenses, divided by income, over the whole period');
    expect(a.detail).toContain(
      'A 401(k) contribution taken out of your paycheck, or an employer match, is not in that income — counting it would raise this rate.',
    );
    // Critic cycle 1 F5: never implies a linked retirement account's contributions are counted.
    expect(a.detail).not.toMatch(/linked|HSA/);
    expect(a.facts.slice(0, 3)).toEqual([
      { label: 'Income', value: '$35,200.00' },
      { label: 'Expenses', value: '$29,600.00' },
      { label: 'Kept', value: '$5,600.00' },
    ]);
    expect(a.facts.find((f) => f.label === 'Jun 2025')?.value).toBe('no income');
    expect(a.facts.find((f) => f.label === 'Jul 2025')?.value).toBe('nothing on record');
    expect(a.facts.find((f) => f.label === 'Apr 2025')?.value).toBe('20.0%');
  });

  it('a full calendar year on record reads plainly', () => {
    const a = words('2025-10', '2026-09');
    expect(a.headline).toBe(
      'Your savings rate from October 2025 to September 2026 was 23.9% — you kept $16,500.00 of the $69,000.00 you brought in.',
    );
    expect(a.facts).toHaveLength(3 + 12);
  });

  it('this year: the month in progress is named as left out', () => {
    const a = words('2026-01', '2026-10');
    expect(a.headline).toBe(
      'Your savings rate from January to September 2026 was 25.0% — you kept $13,500.00 of the $54,000.00 you brought in.',
    );
    expect(a.detail).toContain("October 2026 isn't over yet, so it's left out.");
  });

  it('negative and zero kept are said as what they are', () => {
    expect(words('2025-05', '2025-06').headline).toBe(
      'Your savings rate from May to June 2025 was -32.0% — you spent $1,600.00 more than the $5,000.00 you brought in.',
    );
    const even = answerSavingsRatePeriod({
      period: savingsOverPeriod({ flows: [flow('2025-05', 400_000, 400_000)], fromYm: '2025-05', toYm: '2025-05', today: TODAY, recordsStart: isoDate('2025-01-01') }),
      asked: { fromYm: '2025-05', toYm: '2025-05' },
      nearest: null,
    });
    expect(even.headline).toBe('Your savings rate in May 2025 was 0.0% — you spent all $4,000.00 you brought in.');
  });

  it('no income on record: no rate, never a 0% or a −∞', () => {
    const a = words('2025-06', '2025-07');
    expect(a.headline).toBe(
      "No income is on record from June to July 2025, so there's no savings rate to work out — $2,100.00 of spending is.",
    );
    expect(a.headlineBps).toBeUndefined();
    expect(a.detail).not.toContain('401(k)');
  });

  it('before the records: says so, then answers the full months that ARE on record', () => {
    const a = answerSavingsRatePeriod({
      period: measure('2024-01', '2024-12'),
      asked: { fromYm: '2024-01', toYm: '2024-12' },
      nearest: measure('2025-10', '2026-09'),
    });
    expect(a.headline).toBe(
      'Your records start Mar 14, 2025, so no full month in 2024 is on record. Your savings rate from October 2025 to September 2026 was 23.9% — you kept $16,500.00 of the $69,000.00 you brought in.',
    );
    expect(a.detail?.startsWith('That is the latest 12 full months on record.')).toBe(true);
    expect(a.headlineBps).toBe(2391);

    const fewer = answerSavingsRatePeriod({
      period: measure('2024-01', '2024-12'),
      asked: { fromYm: '2024-01', toYm: '2024-12' },
      nearest: measure('2026-05', '2026-09'),
    });
    expect(fewer.detail?.startsWith('That is every full month on record so far.')).toBe(true);

    const none = answerSavingsRatePeriod({
      period: measure('2024-01', '2024-12', '2026-09-15'),
      asked: { fromYm: '2024-01', toYm: '2024-12' },
      nearest: measure('2025-10', '2026-09', '2026-09-15'),
    });
    expect(none.headline).toBe('Your records start Sep 15, 2026, so no full month in 2024 is on record. No full month is on record yet.');
    expect(none.headlineBps).toBeUndefined();
  });

  it('this month: not over yet, so the last full month', () => {
    const a = answerSavingsRatePeriod({
      period: measure('2026-10', '2026-10'),
      asked: { fromYm: '2026-10', toYm: '2026-09' },
      nearest: measure('2026-09', '2026-09'),
    });
    expect(a.headline).toBe(
      "October 2026 isn't over yet, so here is the last full month. Your savings rate in September 2026 was 25.0% — you kept $1,500.00 of the $6,000.00 you brought in.",
    );
  });

  it('nothing on record at all', () => {
    expect(words('2025-01', '2025-12').kind).toBe('savings_rate');
    const a = answerSavingsRatePeriod({ period: measure('2025-01', '2025-12', null), asked: { fromYm: '2025-01', toYm: '2025-12' }, nearest: null });
    expect(a.headline).toBe("There's nothing on record yet to work out a savings rate from.");
  });

  it('critic cycle 1 F3: a month of near-zero income is "below -100%", as on /coach — never a giant number', () => {
    // Pay slid to January 31, so February's only income is a $0.12 interest credit.
    const thin = [flow('2026-01', 1_200_000, 450_000), flow('2026-02', 12, 455_000), flow('2026-03', 600_000, 450_000)];
    const at = (fromYm: string, toYm: string) =>
      answerSavingsRatePeriod({
        period: savingsOverPeriod({ flows: thin, fromYm, toYm, today: TODAY, recordsStart: isoDate('2025-01-01') }),
        asked: { fromYm, toYm },
        nearest: null,
      });
    expect(at('2026-02', '2026-02').headline).toBe(
      'Your savings rate in February 2026 was below -100% — you spent $4,549.88 more than the $0.12 you brought in.',
    );
    const quarter = at('2026-01', '2026-03');
    // (1,800,012 − 1,355,000) ÷ 1,800,012 = 24.72…%
    expect(quarter.headline).toBe(
      'Your savings rate from January to March 2026 was 24.7% — you kept $4,450.12 of the $18,000.12 you brought in.',
    );
    expect(quarter.facts.find((f) => f.label === 'Feb 2026')?.value).toBe('below -100%');
    expect(JSON.stringify(quarter)).not.toMatch(/\d{4,}\.\d%/);
  });

  it('critic cycle 1 F4: one rounding, from integer tenths — 27.45% is 27.5%, never 27.4%', () => {
    expect(bpsToPct1dp(2745)).toBe('27.5'); // (27.45).toFixed(1) === '27.4'
    expect(bpsToPct1dp(-1450)).toBe('-14.5');
    expect(bpsToPct1dp(-4)).toBe('0.0'); // never "-0.0"
    expect(bpsToPct1dp(10000)).toBe('100.0');
    expect(savingsRatePct(RATE_FLOOR_BPS)).toBe('-100.0%');
    expect(savingsRatePct(RATE_FLOOR_BPS - 1)).toBe('below -100%');
    // /coach prints through the same rule.
    expect(formatSavingsRateBps(2745)).toBe('27.5%');
    expect(formatSavingsRateBps(-8551058)).toBe('below -100%');
  });

  it('more than 12 months: a rate per calendar year', () => {
    const a = words('2025-01', '2026-09');
    expect(a.facts.slice(3)).toEqual([
      { label: '2025 (Apr–Dec)', value: '15.9%' },
      { label: '2026 (Jan–Sep)', value: '25.0%' },
    ]);
  });

  it('follow-up chips offer the other common period, and every chip routes', () => {
    const afterYear = followUpQuestions({ kind: 'savings_rate', timeframe: { fromYm: '2025-01', toYm: '2025-12', label: '2025' } });
    expect(afterYear).toEqual(['What was my savings rate over the last 12 months?', 'Where does my money go?', 'What should I cut?']);
    const standing = followUpQuestions({ kind: 'savings_rate' });
    expect(standing[0]).toBe('What was my savings rate last year?');
    for (const q of [...afterYear, ...standing]) expect(parse(q).kind, q).not.toBe('unknown');
  });
});

// ─── D. the derivation panel ──────────────────────────────────────────────────

describe('D. the panel recomputes the period rate from its sums', () => {
  it('reconciles, and says it is a period', () => {
    const p = ok(measure('2025-01', '2025-12'));
    const trace = traceSavingsRateDerivation(
      { incomeCents: p.incomeCents, expensesCents: p.expensesCents, monthLabel: savingsPeriodPhrase(p.fromYm, p.toYm) },
      p.rateBps!,
      p.months.length,
    );
    expect(trace.reconciled).toBe(true);
    expect(derivationView(trace)).not.toBeNull();
    expect(trace.kind === 'derivation' && trace.basis[0]).toMatch(/^Every full month from April to December 2025, added up/);
    // A one-month period is not "your most recent full month".
    const one = traceSavingsRateDerivation({ incomeCents: 500_000, expensesCents: 400_000, monthLabel: 'in April 2025' }, 2000, 1);
    expect(one.kind === 'derivation' && one.basis[0]).toMatch(/^The full month in April 2025, counted the way \/coach counts it\./);
  });

  it('a builder figure that drifts from the sums does not reconcile', () => {
    const p = ok(measure('2025-01', '2025-12'));
    // The coach-card basis (June dropped) would print 21.9% over these sums.
    const drifted = traceSavingsRateDerivation(
      { incomeCents: p.incomeCents, expensesCents: p.expensesCents, monthLabel: 'in 2025' },
      2188,
      p.months.length,
    );
    expect(drifted.reconciled).toBe(false);
  });
});
