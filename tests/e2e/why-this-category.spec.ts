/**
 * Why-This-Category §3.1 slice 2 — the register provenance surface (criteria 6–9).
 *
 * Every register row carries a provenance badge naming who decided its category;
 * the ONE seeded AI-guess row (source 'llm', unlabeled) shows "AI guess — needs
 * your OK" plus a Confirm control, and confirming it — through the same
 * correction path every recategorization uses — flips it to "You set this" and
 * removes the control. Deterministic rows never show a confirm control, and no
 * badge ever renders a fabricated confidence percentage.
 *
 * Ordered so the read-only assertions (and axe) run before the confirm mutation,
 * which persists to the shared demo DB. Only this spec touches provenance.
 */
import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
}

async function expectNoViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  if (results.violations.length > 0) {
    console.log(`[axe:${label}]`, JSON.stringify(results.violations.map((v) => v.id)));
  }
  expect(results.violations, `axe violations on ${label}`).toEqual([]);
}

test('every register row names its category origin; exactly one is a confirmable AI guess', async ({ page }) => {
  await signIn(page);
  await page.goto('/transactions');
  await expect(page.getByTestId('txn-list')).toBeVisible();

  // Criterion 6: a provenance badge on every row (never fewer than the rows).
  const rows = page.getByTestId('txn-row');
  const badges = page.getByTestId('txn-provenance');
  const rowCount = await rows.count();
  expect(rowCount).toBeGreaterThan(0);
  await expect(badges).toHaveCount(rowCount);

  // Criterion 7 (suggestions, not facts): exactly ONE seeded AI guess, and it is
  // the only row that offers a Confirm control.
  await expect(page.locator('[data-testid="txn-provenance"][data-kind="ai-guess"]')).toHaveCount(1);
  await expect(page.getByTestId('provenance-confirm')).toHaveCount(1);
  await expect(page.locator('[data-testid="txn-provenance"][data-kind="ai-guess"]')).toHaveText(
    'AI guess — needs your OK',
  );

  // A settled origin also appears — the demo's deterministic rows name a real
  // source (Known merchant / From your bank / Transfer …), and none of them
  // carries a confirm control (that belongs to ai-guess alone).
  const settled = page.locator(
    '[data-testid="txn-provenance"]:not([data-kind="ai-guess"])',
  );
  expect(await settled.count()).toBeGreaterThan(0);

  // Criterion 9: no fabricated confidence — no badge renders a percentage.
  for (const text of await badges.allInnerTexts()) {
    expect(text).not.toMatch(/%/);
  }

  // Criterion 8: the surface (badges + confirm control) is WCAG-AA clean.
  await expectNoViolations(page, 'transactions-provenance');
});

test('confirming the AI guess reuses the correction path and flips the row to "You set this"', async ({ page }) => {
  await signIn(page);
  await page.goto('/transactions');
  await expect(page.getByTestId('txn-list')).toBeVisible();

  // The confirm write persists to the shared demo DB, so a retry (or a re-run
  // against an already-mutated DB) has no guess left to confirm. Skip rather than
  // fail spuriously — the flip itself was already proven on the first pass.
  test.skip(
    (await page.getByTestId('provenance-confirm').count()) === 0,
    'AI guess already confirmed on the shared demo DB — nothing left to confirm',
  );

  const userSetBefore = await page
    .locator('[data-testid="txn-provenance"][data-kind="user-set"]')
    .count();

  // Confirm the one AI guess. The register reloads on success (the re-rendered
  // badge is the confirmation that can't lie).
  await expect(page.getByTestId('provenance-confirm')).toHaveCount(1);
  await page.getByTestId('provenance-confirm').click();

  // After the write: the guess is gone, its confirm control is gone, and there is
  // one more "You set this" row than before — the human is now the fact-setter.
  await expect(page.locator('[data-testid="txn-provenance"][data-kind="ai-guess"]')).toHaveCount(0, {
    timeout: 20000,
  });
  await expect(page.getByTestId('provenance-confirm')).toHaveCount(0);
  await expect(page.locator('[data-testid="txn-provenance"][data-kind="user-set"]')).toHaveCount(
    userSetBefore + 1,
  );
});
