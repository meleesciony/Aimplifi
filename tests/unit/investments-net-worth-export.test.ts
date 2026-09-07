/**
 * Net worth export from Investments without leaving for Settings (DECISIONS #696).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Investments mounts net-worth export', () => {
  it('test_regression__household_can_download_net_worth_export_from_investments_without_leaving_for_settings', () => {
    const page = readFileSync(resolve('src/app/(app)/investments/page.tsx'), 'utf8');
    expect(page).toContain('investments-net-worth-export-card');
    expect(page).toContain('net-worth-csv');
    expect(page).toContain('net-worth-pdf');
  });
});
