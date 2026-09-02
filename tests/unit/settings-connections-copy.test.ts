import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  SETTINGS_CONNECTIONS_BODY,
  SETTINGS_IMPORT_CSV_LABEL,
} from '@/lib/copy/settings-connections-copy';

describe('Settings Bank connections names CSV (DECISIONS #576)', () => {
  it('test_regression__settings_connections_offer_csv_not_plaid_only', () => {
    expect(SETTINGS_CONNECTIONS_BODY).toMatch(/Paste a CSV/i);
    expect(SETTINGS_CONNECTIONS_BODY).toMatch(/Plaid/);
    expect(SETTINGS_IMPORT_CSV_LABEL).toMatch(/CSV/i);

    const page = readFileSync(resolve('src/app/(app)/settings/page.tsx'), 'utf8');
    expect(page).toContain('SETTINGS_CONNECTIONS_BODY');
    expect(page).toContain('settings-import-csv');
    expect(page).toContain('/transactions/import');
  });
});
