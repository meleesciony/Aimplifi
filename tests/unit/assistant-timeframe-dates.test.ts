/**
 * TASKS 2.7(a) — bare-year, "since", range, and numeric-date windows (#230).
 *
 * Deferred from 2.6 (STATUS §OPEN item 4), and worse than recorded: these were
 * not all honest redirects. Reproduced live before this slice, unhedged:
 *   - "groceries in 2025"            → the Groceries THIS-MONTH figure
 *   - "how much did I spend since 2024"        → the THIS-MONTH total
 *   - "how much did I spend between 2024 and 2025" → the THIS-MONTH total
 *   - "since march" → the March-only window for a March-through-today question
 * (the #229 licence scans at/with/on/in objects, and "since 2024" has none).
 *
 * The fix has two halves, and the guard reads exactly what the parser reads
 * (docs/lessons/a-guard-must-read-what-it-guards.md):
 *   1. `parseExplicitTimeframe` learns bare years ("in 2025"), "since <year|month>",
 *      year ranges ("between 2024 and 2025"), and numeric dates ("3/5", "3/2025",
 *      "3/5/2025") — numeric DAY forms resolve to the containing MONTH window,
 *      the same shipped rule as the worded "on March 5". One shared token
 *      recognizer feeds the parser, the #229 licence, and the merchant-phrase
 *      ender, so the three can never disagree.
 *   2. A question that contains a date SHAPE the parser could not resolve into a
 *      window (a future year, "13/5", a two-digit year) ABSTAINS on every
 *      timeframe-carrying route — parser and `intentFromKind` alike — instead of
 *      silently answering the default this-month window. Future years are NOT
 *      windows: "how much will I spend in 2027" is a forecast question, and a
 *      past-tense figure under it answers a different question.
 *
 * TODAY = 2026-07-14 → this month 2026-07; month > 7 without a year → 2025.
 */
import { describe, expect, it } from 'vitest';
import { isoDate } from '@/lib/dates';
import {
  parseAssistantQuery,
  parseExplicitTimeframe,
  unconsumedSpendObject,
} from '@/lib/engine/assistant/intent';
import { intentFromKind } from '@/lib/engine/assistant/llm';
import { frameFromIntent, resolveEllipsis } from '@/lib/engine/assistant/frame';

const TODAY = isoDate('2026-07-14');

describe('bare-year windows (in 2025 / 2025 spending)', () => {
  it('a past year is that whole calendar year', () => {
    expect(parseExplicitTimeframe('how much did i spend in 2025', TODAY)).toEqual({
      fromYm: '2025-01',
      toYm: '2025-12',
      label: 'in 2025',
    });
  });

  it('the current year runs January through today (the YTD window and label)', () => {
    expect(parseExplicitTimeframe('spending in 2026', TODAY)).toEqual({
      fromYm: '2026-01',
      toYm: '2026-07',
      label: '2026 so far',
    });
  });

  it('routes: spend_total, category, merchant, and income all get the year window', () => {
    expect(parseAssistantQuery('how much did i spend in 2025', TODAY)).toMatchObject({
      kind: 'spend_total',
      timeframe: { fromYm: '2025-01', toYm: '2025-12', label: 'in 2025' },
    });
    // REGRESSION (unhedged wrong-window, pre-2.7): answered the THIS-MONTH
    // Groceries figure for a question about 2025.
    expect(parseAssistantQuery('how much did i spend on groceries in 2025', TODAY)).toMatchObject({
      kind: 'spend_by_category',
      timeframe: { fromYm: '2025-01', toYm: '2025-12' },
      target: { categoryId: 'groceries' },
    });
    expect(parseAssistantQuery('how much did i spend at costco in 2025', TODAY)).toMatchObject({
      kind: 'merchant_spend',
      merchant: 'costco',
      timeframe: { fromYm: '2025-01', toYm: '2025-12' },
    });
    expect(parseAssistantQuery('how much did i make in 2025', TODAY)).toMatchObject({
      kind: 'income',
      timeframe: { fromYm: '2025-01', toYm: '2025-12' },
    });
  });

  it('a month name with an adjacent year still wins over the bare-year rule', () => {
    expect(parseExplicitTimeframe('in june 2025', TODAY)).toEqual({
      fromYm: '2025-06',
      toYm: '2025-06',
      label: 'June 2025',
    });
  });

  it('a dollar figure is never a year, and pre-2000 years are not windows', () => {
    expect(parseExplicitTimeframe('did i save $2025', TODAY)).toBeNull();
    expect(parseExplicitTimeframe('spend in 1999', TODAY)).toBeNull();
    // "in 1999" stays the honest unknown (the licence never consumed "1999").
    expect(parseAssistantQuery('how much did i spend in 1999', TODAY).kind).toBe('unknown');
  });
});

