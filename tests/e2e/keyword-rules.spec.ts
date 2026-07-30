/**
 * The rule builder, driven end to end (TASKS O.13a).
 *
 * Owner, with a screenshot of three deposits: *"Build the categorizer so I can group
 * all 'Cardone' into income. I've clicked many of these already and categorized. The
 * system clearly isn't smart enough to identify trends."*
 *
 * This spec reproduces exactly that shape — two deposits whose descriptors share ONE
 * word and nothing else, each carrying the `~ Tran:` id his bank appends — and drives
 * a real signed-up account through typing the keyword, seeing the count, and filing
 * both. It exists because the unit and integration locks cannot see the page: they
 * proved the engine and the server, while what he reported was that no surface let
 * him say it (docs/lessons/fencing-a-write-path-breaks-the-tests-that-drove-it.md —
 * the register/inbox specs run on the demo user, and this feature is fenced off it,
 * so it needs its own throwaway account).
 */
import { expect, test, type Page } from './helpers/test';

/** Two Cardone deposits: one shared word, different funds, different ids. */
const DEPOSITS = [
  { descriptor: 'Cardone Eq Fund Cef Xv Ppd Tran 9912', amount: '375.00' },
  { descriptor: 'Cardone Equity F Cef Ix Ppd Tran 4471', amount: '412.50' },
];
/** A row that must NOT be swept in: an inflow, same account, unrelated payee. */
const OTHER = { descriptor: 'Lakeshore Learning Mater', amount: '18.65' };

async function signUpThrowaway(page: Page) {
  const email = `e2e-kw-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20000 });
}

/**
 * A fresh signup owns no accounts, so the manual-transaction form's Account select
 * is EMPTY and the row can never be submitted — which is what the first run of this
 * spec discovered (the page snapshot in the failure trace showed the empty
 * combobox). Create one checking account first, the `transactions.spec` idiom.
 */
async function addManualAccount(page: Page, name: string) {
  await page.goto('/accounts');
  // The first click after a load can land pre-hydration and drop silently — the
  // click-and-verify retry is the hydration barrier (#167 idiom).
  await expect(async () => {
    await page.getByTestId('add-asset-btn').click({ timeout: 2000 });
    await expect(page.getByTestId('manual-name')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20000 });
  await page.getByTestId('manual-name').fill(name);
  await page.getByTestId('manual-type').selectOption('CHECKING');
  await page.getByTestId('manual-value').fill('2500');
  await page.getByTestId('manual-submit').click();
  await expect(page.getByTestId('manual-account-row').filter({ hasText: name })).toBeVisible({
    timeout: 20000,
  });
}

async function addDeposit(page: Page, descriptor: string, amount: string) {
  await page.goto('/transactions/new');
  // Money-in is React state: a pre-hydration click drops silently and the row would
  // file as money OUT, which would change what the sign warning says (#167 idiom).
  await expect(async () => {
    await page.getByTestId('dir-in').click({ timeout: 2000 });
    await expect(page.getByTestId('dir-in')).toHaveAttribute('aria-pressed', 'true', { timeout: 2000 });
  }).toPass({ timeout: 20000 });
  await page.getByTestId('txn-descriptor').fill(descriptor);
  await page.getByTestId('txn-amount').fill(amount);
  await page.getByTestId('txn-submit').click();
  await page.waitForURL('**/transactions', { timeout: 20000 });
}

test('one typed keyword groups deposits no derived key could ever join', async ({ page }) => {
  await signUpThrowaway(page);
  await addManualAccount(page, 'KW Checking');
  for (const d of DEPOSITS) await addDeposit(page, d.descriptor, d.amount);
  await addDeposit(page, OTHER.descriptor, OTHER.amount);

  // The register is where he notices the problem, so that is where the door is.
  await page.goto('/transactions');
  await expect(page.getByTestId('rules-link')).toBeVisible({ timeout: 20000 });
  await page.getByTestId('rules-link').click();
  await page.waitForURL('**/rules', { timeout: 20000 });

  // No rules yet — the honest empty state, not a fabricated list.
  await expect(page.getByTestId('kw-empty')).toBeVisible();

  await page.getByTestId('kw-input').fill('cardone');
  await page.getByTestId('kw-category').selectOption('investment-income');
  await page.getByTestId('kw-preview').click();

  // THE CLAIM THE READER ACTS ON: the count, before the rule exists.
  const result = page.getByTestId('kw-preview-result');
  await expect(result).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('kw-preview-count')).toContainText('2');
  // Both Cardone rows are named; the unrelated inflow is not.
  await expect(result).toContainText('Cardone Eq Fund Cef Xv Ppd');
  await expect(result).toContainText('Cardone Equity F Cef Ix Ppd');
  await expect(result).not.toContainText('Lakeshore');
  // Both matched rows are inflows filed as income, so no sign warning is due.
  await expect(page.getByTestId('kw-sign-warning')).toHaveCount(0);

  await page.getByTestId('kw-create').click();
  await expect(page.getByTestId('kw-done')).toContainText('2', { timeout: 20000 });

  // The rule is visible and removable — an invisible rule that files money is worse
  // than no rule. The wait budget is explicit because this assertion follows a
  // `router.refresh()`, i.e. a server round-trip: under full-suite contention the
  // default 5s expired while the list was still in flight (this spec failed 3 of 4
  // full runs and passed every time it ran alone — the documented load-flake
  // signature, in my own assertion rather than in the app).
  await expect(page.getByTestId('kw-rule-row')).toHaveCount(1, { timeout: 20000 });
  await expect(page.getByTestId('kw-rule-row')).toContainText('cardone', { timeout: 20000 });

  // And the register now shows the category on BOTH rows, while the unrelated
  // inflow is untouched.
  await page.goto('/transactions');
  const rows = page.getByTestId('txn-row');
  await expect(rows.filter({ hasText: 'Cardone Eq Fund' })).toContainText(/investment income/i, {
    timeout: 20000,
  });
  await expect(rows.filter({ hasText: 'Cardone Equity F' })).toContainText(/investment income/i, {
    timeout: 20000,
  });
  await expect(rows.filter({ hasText: 'Lakeshore' })).toContainText(/uncategorized/i, {
    timeout: 20000,
  });
});

test('the builder refuses a key that would match everything', async ({ page }) => {
  await signUpThrowaway(page);
  await page.goto('/rules');
  // A blank key cannot even be submitted (the field is required), so the refusal a
  // reader can actually reach is a key of pure separators.
  await page.getByTestId('kw-input').fill(' , , ');
  await page.getByTestId('kw-category').selectOption('investment-income');
  await page.getByTestId('kw-preview').click();
  await expect(page.getByTestId('kw-preview-result')).toContainText('at least one word', {
    timeout: 20000,
  });
  // No create button is offered for an empty key.
  await expect(page.getByTestId('kw-create')).toHaveCount(0);
});
