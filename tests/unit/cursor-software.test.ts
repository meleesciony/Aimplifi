/**
 * Live 2026-09-01 /transactions: "Cursor Usage Jul" and "Moonshot Ai" filed
 * Shopping. The normalizer left them unknown, so Plaid's GENERAL_MERCHANDISE
 * hint auto-filed shopping (DECISIONS #155). They are software.
 */
import { describe, expect, it } from 'vitest';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';

describe('Cursor and Moonshot file software (DECISIONS #538)', () => {
  it('test_regression__cursor_usage_and_moonshot_file_software_not_shopping', () => {
    const cursor = normalizeMerchant('CURSOR USAGE JUL');
    expect(cursor.canonical).toBe('Cursor');
    expect(cursor.categoryId).toBe('software');
    expect(cursor.known).toBe(true);
    expect(cursor.confidenceBps).toBeGreaterThanOrEqual(7000);

    const moon = normalizeMerchant('MOONSHOT AI');
    expect(moon.canonical).toBe('Moonshot');
    expect(moon.categoryId).toBe('software');
    expect(moon.known).toBe(true);
    expect(moon.confidenceBps).toBeGreaterThanOrEqual(7000);

    expect(normalizeMerchant('STARBUCKS').categoryId).toBe('coffee');
  });
});