describe('"since" windows', () => {
  it('since <year> runs that January through today', () => {
    expect(parseExplicitTimeframe('how much did i spend since 2024', TODAY)).toEqual({
      fromYm: '2024-01',
      toYm: '2026-07',
      label: 'since 2024',
    });
  });

  it('since <month> runs the most recent past occurrence through today', () => {
    expect(parseExplicitTimeframe('since march', TODAY)).toEqual({
      fromYm: '2026-03',
      toYm: '2026-07',
      label: 'since March 2026',
    });
    expect(parseExplicitTimeframe('since september', TODAY)).toEqual({
      fromYm: '2025-09',
      toYm: '2026-07',
      label: 'since September 2025',
    });
    expect(parseExplicitTimeframe('since june 2025', TODAY)).toEqual({
      fromYm: '2025-06',
      toYm: '2026-07',
      label: 'since June 2025',
    });
  });

  it('since last month spans last month through today', () => {
    expect(parseExplicitTimeframe('since last month', TODAY)).toEqual({
      fromYm: '2026-06',
      toYm: '2026-07',
      label: 'since last month',
    });
  });

  it('REGRESSION: "since 2024" / "since march" no longer answer a different window', () => {
    // Pre-2.7: "since 2024" → the unhedged THIS-MONTH total; "since march" →
    // the March-only window for a March-through-today question.
    expect(parseAssistantQuery('how much did i spend since 2024', TODAY)).toMatchObject({
      kind: 'spend_total',
      timeframe: { fromYm: '2024-01', toYm: '2026-07', label: 'since 2024' },
    });
    expect(parseAssistantQuery('how much did i spend since march', TODAY)).toMatchObject({
      kind: 'spend_total',
      timeframe: { fromYm: '2026-03', toYm: '2026-07', label: 'since March 2026' },
    });
  });
});

describe('year ranges', () => {
  it('"between X and Y" / "from X to Y" / hyphenated spans both years', () => {
    const want = { fromYm: '2024-01', toYm: '2025-12', label: 'in 2024–2025' };
    expect(parseExplicitTimeframe('between 2024 and 2025', TODAY)).toEqual(want);
    expect(parseExplicitTimeframe('from 2024 to 2025', TODAY)).toEqual(want);
    expect(parseExplicitTimeframe('spending 2024-2025', TODAY)).toEqual(want);
  });

  it('a range ending in the current year clamps to today', () => {
    // A range ending in the CURRENT year IS "since <lo>" (the same window,
    // lo-January through today) — labeled that way so the frame's staleness
    // re-labeling covers it (critic cycle 1, F8).
    expect(parseExplicitTimeframe('from 2024 to 2026', TODAY)).toEqual({
      fromYm: '2024-01',
      toYm: '2026-07',
      label: 'since 2024',
    });
  });

  it('REGRESSION: "between 2024 and 2025" no longer answers the this-month total', () => {
    expect(parseAssistantQuery('how much did i spend between 2024 and 2025', TODAY)).toMatchObject({
      kind: 'spend_total',
      timeframe: { fromYm: '2024-01', toYm: '2025-12' },
    });
  });
});

describe('numeric dates (US M/D, M/YYYY, M/D/YYYY) — the containing month window', () => {
  it('M/D resolves to the most recent non-future occurrence of that month', () => {
    // The same shipped rule as the worded "on March 5": the containing MONTH
    // window, disclosed by the label.
    expect(parseAssistantQuery('how much did i spend on 3/5', TODAY)).toMatchObject({
      kind: 'spend_total',
      timeframe: { fromYm: '2026-03', toYm: '2026-03', label: 'March 2026' },
    });
    expect(parseExplicitTimeframe('on 12/25', TODAY)).toEqual({
      fromYm: '2025-12',
      toYm: '2025-12',
      label: 'December 2025',
    });
  });

  it('M/YYYY and M/D/YYYY name the month and year explicitly', () => {
    expect(parseExplicitTimeframe('in 3/2025', TODAY)).toEqual({
      fromYm: '2025-03',
      toYm: '2025-03',
      label: 'March 2025',
    });
    expect(parseExplicitTimeframe('on 3/5/2025', TODAY)).toEqual({
      fromYm: '2025-03',
      toYm: '2025-03',
      label: 'March 2025',
    });
  });
});

