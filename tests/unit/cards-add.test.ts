/**
 * Cards page add-card without opening Accounts (DECISIONS #637).
 *
 * addManualAccount already lived on Accounts (CREDIT is a liability type).
 * Cards empty state sent “Add a card manually” to /accounts, and a populated
 * Cards page had no add affordance, so a household standing on Cards could
 * not add the card they were about to plan. Same writer — type locked to
 * CREDIT. Demo not mounted.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Cards page reuses addManualAccount', () => {
  it('test_regression__household_can_add_a_card_from_the_cards_page_without_opening_accounts', () => {
    const control = readFileSync(resolve('src/components/finance/card-add-control.tsx'), 'utf8');
    expect(control).toContain('addManualAccount');
    expect(control).toContain("from '@/server/networth-actions'");
    expect(control).toContain("addManualAccount({ name, type: 'CREDIT', value })");
    expect(control).not.toContain('useActionState');
    expect(control).toContain('data-testid="cards-add-form"');
    expect(control).toContain('data-testid="cards-add-name"');
    expect(control).toContain('data-testid="cards-add-value"');
    expect(control).toContain('data-testid="cards-add-save"');
    expect(control).toContain('tap-target');
    expect(control).toContain('aria-label="Add a credit card"');
    expect(control).toContain('<label className="space-y-1 block">');
    expect(control).toContain('Card name');
    expect(control).toContain('Current balance owed');
    expect(control).toContain('placeholder="500.00"');
    expect(control).not.toContain('placeholder="0.00"');
    expect(control).not.toContain('manual-type');
    expect(control).not.toContain('MANUAL_LIABILITY_TYPES');
    expect(control).not.toContain('select');

    const page = readFileSync(resolve('src/app/(app)/cards/page.tsx'), 'utf8');
    expect(page).toContain('CardAddControl');
    expect(page).toContain("from '@/components/finance/card-add-control'");
    expect(page).toContain('canAddCard');
    expect(page).toContain('isDemoUser');
    expect(page).toContain('triggerTestId="cards-empty-manual"');
    expect(page).toContain('triggerLabel="Add a card manually"');
    expect(page).toContain('{canAddCard ? <CardAddControl /> : null}');

    const emptyIdx = page.indexOf('cards-empty');
    expect(emptyIdx).toBeGreaterThan(-1);
    const emptyEnd = page.indexOf('</Card>', emptyIdx);
    const emptyBlock = page.slice(emptyIdx, emptyEnd);
    expect(emptyBlock).toContain('CardAddControl');
    expect(emptyBlock).toContain('cards-empty-manual');
    expect(emptyBlock).not.toContain('href="/accounts"');

    const breakdownCall = page.indexOf('<CardsBreakdown');
    expect(breakdownCall).toBeGreaterThan(-1);
    expect(emptyIdx).toBeLessThan(breakdownCall);
    const populated = page.slice(breakdownCall - 200, breakdownCall);
    expect(populated).toContain('{canAddCard ? <CardAddControl /> : null}');

    const actions = readFileSync(resolve('src/server/networth-actions.ts'), 'utf8');
    expect(actions).toContain("revalidatePath('/cards')");
    expect(actions).toContain('if (isDemoUser(userId)) return { ok: false, errors: [DEMO_ENTRY_BLOCKED] }');

    const accounts = readFileSync(resolve('src/components/finance/accounts-list.tsx'), 'utf8');
    expect(accounts).toContain('addManualAccount');
    expect(accounts).toContain('data-testid="add-liability-btn"');
    expect(accounts).toContain('data-testid="manual-add-form"');

    const breakdown = readFileSync(resolve('src/components/finance/cards-breakdown.tsx'), 'utf8');
    const unknownStart = breakdown.indexOf('cards-unknown-due');
    expect(unknownStart).toBeGreaterThan(-1);
    const unknownBlock = breakdown.slice(unknownStart);
    expect(unknownBlock).toContain('take a statement on this');
    expect(unknownBlock).not.toContain('href="/accounts"');
    expect(unknownBlock).not.toContain('from Accounts');
    expect(unknownBlock).not.toContain("The bank hasn’t sent");

    const types = readFileSync(resolve('src/lib/engine/cash-needed/types.ts'), 'utf8');
    expect(types).not.toContain('canAddCard');
    expect(types).not.toContain('CardAddControl');
  });
});
