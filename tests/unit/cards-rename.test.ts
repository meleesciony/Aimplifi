/**
 * Cards page card rename without opening Accounts (DECISIONS #633).
 *
 * Account rename already lived on Accounts (renameAccount writes displayName,
 * never name). Cards printed card.cardName as text, so a household standing on
 * Cards could not nickname a card without opening Accounts. Same writer — no
 * second action. Demo not mounted. Partner cards stay text.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Cards page reuses renameAccount', () => {
  it('test_regression__household_can_rename_a_card_from_the_cards_page_without_opening_accounts', () => {
    const breakdown = readFileSync(resolve('src/components/finance/cards-breakdown.tsx'), 'utf8');
    expect(breakdown).toContain('AccountNameControl');
    expect(breakdown).toContain("from '@/components/finance/account-name-form'");
    expect(breakdown).toContain('canRenameCard');
    expect(breakdown).toContain('cardRenameById');
    expect(breakdown).toContain('function renderCardName');
    expect(breakdown).toContain('const isPartner = Boolean(accountOwnerLabel[cardId])');
    expect(breakdown).toContain('if (canRenameCard && meta && !isPartner)');
    expect(breakdown).toContain('{renderCardName(card.cardId, card.cardName)}');
    expect(breakdown).toContain('{renderCardName(c.cardId, c.cardName)}');

    const titleStart = breakdown.indexOf('<CardTitle');
    expect(titleStart).toBeGreaterThan(-1);
    const titleEnd = breakdown.indexOf('</CardTitle>', titleStart);
    const titleBlock = breakdown.slice(titleStart, titleEnd);
    expect(titleBlock).toContain('renderCardName(card.cardId, card.cardName)');
    expect(titleBlock).toContain('CARD_IDENTITY_TESTID');
    expect(titleBlock).not.toContain('{card.cardName}');

    const unknownStart = breakdown.indexOf('cards-unknown-due');
    expect(unknownStart).toBeGreaterThan(-1);
    const unknownBlock = breakdown.slice(unknownStart);
    expect(unknownBlock).toContain('renderCardName(c.cardId, c.cardName)');
    expect(unknownBlock).not.toContain('{c.cardName}');

    // firstAction / duplicate disclosure strings still use card.cardName, not the control.
    const doThis = breakdown.indexOf('data-testid="do-this-first"');
    expect(doThis).toBeGreaterThan(-1);
    const doThisEnd = breakdown.indexOf('firstAction?.frozenSince', doThis);
    const doThisBlock = breakdown.slice(doThis, doThisEnd);
    expect(doThisBlock).toContain('firstAction.cardName');
    expect(doThisBlock).not.toContain('AccountNameControl');
    expect(doThisBlock).not.toContain('renderCardName');

    expect(breakdown).toContain('label: painted(c.cardId, c.cardName)');
    expect(breakdown).toContain('cardDuplicateView');
    const dupStart = breakdown.indexOf('const duplicates = cardDuplicateView');
    expect(dupStart).toBeGreaterThan(-1);
    const dupBlock = breakdown.slice(dupStart, breakdown.indexOf('firstAction &&', dupStart));
    expect(dupBlock).not.toContain('AccountNameControl');
    expect(dupBlock).not.toContain('renderCardName');

    const page = readFileSync(resolve('src/app/(app)/cards/page.tsx'), 'utf8');
    expect(page).toContain('canRenameCard');
    expect(page).toContain('cardRenameById');
    expect(page).toContain('isDemoUser');
    expect(page).toContain("from '@/lib/demo-user'");
    expect(page).toContain('prisma.account.findMany');
    expect(page).toContain("type: 'CREDIT'");
    const breakdownCall = page.indexOf('<CardsBreakdown');
    expect(breakdownCall).toBeGreaterThan(-1);
    const breakdownBlock = page.slice(breakdownCall, page.indexOf('/>', breakdownCall) + 2);
    expect(breakdownBlock).toContain('canRenameCard={canRenameCard}');
    expect(breakdownBlock).toContain('cardRenameById={cardRenameById}');
    const emptyIdx = page.indexOf('cards-empty');
    expect(emptyIdx).toBeGreaterThan(-1);
    expect(emptyIdx).toBeLessThan(breakdownCall);

    const form = readFileSync(resolve('src/components/finance/account-name-form.tsx'), 'utf8');
    expect(form).toContain('renameAccount');
    expect(form).toContain("from '@/server/account-rename-actions'");
    expect(form).not.toContain('useActionState');
    expect(form).toContain('data-testid="card-row-name"');
    expect(form).toContain('data-testid="card-rename-form"');
    expect(form).toContain('data-testid="card-rename-input"');
    expect(form).toContain('data-testid="card-rename-save"');
    expect(form).toContain('data-testid="card-rename-clear"');
    expect(form).toContain("renameAccount({ accountId, name: '' })");
    expect(form).toContain('renameAccount({ accountId, name })');
    expect(form).toContain('MAX_NICKNAME_LENGTH');
    expect(form).not.toContain(' required');

    const accounts = readFileSync(resolve('src/components/finance/accounts-list.tsx'), 'utf8');
    expect(accounts).toContain('function RenameForm');

    const types = readFileSync(resolve('src/lib/engine/cash-needed/types.ts'), 'utf8');
    expect(types).toContain('cardName: string');
    expect(types).not.toContain('hasOverlay');
    expect(types).not.toContain('feedName');
    expect(types).not.toContain('canRenameCard');
    expect(types).not.toContain('displayName');
  });
});