// ── Abstentions: the majority, per docs/lessons (context features are judged by
// what they abstain on). A date SHAPE the parser cannot resolve into a window
// must abstain the whole route — never fall back to a silent this-month figure.
describe('abstentions — unresolvable date shapes', () => {
  it('future years are not windows, on any route', () => {
    for (const q of [
      'how much will i spend in 2027',
      'how much did i spend in 2027',
      'how much did i spend since 2027',
      'how much did i spend on groceries in 2027', // was: this-month Groceries
      'how much did i spend at costco in 2027',
      'how much did i make in 2027',
      'top categories in 2027',
    ]) {
      expect(parseAssistantQuery(q, TODAY).kind, q).toBe('unknown');
    }
  });

  it('invalid or ambiguous numeric dates abstain', () => {
    for (const q of [
      'how much did i spend on 13/5', // no 13th month; we do not guess DD/MM
      'how much did i spend on 3/45', // no 45th day
      'how much did i spend on 2/30', // February has no 30th
      'how much did i spend on 3/5/26', // two-digit year: ambiguous, not parsed
      'how much did i spend on 3/5/2027', // future
      'how much did i spend on groceries on 13/5', // was: this-month Groceries
    ]) {
      expect(parseAssistantQuery(q, TODAY).kind, q).toBe('unknown');
    }
  });

  it('a mixed valid+future year list abstains rather than half-answering', () => {
    expect(parseExplicitTimeframe('between 2024 and 2027', TODAY)).toBeNull();
    expect(parseAssistantQuery('how much did i spend between 2024 and 2027', TODAY).kind).toBe('unknown');
  });

  it('test_regression__month_name_beside_a_future_year_escaped_every_refusal (critic cycle 1, F3)', () => {
    // "in march 2027" resolved through the month loop's year fallback — a
    // definitive past-tense answer about a window years in the future — and
    // "since march 2027" fell through the since-rule only to be claimed as a
    // March-2027-ONLY window, the "since" silently discarded.
    expect(parseExplicitTimeframe('in march 2027', TODAY)).toBeNull();
    expect(parseExplicitTimeframe('since march 2027', TODAY)).toBeNull();
    for (const q of [
      'how much did i spend in march 2027',
      'how much did i spend since march 2027',
      'how much did i make in december 2030',
      'biggest purchase in march 2027',
    ]) {
      expect(parseAssistantQuery(q, TODAY).kind, q).toBe('unknown');
    }
    // …while past month+year windows are untouched.
    expect(parseExplicitTimeframe('in june 2025', TODAY)?.fromYm).toBe('2025-06');
  });

  it('test_regression__year_shapes_the_parser_cannot_see_took_the_this_month_default (critic cycle 1, F6)', () => {
    // "2025/26" and "fy2025" are date shapes no rule windows; income had no
    // licence, so both answered the silent this-month default.
    for (const q of [
      'how much did i make in the 2025/26 season',
      'how much did i make in fy2025',
      'how much did i spend in fy 25',
    ]) {
      expect(parseAssistantQuery(q, TODAY).kind, q).toBe('unknown');
    }
  });

  it('"since last year" runs from last January through today (critic cycle 1, F5)', () => {
    expect(parseExplicitTimeframe('since last year', TODAY)).toEqual({
      fromYm: '2025-01',
      toYm: '2026-07',
      label: 'since last year',
    });
    expect(parseAssistantQuery('how much did i spend since last year', TODAY)).toMatchObject({
      kind: 'spend_total',
      timeframe: { fromYm: '2025-01', toYm: '2026-07' },
    });
  });

  it('a resolved window elsewhere does not license an unrelated wrong-window answer', () => {
    // The guard abstains exactly when NO explicit window resolved; a real window
    // plus prose keeps its answer (no false abstain).
    expect(parseAssistantQuery('how much did i spend in june 2025', TODAY).kind).toBe('spend_total');
  });
});

describe('the #229 licence consumes exactly what the parser windows', () => {
  it('parsed date tokens are consumed', () => {
    expect(unconsumedSpendObject('how much did i spend in 2025', TODAY)).toBeNull();
    expect(unconsumedSpendObject('how much did i spend on 3/5', TODAY)).toBeNull();
    expect(unconsumedSpendObject('how much did i spend in 3/2025', TODAY)).toBeNull();
  });

  it('unparseable date tokens are NOT consumed', () => {
    expect(unconsumedSpendObject('how much will i spend in 2027', TODAY)).toBe('2027');
    expect(unconsumedSpendObject('how much did i spend on 13/5', TODAY)).toBe('13/5');
  });

  it('a store name next to a date still withholds the licence', () => {
    expect(unconsumedSpendObject('at best buy, how much did i spend in 2025', TODAY)).toBe('buy');
    expect(parseAssistantQuery('at costco, how much did i spend in 2025', TODAY).kind).toBe('unknown');
  });
});

