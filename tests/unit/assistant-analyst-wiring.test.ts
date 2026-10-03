/**
 * The analyst grammar inside the real parser: what `parseAssistantQuery` now routes to
 * a comparison or an average, what it still routes exactly where it did, that an intent
 * survives its round trip through the client, and that every comparison button reads
 * back as the question it stands for.
 */
import { describe, expect, it } from 'vitest';
import { isoDate } from '@/lib/dates';
import { CATEGORIES } from '@/lib/engine/categorize/categories';
import { followUpQuestions } from '@/lib/engine/assistant/follow-ups';
import {
  analystIntent,
  analystIntentText,
  parseAssistantQuery,
  resolveSpendTarget,
  validateIntent,
  type AssistantIntent,
  type SpendTarget,
  type Timeframe,
} from '@/lib/engine/assistant/intent';

const TODAY = isoDate('2026-10-02');
const parse = (q: string) => parseAssistantQuery(q, TODAY);
const GROCERIES = resolveSpendTarget('groceries')!;
/** The categories a comparison of spending does not take as its subject (intent.ts). */
const NOT_SPENDING = new Set(['transfer', 'credit-card-payment', 'investment', 'loan-payment']);

describe('parseAssistantQuery — the analyst grammar is read first', () => {
  it('routes a comparison, with the category resolved by the app’s own resolver', () => {
    expect(parse('Compare groceries in May to March')).toEqual({
      kind: 'spend_compare',
      currentYm: '2026-05',
      baselineYm: '2026-03',
      target: GROCERIES,
    });
    expect(parse('did I spend more last month than the month before?')).toEqual({
      kind: 'spend_compare',
      currentYm: '2026-09',
      baselineYm: '2026-08',
      target: null,
    });
  });

  it('routes an average', () => {
    expect(parse("what's my average monthly spending over the last 3 months")).toEqual({
      kind: 'spend_average',
      fromYm: '2026-07',
      toYm: '2026-09',
      months: 3,
      target: null,
    });
  });

  it('leaves every question outside the grammar exactly where it went before', () => {
    const cases: [string, AssistantIntent['kind']][] = [
      ['How much did I spend in May?', 'spend_total'],
      ['How much did I spend on groceries last month?', 'spend_by_category'],
      ['What were my top spending categories last month?', 'top_categories'],
      ['What was my biggest purchase in May?', 'largest_purchases'],
      ['How much did I make in May?', 'income'],
      ['What is my net worth?', 'net_worth'],
      ['What is my savings rate?', 'savings_rate'],
      ['How much do I need to pay my cards?', 'cash_needed'],
    ];
    for (const [q, kind] of cases) expect(parse(q).kind, q).toBe(kind);
  });

  it('a sentence that only CONTAINS the grammar’s words is not claimed', () => {
    for (const q of [
      'how much did I spend on average on groceries',
      'is my spending above average',
      'compare my net worth to last year',
      'how does May compare to March at Costco',
      'what is my average balance',
    ]) {
      const kind = parse(q).kind;
      expect(kind, q).not.toBe('spend_compare');
      expect(kind, q).not.toBe('spend_average');
    }
  });
});

