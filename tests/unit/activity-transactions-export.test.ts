/**
 * Transactions CSV from Activity without leaving for Settings (DECISIONS #698).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Activity mounts transactions CSV export', () => {
  it('test_regression__household_can_download_transactions_csv_from_activity_without_leaving_for_settings', () => {
    const page = readFileSync(resolve('src/app/(app)/transactions/page.tsx'), 'utf8');
    expect(page).toContain('activity-transactions-export-card');
    expect(page).toContain('transactions-csv');
  });
});
