/**
 * Stale-data banner Sync now without leaving for Accounts (DECISIONS #688).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Stale-data banner Sync now', () => {
  it('test_regression__household_can_sync_from_stale_data_banner_without_leaving_for_accounts', () => {
    const banner = readFileSync(resolve('src/components/finance/stale-data-banner.tsx'), 'utf8');
    expect(banner).toContain('SyncAllButton');
    expect(banner).toContain('canSync');
    expect(banner).toContain("flashKey=\"dashboard\"");
    expect(banner).toContain('variant="inline"');

    const sync = readFileSync(resolve('src/components/finance/sync-all-button.tsx'), 'utf8');
    expect(sync).toContain("variant === 'inline'");
    expect(sync).toContain('stale-data-sync-all');
    expect(sync).toContain('syncAllAccounts');

    const page = readFileSync(resolve('src/app/(app)/dashboard/page.tsx'), 'utf8');
    expect(page).toContain('canSync={!isDemoUser(session.user.id) && linkedBank}');
  });
});
