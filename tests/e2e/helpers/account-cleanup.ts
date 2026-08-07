/**
 * O.19 — the duplicate/combine machinery on /accounts lives behind one collapsed
 * "Account cleanup" disclosure. Every spec that drives a combine offer, a blocked reason, a
 * reconciliation candidate, the combined-accounts card or the #192 duplicate warning has to open
 * it first.
 *
 * Why a helper rather than a click in each spec: the section is STICKY for the session (the
 * reliable-mutation recipe reloads the whole page, and a reader mid-remedy should not lose their
 * place), so after the first open it is already open on the next load. A bare `click()` would
 * then CLOSE it, and the failure lands on whatever assertion runs next — nowhere near the cause.
 * Open by state, never by toggle.
 */
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Ensure the Account cleanup section is expanded. No-op when it is already open.
 * Asserts the section exists — a spec that seeded a duplicate and finds no disclosure has
 * already failed, and should say so here rather than time out on a hidden card.
 */
export async function openAccountCleanup(page: Page) {
  const section = page.getByTestId('account-cleanup');
  await expect(section).toBeAttached({ timeout: 20_000 });
  if (await section.evaluate((el) => (el as HTMLDetailsElement).open)) return;
  await page.getByTestId('account-cleanup-summary').click();
  await expect(section).toHaveAttribute('open', '');
}
