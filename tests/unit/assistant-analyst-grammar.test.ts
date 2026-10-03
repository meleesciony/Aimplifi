/**
 * The analyst grammar: what it reads, what it leaves alone, and that everything it
 * prints reads back as itself.
 */
import { describe, expect, it } from 'vitest';
import { isoDate } from '@/lib/dates';
import {
  analystMonthLabel,
  analystQuestionText,
  readAnalystQuestion,
  type AnalystIntent,
  type AnalystTarget,
} from '@/lib/engine/assistant/analyst-grammar';

const TODAY = isoDate('2026-10-02');

/** A stand-in for the app's category resolver: a few names and a synonym. */
const TABLE: Record<string, AnalystTarget<string>> = {
  dining: { target: 'dining', label: 'Dining Out' },
  'dining out': { target: 'dining', label: 'Dining Out' },
  groceries: { target: 'groceries', label: 'Groceries' },
  'food and drink': { target: 'group:food', label: 'Food and Drink' },
  'gas & fuel': { target: 'fuel', label: 'Gas & Fuel' },
};
/** Like the real resolver, it finds a known name ANYWHERE in the phrase — the grammar must not lean on that. */
const reader = (phrase: string) => {
  const hit = Object.keys(TABLE)
    .sort((a, b) => b.length - a.length)
    .find((k) => phrase.includes(k));
  return hit ? TABLE[hit]! : null;
};
const read = (q: string, today = TODAY) => readAnalystQuestion(q, today, reader);

const DINING = TABLE.dining!;
const compare = (currentYm: string, baselineYm: string, target: AnalystTarget<string> | null = null) =>
  ({ kind: 'spend_compare', currentYm, baselineYm, target }) as const;
const average = (months: number, target: AnalystTarget<string> | null = null) => {
  const from = { 2: '2026-08', 3: '2026-07', 6: '2026-04', 12: '2025-10', 24: '2024-10' }[months]!;
  return { kind: 'spend_average', fromYm: from, toYm: '2026-09', months, target } as const;
};

describe('reads — compare', () => {
  it.each([
    ['compare May to March', compare('2026-05', '2026-03')],
    ['Compare my spending in May to March?', compare('2026-05', '2026-03')],
    ['compare spending for may 2026 with march 2025', compare('2026-05', '2025-03')],
    ['compare dining in May vs. March', compare('2026-05', '2026-03', DINING)],
    ['compare my dining spending during sept and aug', compare('2026-09', '2026-08', DINING)],
    ['compare Dining Out spending in September 2026 to August 2026', compare('2026-09', '2026-08', DINING)],
    ['compare food and drink in may against april', compare('2026-05', '2026-04', TABLE['food and drink']!)],
    ['compare gas & fuel spend in jan to feb', compare('2026-01', '2026-02', TABLE['gas & fuel']!)],
    ['compare total spending in may to march', compare('2026-05', '2026-03')],
    ['May vs March', compare('2026-05', '2026-03')],
    ['dining may versus march', compare('2026-05', '2026-03', DINING)],
    ['my groceries spending in may vs april', compare('2026-05', '2026-04', TABLE.groceries!)],
    ['last month vs the month before', compare('2026-09', '2026-08')],
    ['compare last month to the same month last year', compare('2026-09', '2025-09')],
    ['did I spend more in May than March', compare('2026-05', '2026-03')],
    ['did i spend less on dining in may than in march?', compare('2026-05', '2026-03', DINING)],
    ['did i spend more on groceries last month than the month before', compare('2026-09', '2026-08', TABLE.groceries!)],
  ])('%s', (q, want) => {
    expect(read(q)).toEqual(want);
  });

  it('a month named without a year is its most recent occurrence, the one in progress included', () => {
    expect(read('compare october to september')).toEqual(compare('2026-10', '2026-09'));
    expect(read('compare november to december')).toEqual(compare('2025-11', '2025-12'));
    expect(read('compare this month to last month')).toEqual(compare('2026-10', '2026-09'));
  });

  it('keeps the order the reader gave, earlier month first or not', () => {
    expect(read('compare march to may')).toEqual(compare('2026-03', '2026-05'));
  });

  it('across a year boundary', () => {
    const jan = isoDate('2026-01-15');
    expect(read('last month vs the month before', jan)).toEqual(compare('2025-12', '2025-11'));
    expect(read('compare january to december', jan)).toEqual(compare('2026-01', '2025-12'));
  });
});

