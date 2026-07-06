/**
 * Manual card statements (extends DECISIONS #45) — UI round-trip on /accounts
 * (380×800). Adds a manual CREDIT card, attaches a statement through the form,
 * asserts the statement summary renders, clears it, then deletes the card to
 * revert.
 *
 * Golden-safety: the statement balance is $0, so the card joins the cash-needed
 * answer with cashRequired = 0 → it is EXCLUDED from the headline total, leaving
 * the demo's pinned cash-needed values ($5,412.33 etc.) untouched for the
 * concurrent phase-1 specs. The card's positive *balance* perturbs net worth for
 * the add→delete window — a pre-existing, accepted scheduling roulette (the
 * manual-home precedent, DECISIONS #39) whose odds worsened once #166's
 * reload-bearing specs slowed the suite; note a retrying assertion CANNOT
 * converge on a static server render, so the real fix is running this spec on a
 * THROWAWAY USER (top of the #166 NEXT list), not longer timeouts. The REAL-amount precise-path effect (a $1,200 statement
 * producing an exact obligation) is proven deterministically and in isolation in
 * tests/unit/card-actions.test.ts.
 */
import { type Page, expect, test } from '@playwright/test';

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
}

test('attach a statement to a manual credit card, then clear + delete (extends #45)', async ({ page }) => {
  await signIn(page);
  await page.goto('/accounts');
  await expect(page.getByTestId('accounts-net-worth-amount')).toHaveText('$144,804.74');

  // Add a manual CREDIT card (a liability).
  await page.getByTestId('add-liability-btn').click();
  await page.getByTestId('manual-name').fill('E2E Stmt Card');
  await page.getByTestId('manual-type').selectOption('CREDIT');
  await page.getByTestId('manual-value').fill('500');
  await page.getByTestId('manual-submit').click();

  const row = page.getByTestId('manual-account-row').filter({ hasText: 'E2E Stmt Card' });
  await expect(row).toBeVisible({ timeout: 20000 });
  // A fresh manual card has no statement → the "+ Add statement" affordance shows.
  await expect(row.getByTestId('card-statement-add')).toBeVisible();

  // Open the statement form and fill a $0 statement (headline-neutral) with real dates
  // and a FIXED_AMOUNT autopay (also headline-neutral on a $0 balance).
  await row.getByTestId('card-statement-add').click();
  await expect(row.getByTestId('card-statement-form')).toBeVisible();
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
  await expect(page.getByTestId('manual-success')).toBeVisible();

  // Re-open the editor → the FIXED_AMOUNT autopay amount re-hydrates (round-trip fidelity).
  await cardRow().getByTestId('card-statement-edit').click();
  await expect(cardRow().getByTestId('cs-fixed')).toHaveValue('100.00');
  await cardRow().getByTestId('cs-save').click();
  await expect(summary).toBeVisible({ timeout: 20000 });

  // Clear the statement → the add affordance returns.
  await page.getByTestId('manual-account-row').filter({ hasText: 'E2E Stmt Card' }).getByTestId('card-statement-clear').click();
  await expect(
    page.getByTestId('manual-account-row').filter({ hasText: 'E2E Stmt Card' }).getByTestId('card-statement-add'),
  ).toBeVisible({ timeout: 20000 });

  // Delete the card (two-step confirm) → net worth reverts for the concurrent golden specs.
  const stmtRow = page.getByTestId('manual-account-row').filter({ hasText: 'E2E Stmt Card' });
  await stmtRow.getByTestId('manual-delete').click();
  await stmtRow.getByTestId('manual-delete-confirm').click();
  await expect(page.getByTestId('manual-account-row').filter({ hasText: 'E2E Stmt Card' })).toHaveCount(0, {
    timeout: 20000,
  });
  await expect(page.getByTestId('accounts-net-worth-amount')).toHaveText('$144,804.74');
});
