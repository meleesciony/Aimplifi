/**
 * Home recent-charge category filing (DECISIONS #626).
 *
 * Filing already lived on Inbox and Activity (applyCategory). Home printed
 * "Needs category" as static text inside the C.15 row Link, so a household
 * standing on Home could not file a charge that still needed one. Same writer
 * — no second action. The file control is a sibling of the row Link, not
 * inside it, so C.15 still clicks through to detail.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Home recent charges reuse applyCategory for needs-file rows', () => {
  it('test_regression__household_can_file_a_category_from_a_home_recent_charge_that_needs_one', () => {
    const card = readFileSync(resolve('src/components/dashboard/recent-transactions-card.tsx'), 'utf8');
    expect(card).toContain('HomeFileCategoryControl');
    expect(card).toContain("from '@/components/finance/home-file-category-form'");
    expect(card).toContain('categoryGroups');
    expect(card).toContain('home-file-category-trigger');
    expect(card).not.toContain('createKeywordRule');
    expect(card).not.toContain('always: true');
    expect(card).toContain('HOME_NEEDS_FILE_HREF');
    expect(card).toContain('Recent transactions');

    // HomeFileCategoryControl is a sibling of the row Link, not nested inside it.
    const mapStart = card.indexOf('rows.map');
    expect(mapStart).toBeGreaterThan(-1);
    const mapBlock = card.slice(mapStart);
    const controlIdx = mapBlock.indexOf('<HomeFileCategoryControl');
    const rowTestIdIdx = mapBlock.indexOf('data-testid="dashboard-recent-row"');
    expect(controlIdx).toBeGreaterThan(-1);
    expect(rowTestIdIdx).toBeGreaterThan(-1);
    const linkOpen = mapBlock.lastIndexOf('<Link', rowTestIdIdx);
    expect(linkOpen).toBeGreaterThan(-1);
    const linkClose = mapBlock.indexOf('</Link>', rowTestIdIdx);
    expect(linkClose).toBeGreaterThan(linkOpen);
    const rowLinkInner = mapBlock.slice(linkOpen, linkClose);
    expect(rowLinkInner).toContain('data-testid="dashboard-recent-row"');
    expect(rowLinkInner).not.toContain('HomeFileCategoryControl');
    expect(rowLinkInner).toContain('formatCents');

    const form = readFileSync(resolve('src/components/finance/home-file-category-form.tsx'), 'utf8');
    expect(form).toContain('applyCategory');
    expect(form).toContain('withDeadline');
    expect(form).toContain('home-file-category-select');
    expect(form).toContain('<select');
    expect(form).toContain('home-file-category-trigger');
    expect(form).not.toContain('useActionState');
    expect(form).not.toContain('always: true');
    expect(form).toContain('expandSimplifiAliasRows');
    expect(form).toContain('optgroup');

    const page = readFileSync(resolve('src/app/(app)/dashboard/page.tsx'), 'utf8');
    expect(page).toContain('getVisibleGroups');

    const actions = readFileSync(resolve('src/server/triage-actions.ts'), 'utf8');
    expect(actions).toContain("revalidatePath('/dashboard')");
  });
});
