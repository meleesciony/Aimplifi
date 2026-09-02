/**
 * CSV import is a production classify-any-source path. Live 2026-09-01 the
 * page still sold it as "a Simplifi CSV" / "Simplifi wins while Aimplifi is
 * standing up". That is standup bookkeeping, not the product.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CSV_IMPORT_CATEGORY_HELP, CSV_IMPORT_COLUMNS_HELP, CSV_IMPORT_INTRO } from '@/lib/copy/csv-import-copy';

describe('CSV import is any source, not a Simplifi matcher (DECISIONS #540)', () => {
  it('test_regression__csv_import_copy_is_any_source_not_simplifi_standup', () => {
    expect(CSV_IMPORT_INTRO).toMatch(/any bank or CSV/i);
    expect(CSV_IMPORT_INTRO).toMatch(/names a category/i);
    expect(CSV_IMPORT_INTRO).not.toMatch(/Simplifi/i);
    expect(CSV_IMPORT_INTRO).not.toMatch(/standing up/i);
    expect(CSV_IMPORT_CATEGORY_HELP).toMatch(/category/i);
    expect(CSV_IMPORT_CATEGORY_HELP).not.toMatch(/Simplifi/i);

    const page = readFileSync(resolve('src/app/(app)/transactions/import/page.tsx'), 'utf8');
    expect(page).toContain('CSV_IMPORT_INTRO');
    expect(page).toContain('data-testid="csv-import-intro"');
    expect(page).not.toMatch(/Simplifi wins/);

    const form = readFileSync(resolve('src/components/finance/import-csv-form.tsx'), 'utf8');
    expect(form).toContain('CSV_IMPORT_CATEGORY_HELP');
    expect(form).not.toMatch(/Simplifi export/);
  });
});

describe('CSV paste helper names Debit/Credit and Net Amount (DECISIONS #546)', () => {
  it('test_regression__csv_paste_helper_names_debit_credit_and_net_amount', () => {
    expect(CSV_IMPORT_COLUMNS_HELP).toMatch(/Debit\/Credit/);
    expect(CSV_IMPORT_COLUMNS_HELP).toMatch(/Withdrawal\/Deposit/);
    expect(CSV_IMPORT_COLUMNS_HELP).toMatch(/Net Amount/);
    expect(CSV_IMPORT_COLUMNS_HELP).toMatch(/Post Date/);
    expect(CSV_IMPORT_COLUMNS_HELP).toMatch(/Trade Date/);
    expect(CSV_IMPORT_COLUMNS_HELP).not.toMatch(/Simplifi/i);

    const form = readFileSync(resolve('src/components/finance/import-csv-form.tsx'), 'utf8');
    expect(form).toContain('CSV_IMPORT_COLUMNS_HELP');
    expect(form).toContain('data-testid="csv-import-columns-help"');
    expect(form).not.toMatch(/Columns: <code>date<\/code>/);
    expect(form).not.toMatch(/Amount is negative for money out, positive for money in/);
  });
});

describe('Bank export guides name Post Date and Withdrawal (-) (DECISIONS #555)', () => {
  it('test_regression__csv_guides_name_chase_post_date_and_schwab_withdrawal', async () => {
    const { CSV_EXPORT_GUIDES, GENERIC_CSV_GUIDE } = await import('@/lib/engine/transactions/csv-export-guide');
    const chase = CSV_EXPORT_GUIDES.find((g) => g.institution === 'Chase');
    const schwab = CSV_EXPORT_GUIDES.find((g) => g.institution === 'Charles Schwab');
    expect(chase?.note).toMatch(/Post Date/);
    expect(schwab?.note).toMatch(/Withdrawal/);
    expect(GENERIC_CSV_GUIDE.steps.join(' ')).toMatch(/Post Date/);
    expect(GENERIC_CSV_GUIDE.steps.join(' ')).toMatch(/Withdrawal\/Deposit/);
  });
});
