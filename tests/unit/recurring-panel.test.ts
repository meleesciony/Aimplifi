/**
 * O.18c — the copy contract of the /recurring charges panel, locked as pure
 * sentences (a rule that lives in a .tsx cannot be locked; the repo has no
 * component-rendering harness). The e2e locks the wiring — that the panel
 * renders these exact sentences around the row's own figure.
 */
import { describe, expect, it } from 'vitest';
import {
  declaredRhythmSentence,
  detectedRhythmSentence,
  priceChangeSentence,
  recurringPanelSentences,
  spanSentence,
  typicalNotTotalSentence,
} from '@/lib/engine/recurring/panel';

describe('typical-not-total sentence (the panel contract)', () => {
  it('quotes the RENDERED figure passed in and says it is not the total', () => {
    expect(typicalNotTotalSentence('$17.99', 8, 'charge')).toBe(
      'The $17.99 above is this payee\'s most recent charge — the typical amount, not the total of 8 charges in the series.',
    );
  });

  it('uses deposit wording for income', () => {
    expect(typicalNotTotalSentence('$2,450.00', 26, 'deposit')).toBe(
      'The $2,450.00 above is this payee\'s most recent deposit — the typical amount, not the total of 26 deposits in the series.',
    );
  });

  it('at count 1 the sentence says what the one row proves — "not the total" would be FALSE (critic F1)', () => {
    // A declared series may carry one charge; the total of the one listed row
    // IS the figure above, so the "not the total" clause would be a literal
    // falsehood next to the row it describes. The count-1 shape gets its own
    // honest sentence instead.
    expect(typicalNotTotalSentence('$49.99', 1, 'charge')).toBe(
      'The $49.99 above is this payee\'s most recent charge — the only charge in the series.',
    );
    expect(typicalNotTotalSentence('$1,200.00', 1, 'deposit')).toBe(
      'The $1,200.00 above is this payee\'s most recent deposit — the only deposit in the series.',
    );
  });

  it('embeds the row figure verbatim — a reformat here could disagree with the row', () => {
    expect(typicalNotTotalSentence('$17.99', 21, 'charge')).toContain('$17.99');
  });
});

describe('rhythm sentences — detected vs declared (O.13f)', () => {
  it('names the cadence for a detected series', () => {
    expect(detectedRhythmSentence('MONTHLY', 21, 'charge')).toBe(
      'Detected a monthly rhythm in these 21 charges.',
    );
  });

  it('spells long cadences in plain English (the /3mo suffix is not a sentence)', () => {
    expect(detectedRhythmSentence('QUARTERLY', 3, 'charge')).toBe(
      'Detected a quarterly rhythm in these 3 charges.',
    );
    expect(detectedRhythmSentence('ANNUAL', 2, 'deposit')).toBe(
      'Detected a yearly rhythm in these 2 deposits.',
    );
  });

  it('never claims the app observed a rhythm the reader supplied', () => {
    expect(declaredRhythmSentence(false)).toBe(
      'You marked this as a bill — the rhythm is yours, not detected from your history.',
    );
    expect(declaredRhythmSentence(true)).toBe(
      'You marked this as recurring income — the rhythm is yours, not detected from your history.',
    );
  });
});

describe('price-change sentence', () => {
  it('says "price" for an expense, and the date claim is the FIRST CHARGE at the new price (critic F4)', () => {
    // `priceChangedAt` is the date of the first charge at the new price, never
    // a recorded change date — "changed … on D" would over-claim (the badge
    // precedent: no time claim the detector doesn't record).
    expect(priceChangeSentence('$15.49', '$17.99', 'Tue, Feb 3, 2026', false)).toBe(
      'The price changed from $15.49 to $17.99 — the first charge at the new price was Tue, Feb 3, 2026.',
    );
  });

  it('says "amount" for income — a raise is not a price change, and the deposit is dated the same way', () => {
    expect(priceChangeSentence('$2,000.00', '$2,200.00', 'Mon, Jan 5, 2026', true)).toBe(
      'The amount changed from $2,000.00 to $2,200.00 — the first deposit at the new amount was Mon, Jan 5, 2026.',
    );
  });
});

describe('span sentence', () => {
  it('reports the evidence window, hedged as "seen"', () => {
    expect(spanSentence('Tue, Jun 10, 2025', 'Tue, Jul 15, 2026')).toBe(
      'First seen Tue, Jun 10, 2025 · last seen Tue, Jul 15, 2026.',
    );
  });
});

describe('recurringPanelSentences — the composed panel copy', () => {
  const base = {
    cadence: 'MONTHLY' as const,
    isIncome: false,
    declaredByUser: false,
    count: 21,
    typicalRendered: '$17.99',
    priceChange: {
      fromRendered: '$15.49',
      toRendered: '$17.99',
      changedAtRendered: 'Tue, Feb 3, 2026',
    },
    span: { firstSeenRendered: 'Tue, Jun 10, 2025', lastSeenRendered: 'Tue, Jul 15, 2026' },
  };

  it('always leads with the typical-not-total contract', () => {
    const out = recurringPanelSentences(base);
    expect(out[0]).toBe(
      'The $17.99 above is this payee\'s most recent charge — the typical amount, not the total of 21 charges in the series.',
    );
  });

  it('always includes a rhythm sentence — detected or declared, never neither', () => {
    const detected = recurringPanelSentences(base);
    expect(detected).toContain('Detected a monthly rhythm in these 21 charges.');
    const declared = recurringPanelSentences({ ...base, declaredByUser: true });
    expect(declared).toContain('You marked this as a bill — the rhythm is yours, not detected from your history.');
  });

  it('adds the price-change sentence only when the detector recorded one', () => {
    const withChange = recurringPanelSentences(base);
    expect(withChange).toContain('The price changed from $15.49 to $17.99 — the first charge at the new price was Tue, Feb 3, 2026.');
    const without = recurringPanelSentences({ ...base, priceChange: null });
    expect(without.some((s) => s.includes('changed from'))).toBe(false);
  });

  it('closes with the span sentence', () => {
    const out = recurringPanelSentences(base);
    expect(out[out.length - 1]).toBe('First seen Tue, Jun 10, 2025 · last seen Tue, Jul 15, 2026.');
  });

  it('uses deposit wording throughout for income series', () => {
    const out = recurringPanelSentences({
      ...base,
      isIncome: true,
      typicalRendered: '$2,450.00',
      cadence: 'BIWEEKLY',
      count: 26,
    });
    expect(out[0]).toContain('most recent deposit');
    expect(out[0]).toContain('not the total of 26 deposits in the series');
    expect(out).toContain('Detected a biweekly rhythm in these 26 deposits.');
  });
});