describe('validateIntent — the intent round-trips through the client', () => {
  const compare: AssistantIntent = { kind: 'spend_compare', currentYm: '2026-05', baselineYm: '2026-03', target: GROCERIES };
  const average: AssistantIntent = { kind: 'spend_average', fromYm: '2026-04', toYm: '2026-09', months: 6, target: null };

  it('accepts what the parser produced, serialized and back', () => {
    expect(validateIntent(JSON.parse(JSON.stringify(compare)))).toEqual(compare);
    expect(validateIntent(JSON.parse(JSON.stringify(average)))).toEqual(average);
  });

  it('relabels a target from its own identity, never from the client’s label', () => {
    const forged = { ...compare, target: { ...GROCERIES, label: 'Everything you ever bought' } };
    const back = validateIntent(forged);
    expect(back && back.kind === 'spend_compare' ? back.target?.label : null).toBe(GROCERIES.label);
  });

  it('refuses malformed months, an unknown target, and an average whose run and count disagree', () => {
    const bad: unknown[] = [
      { ...compare, currentYm: '2026-13' },
      { ...compare, baselineYm: 'March' },
      { ...compare, currentYm: undefined },
      { ...compare, target: { type: 'category', categoryId: 'no-such-category', label: 'x' } },
      { ...compare, target: 'groceries' },
      { ...average, months: 5 }, // Apr…Sep is six
      { ...average, months: 1, fromYm: '2026-09' },
      { ...average, months: 25, fromYm: '2024-09' },
      { ...average, months: 6.5 },
      { ...average, toYm: '2026-9' },
    ];
    for (const x of bad) expect(validateIntent(x), JSON.stringify(x)).toBeNull();
  });
});

describe('every comparison button reads back as the question it stands for', () => {
  const months = ['2024-11', '2025-12', '2026-01', '2026-05', '2026-09'];

  it('for all spending, every built-in spending category and every group', () => {
    // Income categories are not spending: a comparison of them would be $0.00 against $0.00.
    const spendCategories = CATEGORIES.filter((c) => c.group !== 'Income');
    const groups = [...new Set(spendCategories.map((c) => c.group))];
    const targets: (SpendTarget | null)[] = [
      null,
      ...spendCategories.map((c): SpendTarget => ({ type: 'category', categoryId: c.id, label: c.name })),
      // A group as the parser itself produces one — the resolver labels it with the words
      // the reader used — not a hand-built object no question would yield.
      ...groups.map((g) => resolveSpendTarget(g.toLowerCase())).filter((t): t is SpendTarget => t?.type === 'group'),
    ];
    let offered = 0;
    let withheld = 0;
    for (const target of targets) {
      for (const ym of months) {
        const tf: Timeframe = { fromYm: ym, toYm: ym, label: 'x' };
        const chips =
          target === null
            ? followUpQuestions({ kind: 'spend_total', timeframe: tf }, TODAY)
            : followUpQuestions({ kind: 'spend_by_category', timeframe: tf, target }, TODAY);
        const chip = chips.find((c) => c.startsWith('Compare '));
        if (!chip) {
          // No button rather than a wrong one — and ONLY where the one-month question itself
          // reads this label as something else, or the subject is not spending (critic
          // cycle 1, F2/F3: a comparison reads a category exactly as the one-month question does).
          if (target !== null) {
            const oneMonth = parse(`how much did i spend on ${target.label.toLowerCase()} last month`);
            const sameReading = oneMonth.kind === 'spend_by_category' && JSON.stringify(oneMonth.target) === JSON.stringify(target);
            // A group is a spending subject only if every category in it is (intent.ts).
            const spending =
              target.type === 'category'
                ? !NOT_SPENDING.has(target.categoryId)
                : target.type === 'group'
                  ? CATEGORIES.filter((c) => c.group === target.group).every((c) => !NOT_SPENDING.has(c.id) && c.group !== 'Income')
                  : true;
            expect(sameReading && spending, `withheld although the one-month question reads it the same: ${target.label}`).toBe(false);
          }
          withheld++;
          continue;
        }
        offered++;
        const back = analystIntent(chip, TODAY);
        expect(back, chip).not.toBeNull();
        expect(back!.kind).toBe('spend_compare');
        if (back!.kind === 'spend_compare') {
          expect(back!.currentYm, chip).toBe(ym);
          expect(JSON.stringify(back!.target), chip).toBe(JSON.stringify(target));
          // …and the text of the intent it reads to is the chip itself.
          expect(analystIntentText(back!)).toBe(chip);
        }
      }
    }
    // Withheld only for the reasons asserted above. All spending and every group are offered.
    expect(offered).toBeGreaterThan(200);
    expect(withheld).toBeGreaterThan(0);
  });

  it('a category the one-month question reads by its own name gets the button; one it reads otherwise does not', () => {
    const chipFor = (target: SpendTarget) =>
      followUpQuestions({ kind: 'spend_by_category', timeframe: { fromYm: '2026-05', toYm: '2026-05', label: 'x' }, target }, TODAY).find(
        (c) => c.startsWith('Compare '),
      );
    expect(chipFor(GROCERIES)).toBe('Compare Groceries spending in May 2026 to April 2026');
    // "Credit Card Payment" is not a spending subject: its rows are transfers.
    expect(chipFor({ type: 'category', categoryId: 'credit-card-payment', label: 'Credit Card Payment' })).toBeUndefined();
  });

  it('an answer about the month in progress offers the two finished months behind it', () => {
    const chips = followUpQuestions({ kind: 'spend_total', timeframe: { fromYm: '2026-10', toYm: '2026-10', label: 'this month' } }, TODAY);
    expect(chips).toContain('Compare spending in September 2026 to August 2026');
  });

  it('a multi-month answer offers no comparison button', () => {
    const chips = followUpQuestions({ kind: 'spend_total', timeframe: { fromYm: '2026-01', toYm: '2026-09', label: '2026 so far' } }, TODAY);
    expect(chips.some((c) => c.startsWith('Compare '))).toBe(false);
  });

  it('a comparison offers the same month a year earlier and the six-month average; both read back', () => {
    const intent: AssistantIntent = { kind: 'spend_compare', currentYm: '2026-09', baselineYm: '2026-08', target: GROCERIES };
    const chips = followUpQuestions(intent, TODAY);
    expect(chips[0]).toBe(`Compare ${GROCERIES.label} spending in September 2026 to September 2025`);
    expect(chips[1]).toBe(`Average monthly ${GROCERIES.label} spending over the last 6 months`);
    expect(parse(chips[0]!)).toEqual({ ...intent, baselineYm: '2025-09' });
    expect(parse(chips[1]!)).toEqual({ kind: 'spend_average', fromYm: '2026-04', toYm: '2026-09', months: 6, target: GROCERIES });
    for (const c of chips) expect(parse(c).kind, c).not.toBe('unknown');
  });

  it('an average offers the last month against the one before', () => {
    const chips = followUpQuestions({ kind: 'spend_average', fromYm: '2026-04', toYm: '2026-09', months: 6, target: null }, TODAY);
    expect(chips[0]).toBe('Compare spending in September 2026 to August 2026');
    for (const c of chips) expect(parse(c).kind, c).not.toBe('unknown');
  });
});

