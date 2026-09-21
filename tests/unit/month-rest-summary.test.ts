import { describe, expect, it } from 'vitest';
import { monthRestSummary } from '@/lib/coach/month-rest-summary';

describe('monthRestSummary', () => {
  it('names only the claims that render', () => {
    expect(
      monthRestSummary({ automation: false, fulfillment: false, receipts: false }),
    ).toBe('Lifestyle creep, room for error, hours, and the monthly review');
    expect(
      monthRestSummary({ automation: true, fulfillment: false, receipts: false }),
    ).toBe('Lifestyle creep, room for error, the automation blueprint, hours, and the monthly review');
    expect(
      monthRestSummary({ automation: false, fulfillment: true, receipts: false }),
    ).toBe('Lifestyle creep, room for error, hours, life energy by category, and the monthly review');
    expect(
      monthRestSummary({ automation: false, fulfillment: false, receipts: true }),
    ).toBe('Lifestyle creep, room for error, hours, what Aimplifi caught, and the monthly review');
    expect(
      monthRestSummary({ automation: true, fulfillment: true, receipts: false }),
    ).toBe(
      'Lifestyle creep, room for error, the automation blueprint, hours, life energy by category, and the monthly review',
    );
    expect(
      monthRestSummary({ automation: true, fulfillment: false, receipts: true }),
    ).toBe(
      'Lifestyle creep, room for error, the automation blueprint, hours, what Aimplifi caught, and the monthly review',
    );
    expect(
      monthRestSummary({ automation: false, fulfillment: true, receipts: true }),
    ).toBe(
      'Lifestyle creep, room for error, hours, life energy by category, what Aimplifi caught, and the monthly review',
    );
    expect(
      monthRestSummary({ automation: true, fulfillment: true, receipts: true }),
    ).toBe(
      'Lifestyle creep, room for error, the automation blueprint, hours, life energy by category, what Aimplifi caught, and the monthly review',
    );
  });
});
