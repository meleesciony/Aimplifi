/**
 * Transactions CSV from Trends without leaving for Settings (DECISIONS #708).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Trends mounts transactions CSV export', () => {
  it('test_regression__household_can_download_transactions_csv_from_trends_without_leaving_for_settings', () => {
    const page = readFileSync(resolve('src/app/(app)/trends/page.tsx'), 'utf8');
    expect(page).toContain('trends-transactions-export-card');
    expect(page).toContain('transactions-csv');
  });
});
