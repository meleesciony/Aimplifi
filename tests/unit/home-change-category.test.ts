/**
 * Home already-filed recent-charge recategorize (DECISIONS #627).
 *
 * #626 shipped HomeFileCategoryControl for needsFile rows only. Already-filed
 * rows still printed categoryName as static text inside the C.15 row Link, so
 * a household standing on Home could not change a category that already had
 * one. Same writer — no second action. The control is a sibling of the row
 * Link, not inside it, so C.15 still clicks through to detail.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Home recent charges reuse applyCategory for already-filed rows', () => {
  it('test_regression__household_can_change_the_category_of_an_already_filed_home_recent_charge', () => {
    const card = readFileSync(resolve('src/components/dashboard/recent-transactions-card.tsx'), 'utf8');
    expect(card).toContain('HomeFileCategoryControl');
    expect(card).toContain('categoryId={r.categoryId}');
    expect(card).toContain('needsFile={r.needsFile}');

    const mapStart = card.indexOf('rows.map');
    expect(mapStart).toBeGreaterThan(-1);
    const mapBlock = card.slice(mapStart);
    const controlIdx = mapBlock.indexOf('<HomeFileCategoryControl');
    expect(controlIdx).toBeGreaterThan(-1);
    const beforeControl = mapBlock.slice(Math.max(0, controlIdx - 80), controlIdx);
    expect(beforeControl).not.toMatch(/r\.needsFile\s*\?\s*\(/);

    const rowTestIdIdx = mapBlock.indexOf('data-testid="dashboard-recent-row"');
    expect(rowTestIdIdx).toBeGreaterThan(-1);
    const linkOpen = mapBlock.lastIndexOf('<Link', rowTestIdIdx);
    expect(linkOpen).toBeGreaterThan(-1);
    const linkClose = mapBlock.indexOf('</Link>', rowTestIdIdx);
    expect(linkClose).toBeGreaterThan(linkOpen);
    const rowLinkInner = mapBlock.slice(linkOpen, linkClose);
    expect(rowLinkInner).toContain('data-testid="dashboard-recent-row"');
    expect(rowLinkInner).toContain('formatCents');
    expect(rowLinkInner).toContain('date');
    expect(rowLinkInner).not.toContain('{r.categoryName}');
    expect(rowLinkInner).not.toContain('HomeFileCategoryControl');

    const loader = readFileSync(resolve('src/server/dashboard-recent.ts'), 'utf8');
    const pushStart = loader.indexOf('rows.push');
    expect(pushStart).toBeGreaterThan(-1);
    const pushBlock = loader.slice(pushStart, loader.indexOf('});', pushStart) + 2);
    expect(pushBlock).toContain('categoryId:');

    const form = readFileSync(resolve('src/components/finance/home-file-category-form.tsx'), 'utf8');
    expect(form).toContain('applyCategory');
    expect(form).toMatch(/defaultValue|categoryId/);
    expect(form).toContain('Change category');
    expect(form).not.toContain('always: true');
    expect(form).not.toContain('useActionState');
    expect(form).not.toContain('createKeywordRule');

    const lock626 = readFileSync(resolve('tests/unit/home-file-category.test.ts'), 'utf8');
    expect(lock626).toContain(
      'test_regression__household_can_file_a_category_from_a_home_recent_charge_that_needs_one',
    );
  });
});
