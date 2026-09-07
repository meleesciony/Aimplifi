/**
 * Transfer mark repair on Accounts without leaving for Settings (DECISIONS #689).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Accounts mounts TransferRepairCard', () => {
  it('test_regression__household_can_repair_transfer_marks_from_accounts_without_leaving_for_settings', () => {
    const page = readFileSync(resolve('src/app/(app)/accounts/page.tsx'), 'utf8');
    expect(page).toContain('TransferRepairCard');
    expect(page).toContain('transfer-repair-accounts-card');
    expect(page).toContain('getTransferFlagRepairPreview');

    const actions = readFileSync(resolve('src/server/transfer-flag-repair-actions.ts'), 'utf8');
    expect(actions).toContain("revalidatePath('/accounts')");
  });
});