describe('a date token ends a merchant phrase', () => {
  it('"at costco 2025" is the store costco in the 2025 window', () => {
    expect(parseAssistantQuery('how much did i spend at costco 2025', TODAY)).toMatchObject({
      kind: 'merchant_spend',
      merchant: 'costco',
      timeframe: { fromYm: '2025-01', toYm: '2025-12' },
    });
  });

  it('an all-numeric store name that is NOT a date shape survives ("at 76")', () => {
    expect(parseAssistantQuery('how much did i spend at 76 last month', TODAY)).toMatchObject({
      kind: 'merchant_spend',
      merchant: '76',
    });
  });
});

describe('intentFromKind enforces the same windows and abstentions', () => {
  it('re-derives the year window for LLM/vocab-routed kinds', () => {
    expect(intentFromKind('spend_total', 'how much did i spend in 2025', TODAY)).toMatchObject({
      kind: 'spend_total',
      timeframe: { fromYm: '2025-01', toYm: '2025-12' },
    });
    expect(intentFromKind('income', 'what did i earn since 2024', TODAY)).toMatchObject({
      kind: 'income',
      timeframe: { fromYm: '2024-01', toYm: '2026-07' },
    });
  });

  it('abstains on the shapes the parser abstains on (no route re-answers them)', () => {
    expect(intentFromKind('spend_total', 'how much will i spend in 2027', TODAY)).toBeNull();
    expect(intentFromKind('income', 'how much did i make in 2027', TODAY)).toBeNull();
    expect(intentFromKind('spend_by_category', 'groceries in 2027', TODAY)).toBeNull();
    expect(intentFromKind('top_categories', 'top categories on 13/5', TODAY)).toBeNull();
    expect(intentFromKind('largest_purchases', 'biggest purchase in 2027', TODAY)).toBeNull();
  });
});

describe('the conversation frame', () => {
  const frameAfter = (q: string) => {
    const intent = parseAssistantQuery(q, TODAY);
    expect(intent.kind).not.toBe('unknown');
    return frameFromIntent(intent);
  };

  it('a year fragment swaps the window ("what about 2025?")', () => {
    const frame = frameAfter('how much did i spend this month');
    expect(resolveEllipsis('what about 2025?', TODAY, frame)).toMatchObject({
      kind: 'spend_total',
      timeframe: { fromYm: '2025-01', toYm: '2025-12', label: 'in 2025' },
    });
  });

  it('a since/numeric fragment swaps the window too', () => {
    const frame = frameAfter('how much did i spend on groceries this month');
    expect(resolveEllipsis('since 2024?', TODAY, frame)).toMatchObject({
      kind: 'spend_by_category',
      timeframe: { fromYm: '2024-01', toYm: '2026-07' },
    });
    expect(resolveEllipsis('what about 3/2025?', TODAY, frame)).toMatchObject({
      kind: 'spend_by_category',
      timeframe: { fromYm: '2025-03', toYm: '2025-03' },
    });
  });

  it('test_regression__the_frame_silently_dropped_an_unresolvable_date (critic cycle 1, F4)', () => {
    // "what about groceries in 2027?" resolved the category, found no
    // timeframe, and answered the CARRIED window — last month's groceries
    // under a question about 2027, the 2.6 silent-drop disease for dates.
    const frame = frameAfter('how much did i spend last month');
    expect(resolveEllipsis('what about groceries in 2027?', TODAY, frame)).toBeNull();
    expect(resolveEllipsis('what about groceries on 13/5?', TODAY, frame)).toBeNull();
    // …while a RESOLVABLE date swaps normally.
    expect(resolveEllipsis('what about groceries in 2025?', TODAY, frame)).toMatchObject({
      kind: 'spend_by_category',
      timeframe: { fromYm: '2025-01', toYm: '2025-12' },
    });
  });

  it('ABSTAINS on a future-year fragment instead of reading it as a store', () => {
    // Pre-2.7 "what about 2025?" resolved to the MERCHANT "2025" and answered a
    // confident-wrong "No spending at 2025 this month." A date-shaped fragment
    // that parses is a window; one that does not is nobody's store name.
    const frame = frameAfter('how much did i spend this month');
    expect(resolveEllipsis('what about 2027?', TODAY, frame)).toBeNull();
    expect(resolveEllipsis('what about 13/5?', TODAY, frame)).toBeNull();
  });

  it('re-labels a carried "since"/"so far" window once today moves past it', () => {
    // "since 2024" framed with toYm 2026-07 is a lie in August — the window
    // never moves, so the label must stop implying "through today".
    const stale = {
      kind: 'spend_total' as const,
      timeframe: { fromYm: '2024-01', toYm: '2026-07', label: 'since 2024' },
    };
    const later = isoDate('2026-09-02');
    expect(resolveEllipsis('what about groceries?', later, stale)).toMatchObject({
      kind: 'spend_by_category',
      timeframe: { fromYm: '2024-01', toYm: '2026-07', label: 'January 2024 – July 2026' },
    });
  });
});