describe('critic cycle 1 — the category slot is read exactly as the one-month question reads it', () => {
  const kindOf = (q: string) => parse(q).kind;

  it('a phrase that merely CONTAINS a category word is not that category (F1)', () => {
    for (const q of [
      'compare non-grocery spending in may to april',
      'compare medical bills in may to april',
      'compare costco groceries in may to april',
      'compare grocery delivery spending in may to april',
      'compare vet bills in may to april',
    ]) {
      expect(kindOf(q), q).not.toBe('spend_compare');
    }
  });

  it('a subject that is not spending is not compared as spending (F2)', () => {
    for (const q of [
      'compare credit card payment spending in may to april',
      'compare transfer spending in may to april',
      'compare loan payment spending in may to april',
      'compare investment & savings spending in may to april',
      'compare income in may to april',
    ]) {
      expect(kindOf(q), q).not.toBe('spend_compare');
    }
  });

  it('the comparison and the one-month figure read the same word as the same subject (F3)', () => {
    for (const word of ['vacation', 'groceries', 'restaurants', 'gas', 'utilities']) {
      const one = parse(`how much did i spend on ${word} last month`);
      const cmp = parse(`compare ${word} spending in may to april`);
      if (one.kind !== 'spend_by_category') {
        expect(cmp.kind, word).not.toBe('spend_compare');
        continue;
      }
      expect(cmp.kind, word).toBe('spend_compare');
      if (cmp.kind === 'spend_compare') expect(cmp.target, word).toEqual(one.target);
    }
    // "subscriptions" is the roster's word, not a spending category's: left where it was.
    expect(kindOf('compare subscriptions in may to april')).not.toBe('spend_compare');
  });

  it('a second month named without a year, after one named with a year, is the one before it (P2)', () => {
    expect(parse('compare groceries in may 2025 to april')).toMatchObject({ currentYm: '2025-05', baselineYm: '2025-04' });
    expect(parse('compare spending in january 2026 to december')).toMatchObject({ currentYm: '2026-01', baselineYm: '2025-12' });
    // Same name: the nearer at a tie is the later — the May a reader means (critic cycle 2, P2-4).
    expect(parse('compare spending in may 2025 to may')).toMatchObject({ currentYm: '2025-05', baselineYm: '2026-05' });
    // Without a year on the first month, each is the most recent of its name, as before.
    expect(parse('compare spending in may to april')).toMatchObject({ currentYm: '2026-05', baselineYm: '2026-04' });
  });

  it('this month against last month is a comparison — answered day for day, not refused (F3)', () => {
    expect(parse('spending this month vs last month')).toMatchObject({ kind: 'spend_compare', currentYm: '2026-10', baselineYm: '2026-09' });
    expect(parse('did i spend more this month than last month')).toMatchObject({ kind: 'spend_compare', currentYm: '2026-10', baselineYm: '2026-09' });
  });
});

