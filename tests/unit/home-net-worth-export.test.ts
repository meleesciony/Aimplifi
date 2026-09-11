/**
 * Home: net worth CSV/PDF export without leaving for Investments (DECISIONS #733).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Home mounts net-worth export', () => {
  it('test_regression__household_can_download_net_worth_export_from_home_without_leaving_for_investments', () => {
    const page = readFileSync(resolve('src/app/(app)/dashboard/page.tsx'), 'utf8');
    expect(page).toContain('home-net-worth-export-card');
    expect(page).toContain('NetWorthCard');
    expect(page).toContain('/api/export?format=net-worth-csv');
    expect(page).toContain('/api/export?format=net-worth-pdf');
    expect(page).toContain('export-net-worth-csv');
    expect(page).toContain('export-net-worth-pdf');
  });
});
