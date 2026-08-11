import { describe, expect, it } from 'vitest';
import { forecastDayBasis } from '@/lib/engine/forecast/panel';
import { cents } from '@/lib/money';

describe('forecastDayBasis (O.20d)', () => {
  it('embeds the rendered delta and the event count, singular and plural', () => {
    const basis = forecastDayBasis(cents(105_000), 2);
    expect(basis[0]).toBe(
      'The $1,050.00 is this day\'s net change to the projected balance — the 2 scheduled flows that land on it, signed.',
    );
    expect(forecastDayBasis(cents(-5000), 1)[0]).toContain('the 1 scheduled flow');
  });

  it('explicitly refuses the sum-to-balance reading — the sentence a .tsx must not invent', () => {
    const basis = forecastDayBasis(cents(100), 1);
    expect(basis[1]).toContain('cumulative');
    expect(basis[1]).toContain('never add up to the balance');
    // A negative for the forbidden claim, kept next to the positive.
    expect(basis.join(' ')).not.toMatch(/add up to exactly/i);
  });
});