describe('reads — average', () => {
  it.each([
    ['average spending', average(6)],
    ["What's my average monthly spending?", average(6)],
    ['what is my average spend', average(6)],
    ['whats my average monthly dining spending', average(6, DINING)],
    ['average monthly spending on groceries', average(6, TABLE.groceries!)],
    ['my average dining out spend over the last 3 months', average(3, DINING)],
    ['average monthly spending for the past 12 months', average(12)],
    ['average spending in last 2 months', average(2)],
    ['average food and drink spending over the last 24 months', average(24, TABLE['food and drink']!)],
  ])('%s', (q, want) => {
    expect(read(q)).toEqual(want);
  });

  it('always ends with the last finished month', () => {
    expect(read('average spending over the last 3 months', isoDate('2026-01-31'))).toEqual({
      kind: 'spend_average',
      fromYm: '2025-10',
      toYm: '2025-12',
      months: 3,
      target: null,
    });
  });
});

describe('leaves alone — anything not written in the grammar', () => {
  it.each([
    // one month, or none: an ordinary question
    'how much did I spend in May',
    'how much did I spend on dining last month',
    'compare',
    'compare my spending',
    'compare dining',
    // a third thing in the sentence
    'compare may to march and april',
    'compare may to march please',
    'compare dining in may to march at costco',
    'compare may to march for dining', // target after the months is not a shape
    // a target that says more than a category
    'compare dining at costco in may to march',
    'compare dining and groceries in may to march',
    'compare dining without tips in may to march',
    'compare netflix in may to march', // not a category
    'compare 2 dining in may to march',
    // "to" / "and" join only after "compare"
    'spending in may to march',
    'my bills from may to march',
    'dining in may and march',
    // "than" belongs to "did i spend more/less"
    'compare may than march',
    'did i spend more in may to march',
    'did i spend a lot more in may than march',
    'did we spend more in may than march',
    'was may more than march',
    // months that have not begun, or are not months
    'compare may 2027 to march',
    'compare may to march 2031',
    'compare q1 to q2',
    'compare 2025 to 2026',
    'compare last year to this year',
    'compare the month before to last month', // "the month before" is only ever the second
    // average: the shape is strict
    'average',
    'on average how much do i spend',
    'what is the average spending',
    'average dining', // "spending" is required
    'average spending over the last 1 months',
    'average spending over the last 25 months',
    'average spending over the last few months',
    'average spending since may',
    'average spending per week',
    'average daily spending',
    'average dining and groceries spending',
    'what is my average balance',
    'above average spending',
    '',
    '   ',
  ])('%s', (q) => {
    expect(read(q)).toBeNull();
  });
});

describe('prints — and reads its own printing back', () => {
  it('a compare and an average, as sentences', () => {
    expect(analystQuestionText(compare('2026-09', '2026-08', DINING))).toBe(
      'Compare Dining Out spending in September 2026 to August 2026',
    );
    expect(analystQuestionText(compare('2026-09', '2025-09'))).toBe('Compare spending in September 2026 to September 2025');
    expect(analystQuestionText(average(6, DINING))).toBe('Average monthly Dining Out spending over the last 6 months');
    expect(analystQuestionText(average(3))).toBe('Average monthly spending over the last 3 months');
    expect(analystMonthLabel('2026-01')).toBe('January 2026');
  });

  it('every printable intent round-trips: all targets × month pairs × run lengths', () => {
    const targets = [null, ...new Set(Object.values(TABLE))];
    const yms = ['2024-10', '2025-01', '2025-09', '2025-12', '2026-05', '2026-08', '2026-09', '2026-10'];
    const intents: AnalystIntent<string>[] = [];
    for (const target of targets) {
      for (const a of yms) for (const b of yms) if (a !== b) intents.push(compare(a, b, target));
      for (const n of [2, 3, 6, 12, 24]) intents.push(average(n, target));
    }
    expect(intents.length).toBe(targets.length * (8 * 7 + 5));
    for (const intent of intents) {
      const text = analystQuestionText(intent);
      expect(read(text), text).toEqual(intent);
    }
  });
});