describe('critic cycle 1 — a button only leads to an answer (F4)', () => {
  const OCT1 = isoDate('2026-10-01');
  const named = (today: ReturnType<typeof isoDate>) =>
    followUpQuestions({ kind: 'spend_total', timeframe: { fromYm: '2026-10', toYm: '2026-10', label: 'October 2026' } }, today);

  it('the month in progress, named, gets its comparison once a day of it has finished', () => {
    expect(named(TODAY)).toContain('Compare spending in October 2026 to September 2026');
    // On the 1st nothing of October has finished: no button that would be refused.
    expect(named(OCT1).some((c) => c.startsWith('Compare '))).toBe(false);
  });

  it('a comparison does not offer itself again', () => {
    const yearAgo: AssistantIntent = { kind: 'spend_compare', currentYm: '2026-09', baselineYm: '2025-09', target: null };
    expect(followUpQuestions(yearAgo, TODAY).some((c) => c.includes('to September 2025'))).toBe(false);
    // …nor, on the 1st, a same-month-last-year comparison of the month that has only just begun.
    const live: AssistantIntent = { kind: 'spend_compare', currentYm: '2026-10', baselineYm: '2026-09', target: null };
    // On the 1st the only comparison offered is of the two finished months behind it.
    expect(followUpQuestions(live, OCT1).filter((c) => c.startsWith('Compare '))).toEqual(['Compare spending in September 2026 to August 2026']);
    expect(followUpQuestions(live, TODAY)).toContain('Compare spending in October 2026 to October 2025');
  });
});

