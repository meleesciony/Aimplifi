/**
 * Live 2026-09-01: Starbucks showed Food Delivery. Direct Starbucks is Coffee
 * Shops. Food Delivery only when the charge is through DoorDash / Uber Eats /
 * Grubhub / similar. Do not invent a leaf. A reader's renameTo is untouched.
 */
import { describe, expect, it } from 'vitest';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { registerDisplayName } from '@/lib/engine/transactions/display-name';

describe('Starbucks is Food Delivery only through a delivery app (DECISIONS #539)', () => {
  it('test_regression__direct_starbucks_is_coffee_not_food_delivery', () => {
    expect(normalizeMerchant('STARBUCKS').categoryId).toBe('coffee');
    expect(normalizeMerchant('STARBUCKS').canonical).toBe('Starbucks');
    expect(normalizeMerchant('STARBUCKS STORE 123').categoryId).toBe('coffee');
    expect(normalizeMerchant('SQ *STARBUCKS #4471').categoryId).toBe('coffee');
    expect(normalizeMerchant('TST* STARBUCKS').categoryId).toBe('coffee');
  });

  it('test_regression__doordash_starbucks_is_food_delivery', () => {
    expect(normalizeMerchant('DD *STARBUCKS').categoryId).toBe('food-delivery');
    expect(normalizeMerchant('DOORDASH STARBUCKS').categoryId).toBe('food-delivery');
    expect(normalizeMerchant('UBER EATS STARBUCKS').categoryId).toBe('food-delivery');
    expect(normalizeMerchant('GRUBHUB STARBUCKS').categoryId).toBe('food-delivery');
  });

  it('test_regression__starbucks_rename_is_kept', () => {
    expect(
      registerDisplayName({
        merchant: { canonical: 'The usual' },
        rawDescriptor: 'STARBUCKS STORE 123',
      }),
    ).toBe('The usual');
  });
});
