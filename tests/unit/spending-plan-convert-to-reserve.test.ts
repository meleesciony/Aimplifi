/**
 * Turn a repeating bill into a reserve from the spending plan (DECISIONS #594).
 *
 * Convert already lives on Settings FixedCostsCard via ConvertToReserveButton
 * → createReserveFromSeries. Spending plan lists the same recurring-bill lines
 * with take-off; this slice offers the existing button there. The server
 * re-derives convertibility — the page must not invent a second write path.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Spending plan surface lets the household turn a repeating bill into a reserve', () => {
  it('test_regression__household_can_turn_a_repeating_bill_into_a_reserve_from_the_spending_plan', () => {
    const page = readFileSync(resolve('src/app/(app)/spending-plan/page.tsx'), 'utf8');
    expect(page).toContain('ConvertToReserveButton');
    expect(page).toContain("from '@/components/finance/convert-to-reserve-button'");
    expect(page).not.toContain('createReserveFromSeries');
    expect(page).toContain('canEditFigures');
    expect(page).toContain('convertibleToReserve');
    expect(page).toContain('merchantCanonical === l.billKey');
    expect(page).not.toMatch(/<ConvertToReserveButton merchantCanonical=\{l\.billKey\}/);
    // Unnamed billKeys are `unnamed:…`; convert looks up by merchantCanonical,
    // which is never that prefix, so unnamed rows stay unoffered.
    expect(page).not.toContain('unnamed:');

    const button = readFileSync(
      resolve('src/components/finance/convert-to-reserve-button.tsx'),
      'utf8',
    );
    expect(button).toContain('createReserveFromSeries');
    expect(button).toContain('export function ConvertToReserveButton');
  });
});