describe('critic cycle 2 — a proof that the phrase is the subject must be about the subject answered (N1)', () => {
  const read = (q: string, vocab: { id: string; name: string }[]) => analystIntent(q, TODAY, vocab);

  it("the reader's own category is never compared as a built-in bucket whose word it contains", () => {
    const custom = [
      { id: 'c-dog', name: 'Dog Food' },
      { id: 'c-wine', name: 'Wine Club' },
      { id: 'c-kids', name: 'Kids Clothing' },
      { id: 'c-vet', name: 'Vet Bills' },
      { id: 'c-coffee', name: 'Coffee Gear' },
    ];
    for (const [q, id] of [
      ['compare dog food spending in may to april', 'c-dog'],
      ['compare wine club in may to april', 'c-wine'],
      ['compare kids clothing in may to april', 'c-kids'],
      ['compare vet bills in may to april', 'c-vet'],
      ['compare coffee gear spending in may to april', 'c-coffee'],
      ['average monthly dog food spending', 'c-dog'],
    ] as const) {
      const r = read(q, custom);
      // Either declined (production keeps it) or read as THAT custom category — never another bucket.
      if (r !== null) expect(r.target, q).toMatchObject({ type: 'category', categoryId: id });
    }
  });

  it('a renamed built-in inside a longer phrase is not that built-in', () => {
    const renamed = [{ id: 'groceries', name: 'Food' }];
    for (const q of ['compare fast food in may to april', 'compare food delivery spending in may to april']) {
      const r = read(q, renamed);
      if (r !== null) expect(r.target, q).not.toMatchObject({ type: 'category', categoryId: 'groceries' });
    }
    // The renamed name itself is still read as the category it names.
    expect(read('compare food spending in may to april', renamed)?.target).toMatchObject({ type: 'category', categoryId: 'groceries' });
  });

  it('a group holding a non-spending category is not compared as spending (P2-6)', () => {
    for (const q of ['compare financial spending in may to april', 'compare transfers & other spending in may to april']) {
      expect(parse(q).kind, q).not.toBe('spend_compare');
    }
  });

  it('an unyeared second month is the one of that name nearest the first; at a tie, the later (P2-4)', () => {
    expect(parse('compare spending in june 2025 to june')).toMatchObject({ currentYm: '2025-06', baselineYm: '2026-06' });
    expect(parse('compare spending in december 2025 to january')).toMatchObject({ currentYm: '2025-12', baselineYm: '2026-01' });
    expect(parse('compare groceries in may 2025 to april')).toMatchObject({ currentYm: '2025-05', baselineYm: '2025-04' });
    // Never a month still to come: from October 2026, "May 2026 to December" is December 2025.
    expect(parse('compare spending in may 2026 to december')).toMatchObject({ currentYm: '2026-05', baselineYm: '2025-12' });
  });
});

describe('critic cycle 2 — a button is read back the way the tap will be (N2)', () => {
  const renamed = [{ id: 'groceries', name: 'Food' }];

  it("every chip under a comparison names the same subject when read with the reader's own words", () => {
    const delivery = parseAssistantQuery('how much did i spend on doordash last month', TODAY, renamed);
    expect(delivery.kind).toBe('spend_by_category');
    if (delivery.kind !== 'spend_by_category') return;
    const intent: AssistantIntent = { kind: 'spend_compare', currentYm: '2026-05', baselineYm: '2026-04', target: delivery.target };
    for (const chip of followUpQuestions(intent, TODAY, renamed)) {
      const back = parseAssistantQuery(chip, TODAY, renamed);
      if ('target' in back && back.target) expect(back.target, chip).toEqual(delivery.target);
    }
  });

  it('no "last month" chip that answers a different subject than the comparison above it', () => {
    const group = resolveSpendTarget('bills & utilities');
    expect(group).not.toBeNull();
    const intent: AssistantIntent = { kind: 'spend_compare', currentYm: '2026-05', baselineYm: '2026-04', target: group };
    for (const chip of followUpQuestions(intent, TODAY)) {
      const back = parse(chip);
      if (back.kind === 'spend_by_category') expect(back.target, chip).toEqual(group);
    }
  });

  it('on the 1st, a comparison of the month just begun offers the two finished months behind it (P2-2)', () => {
    const live: AssistantIntent = { kind: 'spend_compare', currentYm: '2026-10', baselineYm: '2026-09', target: null };
    expect(followUpQuestions(live, isoDate('2026-10-01'))[0]).toBe('Compare spending in September 2026 to August 2026');
  });
});
