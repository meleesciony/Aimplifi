/**
 * Home recent-charge payee rename without a filing rule (DECISIONS #625).
 *
 * Overlay already lived on transaction detail and Inbox (PayeeNameControl +
 * renamePayee). Home printed merchantName as static text inside a whole-row
 * Link, so a household standing on Home could not rename a payee they were
 * looking at. Same writer — no second action. The name control is a sibling
 * of the row Link, not inside it, so C.15 still clicks through to detail.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { payeeRenameKey, registerDisplayName } from '@/lib/engine/transactions/display-name';

describe('Home recent charges reuse the existing payee rename', () => {
  it('test_regression__household_can_rename_a_payee_on_home_recent_charges_without_writing_a_rule', () => {
    const card = readFileSync(resolve('src/components/dashboard/recent-transactions-card.tsx'), 'utf8');
    expect(card).toContain('PayeeNameControl');
    expect(card).toContain("from '@/components/finance/payee-name-form'");
    expect(card).toContain('canRenamePayee');
    expect(card).toContain('data-testid="dashboard-recent-row"');
    expect(card).toContain("namedPageBack('dashboard'");
    expect(card).not.toContain('createKeywordRule');
    expect(card).not.toContain('renamePayee(');

    // PayeeNameControl is a sibling of the row Link, not nested inside it.
    const mapStart = card.indexOf('rows.map');
    expect(mapStart).toBeGreaterThan(-1);
    const mapBlock = card.slice(mapStart);
    const controlIdx = mapBlock.indexOf('<PayeeNameControl');
    const rowTestIdIdx = mapBlock.indexOf('data-testid="dashboard-recent-row"');
    expect(controlIdx).toBeGreaterThan(-1);
    expect(rowTestIdIdx).toBeGreaterThan(-1);
    expect(controlIdx).toBeLessThan(rowTestIdIdx);
    const linkOpen = mapBlock.lastIndexOf('<Link', rowTestIdIdx);
    expect(linkOpen).toBeGreaterThan(-1);
    const linkClose = mapBlock.indexOf('</Link>', rowTestIdIdx);
    expect(linkClose).toBeGreaterThan(linkOpen);
    const rowLinkInner = mapBlock.slice(linkOpen, linkClose);
    expect(rowLinkInner).toContain('data-testid="dashboard-recent-row"');
    expect(rowLinkInner).not.toContain('PayeeNameControl');
    expect(rowLinkInner).toContain('formatCents');

    const loader = readFileSync(resolve('src/server/dashboard-recent.ts'), 'utf8');
    expect(loader).toContain('payeeRenameKey');
    expect(loader).toContain('payeeRenamed');
    expect(loader).toContain('getPayeeRenames');
    expect(loader).toContain('registerDisplayName');

    const page = readFileSync(resolve('src/app/(app)/dashboard/page.tsx'), 'utf8');
    expect(page).toContain('canRenamePayee={!isDemoUser(session.user.id)}');

    const control = readFileSync(resolve('src/components/finance/payee-name-form.tsx'), 'utf8');
    expect(control).toContain('renamePayee');
    expect(control).toContain('clearPayeeRename');
    expect(control).not.toContain('useActionState');
    expect(control).not.toContain('createKeywordRule');
  });
});

describe('Home recent overlay wins without a DB', () => {
  it('test_regression__home_payee_overlay_wins_without_rewriting_canonical', () => {
    const t = {
      merchant: { canonical: 'Starbucks' },
      rawDescriptor: 'SQ *STARBUCKS STORE 123',
    };
    const names = new Map([[payeeRenameKey(t), 'Coffee shop']]);
    expect(registerDisplayName(t, names)).toBe('Coffee shop');
    expect(registerDisplayName(t)).toBe('Starbucks');
    expect(t.merchant.canonical).toBe('Starbucks');
  });
});
