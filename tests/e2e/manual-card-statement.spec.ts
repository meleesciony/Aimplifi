/**
 * Manual card statements (extends DECISIONS #45) — UI round-trip on /accounts
 * (380×800). Adds a manual CREDIT card, attaches a statement through the form,
 * asserts the statement summary renders, clears it, then deletes the card.
 *
 * Isolation (#166 NEXT item 0): this spec runs on a THROWAWAY USER created via
 * the auth.spec signup pattern, not the shared demo user. The old demo-user
 * version perturbed the demo's net worth for the add→delete window, colliding
 * with the exact net-worth golden readers (phase1/ask) under fullyParallel — a
 * retrying assertion cannot converge on a static server render, so isolation is
 * the real fix (DECISIONS #39 precedent, resolved here). Every assertion below
 * is against this user's own data; no demo golden is touched.
 *
 * Dates are fixed (close 2026-06-15, due 2026-07-10): the parser only requires
 * due > close (never compares to today) and the summary renders the absolute
 * date, so a real-clock throwaway user keeps these assertions deterministic
 * forever. The REAL-amount precise-path effect (a $1,200 statement producing an
 * exact obligation) is proven deterministically in tests/unit/card-actions.test.ts.
 *
 * Post-reload clicks use a click-and-verify retry (#167 critic P1): the
 * reliable-mutation recipe confirms every write with window.location.reload(),
 * and under parallel-suite load the FIRST click after a reload can land on
 * pre-hydration HTML — React does not replay pre-hydration discrete events, so
 * the click is silently dropped. Visibility asserts pass against static SSR
 * and are NOT a hydration barrier; re-clicking until the expected reaction
 * appears is.
 */
import { expect, test } from '@playwright/test';

