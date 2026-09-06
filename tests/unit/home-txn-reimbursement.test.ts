/**
 * Home recent-charge reimbursement tracking without opening detail (DECISIONS #666).
 *
 * setReimbursement lived in the Activity action menu and detail. Home printed
 * no reimbursement control, so a household standing on Home could not track
 * being owed money back without opening detail. Same writer. Demo fenced.
 * Outflows only (inflows refuse on the server).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Home recent charges reuse setReimbursement', () => {
  it('test_regression__household_can_track_reimbursement_on_a_home_recent_charge_without_opening_detail', () => {
    const card = readFileSync(resolve('src/components/dashboard/recent-transactions-card.tsx'), 'utf8');
    expect(card).toContain('TxnReimbursementControl');
    expect(card).toContain("from '@/components/finance/txn-reimbursement-form'");
    expect(card).toContain('triggerTestId="home-recent-reimbursement"');
    expect(card).toContain('canRenamePayee');
    expect(card).toContain('r.reimbursement');
    expect(card).toContain('r.amountCents < 0');

    const control = readFileSync(resolve('src/components/finance/txn-reimbursement-form.tsx'), 'utf8');
    expect(control).toContain('setReimbursement');
    expect(control).toContain("state === null ? 'awaiting'");
    expect(control).not.toContain('useActionState');

    const loader = readFileSync(resolve('src/server/dashboard-recent.ts'), 'utf8');
    expect(loader).toContain('reimbursement: string | null');
    expect(loader).toContain('reimbursement: t.reimbursement ?? null');

    const actions = readFileSync(resolve('src/server/transaction-flags-actions.ts'), 'utf8');
    expect(actions).toContain('isDemoUser');
    expect(actions).toContain('DEMO_ENTRY_BLOCKED');
    expect(actions).toContain("revalidatePath('/dashboard')");
  });
});
