/**
 * O.17 — renaming a built-in category reaches the PICKER, not just Settings.
 *
 * The unit suite proves the overlay resolves and that every read path in
 * `src/server` returns the new name. What no pure test can see is whether the
 * shipped picker on another page actually renders that overlay — the exact gap
 * this codebase has paid for before (a fix that typechecked, built and passed
 * 225 e2e tests while doing nothing). So the assertion here is deliberately
 * cross-page: rename in Settings, then find the new name in the register's own
 * category `<select>`, and the built-in name gone from it.
 *
 * A THROWAWAY USER, never the demo — the demo is one shared row, and renaming is
 * fenced out of it precisely so one visitor's words never reach the next, so it
 * could not run this flow at all.
 */
import Database from 'better-sqlite3';
import { expect, test, type Page } from './helpers/test';
import { clickMoreNav } from './helpers/more-nav';
import { E2E_DB_URL } from '../setup/test-db';

const NEW_NAME = 'Dr Visits';

/**
 * One POSTED transaction filed under `doctor`, so the register has a ROW whose
 * label can be read. Without it the row assertion below is vacuous — which is
 * exactly how the first version of this spec passed while the register was
 * printing the canonical name on every filed transaction.
 */
function seedDoctorRow(email: string): void {
  const db = new Database(E2E_DB_URL.replace(/^file:/, ''), { timeout: 15_000 });
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as
      | { id: string }
      | undefined;
    if (!user) throw new Error(`seedDoctorRow: user ${email} not found`);
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const acct = `e2e-o17-chk-${stamp}`;
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, name, type, mask, currentBalanceCents, currency)
       VALUES (?, ?, 'manual', ?, 'Everyday Checking', 'CHECKING', '0977', 500000, 'USD')`,
    ).run(acct, user.id, `ref-o17-${stamp}`);
    db.prepare(
      `INSERT INTO "Transaction" (id, accountId, date, amountCents, rawDescriptor, categoryId, status, isTransfer, isSplitParent)
       VALUES (?, ?, '2026-06-05', -5000, 'CITY MEDICAL GROUP', 'doctor', 'POSTED', 0, 0)`,
    ).run(`e2e-o17-doc-${stamp}`, acct);
  } finally {
    db.close();
  }
}

async function signUpThrowaway(page: Page): Promise<string> {
  const email = `e2e-o17-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20000 });
  return email;
}

test('a renamed built-in category reads the new name in Settings and in the register picker', async ({
  page,
}) => {
  const email = await signUpThrowaway(page);
  seedDoctorRow(email);

  await page.goto('/settings');
  await expect(page.getByTestId('category-manager')).toBeVisible();

  // The fixture's hard case must be present, or the assertions below pass
  // vacuously on a page that simply never rendered the row.
  await expect(page.getByTestId('cat-rename-doctor')).toBeVisible();

  await page.getByTestId('cat-rename-doctor').click();
  const input = page.getByTestId('cat-rename-input-doctor');
  await expect(input).toBeVisible();
  await input.fill(NEW_NAME);
  await page.getByTestId('cat-rename-save-doctor').click();

  // The action reloads on success; the re-rendered list is the confirmation.
  await expect(page.getByTestId('renamed-count')).toHaveText('1 renamed.', { timeout: 20000 });
  await expect(page.getByTestId('cat-renamed-from-doctor')).toContainText('built in as Doctor');

  // THE POINT: another page. Both the picker AND the row's own printed label —
  // asserting only the <select> is what let the register keep saying "Doctor"
  // beside a picker saying "Dr Visits" through a green suite.
  await clickMoreNav(page, 'nav-transactions');
  await page.waitForURL('**/transactions', { timeout: 20000 });
  const options = page.locator('select option');
  await expect(options.filter({ hasText: NEW_NAME }).first()).toHaveCount(1);
  await expect(options.filter({ hasText: /^Doctor$/ })).toHaveCount(0);

  const row = page.getByTestId('txn-row').filter({ hasText: 'CITY MEDICAL' }).first();
  await expect(row).toBeVisible();
  await expect(row).toContainText(NEW_NAME);
  await expect(row).not.toContainText('Doctor');

  // Reset puts the built-in name back everywhere.
  await page.goto('/settings');
  await page.getByTestId('cat-rename-reset-doctor').click();
  await expect(page.getByTestId('renamed-count')).toHaveCount(0, { timeout: 20000 });
  await page.goto('/transactions');
  await expect(page.locator('select option').filter({ hasText: /^Doctor$/ }).first()).toHaveCount(1);
  await expect(
    page.getByTestId('txn-row').filter({ hasText: 'CITY MEDICAL' }).first(),
  ).toContainText('Doctor');
});

test('removing a built-in category takes it out of the picker and says so', async ({ page }) => {
  await signUpThrowaway(page);

  // Assert the hard case is PRESENT before removing it. Without this the
  // "count 0" below passes on a page that never rendered a picker at all.
  await page.goto('/transactions');
  await expect(
    page.locator('select option').filter({ hasText: /^Car Wash$/ }).first(),
  ).toHaveCount(1);

  await page.goto('/settings');
  await expect(page.getByTestId('cat-visibility-car-wash')).toBeVisible();
  await page.getByTestId('cat-visibility-car-wash').click();
  await expect(page.getByTestId('hidden-count')).toContainText('removed', { timeout: 20000 });

  await page.goto('/transactions');
  await expect(
    page.locator('select option').filter({ hasText: /^Car Wash$/ }),
  ).toHaveCount(0);
});