test('attach a statement to a manual credit card, then clear + delete (extends #45)', async ({ page }) => {
  // Throwaway user — full isolation from the demo goldens.
  const email = `e2e-stmt-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  const password = 'e2e-password-123';
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill(password);
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20000 });

  await page.goto('/accounts');
  await expect(page.getByTestId('accounts-empty')).toBeVisible({ timeout: 20000 });

  // Add a manual CREDIT card (a liability).
  await page.getByTestId('add-liability-btn').click();
  await page.getByTestId('manual-name').fill('E2E Stmt Card');
  await page.getByTestId('manual-type').selectOption('CREDIT');
  await page.getByTestId('manual-value').fill('500');
  await page.getByTestId('manual-submit').click();

  const row = page.getByTestId('manual-account-row').filter({ hasText: 'E2E Stmt Card' });
  await expect(row).toBeVisible({ timeout: 20000 });
  // This user's whole balance sheet is the one $500 liability.
  await expect(page.getByTestId('accounts-net-worth-amount')).toHaveText('-$500.00');
  // A fresh manual card has no statement → the "+ Add statement" affordance shows.
  await expect(row.getByTestId('card-statement-add')).toBeVisible();

  // Open the statement form and fill a $0 statement with real dates and a
  // FIXED_AMOUNT autopay. First click after the add-account reload → retry
  // until the form reacts (hydration barrier, see header).
  await expect(async () => {
    await row.getByTestId('card-statement-add').click({ timeout: 2000 });
    await expect(row.getByTestId('card-statement-form')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20000 });
  await row.getByTestId('cs-balance').fill('0');
  await row.getByTestId('cs-min').fill('0');
  await row.getByTestId('cs-close').fill('2026-06-15');
  await row.getByTestId('cs-due').fill('2026-07-10');
  await row.getByTestId('cs-autopay').selectOption('FIXED_AMOUNT');
  await row.getByTestId('cs-fixed').fill('100');
  await row.getByTestId('cs-save').click();

  // The summary now renders the statement (due Fri, Jul 10).
  const cardRow = () => page.getByTestId('manual-account-row').filter({ hasText: 'E2E Stmt Card' });
  const summary = cardRow().getByTestId('card-statement-summary');
  await expect(summary).toBeVisible({ timeout: 20000 });
  await expect(summary).toContainText('Statement $0.00');
  await expect(summary).toContainText('Jul 10');
  await expect(page.getByTestId('manual-success')).toBeVisible({ timeout: 20000 });

  // Re-open the editor → the FIXED_AMOUNT autopay amount re-hydrates
  // (round-trip fidelity). First click after the statement-save reload → retry.
  await expect(async () => {
    await cardRow().getByTestId('card-statement-edit').click({ timeout: 2000 });
    await expect(cardRow().getByTestId('cs-fixed')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20000 });
  await expect(cardRow().getByTestId('cs-fixed')).toHaveValue('100.00');
  await cardRow().getByTestId('cs-save').click();
  await expect(summary).toBeVisible({ timeout: 20000 });

  // Clear the statement → the add affordance returns. First click after the
  // re-save reload → retry; state-aware because a REGISTERED clear removes the
  // Clear button (a blind re-click would wait on a gone element).
  await expect(async () => {
    if (!(await cardRow().getByTestId('card-statement-add').isVisible())) {
      await cardRow().getByTestId('card-statement-clear').click({ timeout: 2000 });
    }
    await expect(cardRow().getByTestId('card-statement-add')).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 30000 });

  // Delete the card (two-step confirm) → back to the first-run empty state.
  // First click after the clear reload → retry until the confirm appears.
  // State-aware: a REGISTERED click replaces the Delete button with the
  // confirm row, so a blind re-click would wait on a gone element.
  await expect(async () => {
    if (!(await cardRow().getByTestId('manual-delete-confirm').isVisible())) {
      await cardRow().getByTestId('manual-delete').click({ timeout: 2000 });
    }
    await expect(cardRow().getByTestId('manual-delete-confirm')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20000 });
  await cardRow().getByTestId('manual-delete-confirm').click();
  await expect(page.getByTestId('manual-account-row').filter({ hasText: 'E2E Stmt Card' })).toHaveCount(0, {
    timeout: 20000,
  });
  await expect(page.getByTestId('accounts-empty')).toBeVisible({ timeout: 20000 });
});

test('Doc Extractor v1 (#247): the paste panel discloses, fails honestly keyless, and never blocks manual entry', async ({
  page,
}) => {
  // E2E is hermetic — provider keys are blanked in playwright.config.ts — so
  // the extract action DETERMINISTICALLY returns the honest-unavailable copy.
  // The prefill happy path is locked deterministically in
  // tests/unit/statement-extract-server.test.ts with a mocked provider; what
  // only e2e can prove is the real panel in the real form: disclosure before
  // egress, an honest failure, and a manual save that still works after it.
  const email = `e2e-extract-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20000 });

  await page.goto('/accounts');
  await page.getByTestId('add-liability-btn').click();
  await page.getByTestId('manual-name').fill('E2E Extract Card');
  await page.getByTestId('manual-type').selectOption('CREDIT');
  await page.getByTestId('manual-value').fill('300');
  await page.getByTestId('manual-submit').click();

  const row = () => page.getByTestId('manual-account-row').filter({ hasText: 'E2E Extract Card' });
  await expect(row()).toBeVisible({ timeout: 20000 });

  // Open the statement form (hydration-barrier retry, see header).
  await expect(async () => {
    await row().getByTestId('card-statement-add').click({ timeout: 2000 });
    await expect(row().getByTestId('card-statement-form')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20000 });

  // Open the paste panel: the privacy disclosure must be visible BEFORE any
  // text can be sent, and it must state the pointer-only contract.
  await row().getByTestId('cs-extract-toggle').click();
  const disclosure = row().getByTestId('cs-extract-disclosure');
  await expect(disclosure).toBeVisible();
  await expect(disclosure).toContainText('sent to an AI model');
  await expect(disclosure).toContainText('nothing is saved until you press Save');

  // Keyless extract → the honest manual-entry message, no stall, no prefill.
  await row().getByTestId('cs-extract-text').fill('New balance $1,234.56\nPayment due date 08/10/2026');
  await row().getByTestId('cs-extract-run').click();
  await expect(row().getByTestId('cs-extract-error')).toContainText('enter the fields manually', {
    timeout: 20000,
  });
  await expect(row().getByTestId('cs-balance')).toHaveValue('');

  // The failure leaves the manual path fully working: type + save + summary.
  await row().getByTestId('cs-balance').fill('250');
  await row().getByTestId('cs-min').fill('25');
  await row().getByTestId('cs-close').fill('2026-06-15');
  await row().getByTestId('cs-due').fill('2026-07-10');
  await row().getByTestId('cs-save').click();
  const summary = row().getByTestId('card-statement-summary');
  await expect(summary).toBeVisible({ timeout: 20000 });
  await expect(summary).toContainText('Statement $250.00');
});
