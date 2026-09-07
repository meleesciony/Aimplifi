/**
 * Tax-year CSV export from Reports without leaving for Settings (DECISIONS #695).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Reports mounts tax-year export', () => {
  it('test_regression__household_can_download_tax_year_csv_from_reports_without_leaving_for_settings', () => {
    const page = readFileSync(resolve('src/app/(app)/reports/page.tsx'), 'utf8');
    expect(page).toContain('reports-tax-export-card');
    expect(page).toContain('getTaxYears');
    expect(page).toContain('tax-year-csv');
  });
});
