/**
 * Budget targets (ROADMAP #7) — set a monthly target, overwrite it (atomic
 * upsert → one row), scan the target-bearing DOM for WCAG AA, then clear it.
 *
 * Runs on a THROWAWAY user, not the shared demo (TASKS G.1, 2026-08-08). It used
 * to sign in as the demo and clear at the end "so the shared DB is left
 * target-free", on a header claim that "no other spec asserts a budget target" —
 * which was false: `pwa-offline.spec.ts:44-49` drives the same set/clear
 * round-trip on the demo's groceries target, concurrently, under
 * `fullyParallel` with 4 workers.
 *
 * Different categories, so the rows never collided — the collision was for the
 * WRITER. The e2e DB is single-writer SQLite, and `playwright.config.ts`'s own
 * worker note records the consequence: concurrent demo sessions sever enough
 * server-action confirmation streams to flunk exactly the reload-bearing
 * mutation specs, "pwa-offline's budget-clear round-trip flaked exactly this
 * way". This spec's clear is the same round-trip and had become the standing red
 * on the CI ship gate — runs 31243413430 / 31243942530 / 31244506540, three
 * consecutive shas, none of which touched budget code.
 *
 * A throwaway user removes this spec from that contention entirely and makes the
 * cleanup moot: nothing else reads its rows. Not one assertion is weakened — the
 * upsert-yields-ONE-row invariant, the a11y scan and the clear round-trip are all
 * user-agnostic, and budget targets are display-only (they feed only /budgets,
 * never cash-needed, FI or net worth), so no golden value moves either way.
 */
import AxeBuilder from '@axe-core/playwright';
import Database from 'better-sqlite3';
import { expect, test, type Page } from './helpers/test';
import { E2E_DB_URL } from '../setup/test-db';

/** /budgets renders first-run onboarding until an account exists, so the throwaway
 *  user needs exactly one. No transactions: the target-bearing DOM this spec asserts
 *  (target, remaining status, Clear control) does not depend on any spend. */
function seedAccount(email: string) {
  const db = new Database(E2E_DB_URL.replace(/^file:/, ''), { timeout: 15_000 });
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as { id: string } | undefined;
    if (!user) throw new Error(`seedAccount: user ${email} not found`);
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, name, type, currentBalanceCents, currency)
       VALUES (?, ?, 'manual', ?, 'Checking', 'CHECKING', 250000, 'USD')`,
    ).run(`e2e-budget-acct-${suffix}`, user.id, `mb-${suffix}`);
  } finally {
    db.close();
  }
}

async function signIn(page: Page): Promise<string> {
  const email = `e2e-budget-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  return email;
}

test('budget targets: set, scan a11y, overwrite atomically, then clear', async ({ page }) => {
  seedAccount(await signIn(page));
  await page.goto('/budgets');
  await expect(page.getByTestId('budget-list')).toBeVisible();
  // Seed has no budgets (#37) — first-run hint is visible before we set one (#186).
  await expect(page.getByTestId('budget-no-targets-hint')).toBeVisible();

  // Set a $500/mo target on Dining Out.
  await page.getByTestId('budget-category').selectOption('dining');
  await page.getByTestId('budget-amount').fill('500');
  await page.getByTestId('budget-set').click();

  const row = page.getByTestId('budget-row-dining');
  await expect(row).toBeVisible();
  await expect(page.getByTestId('budget-no-targets-hint')).toHaveCount(0);
  await expect(row).toContainText('/ $500.00'); // actual / target
  await expect(row).toContainText(/left this month|over target/); // remaining status
  await expect(page.getByTestId('budget-clear-dining')).toBeVisible();

  // WCAG AA on the target-bearing DOM (Clear button, progress bar, status text) —
  // the seed has no budgets, so the phase5 scan never sees these conditional nodes.
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);

  // Overwrite the SAME category — the upsert must yield ONE row at the new amount.
  await page.getByTestId('budget-category').selectOption('dining');
  await page.getByTestId('budget-amount').fill('700');
  await page.getByTestId('budget-set').click();
  await expect(row).toContainText('/ $700.00');
  await expect(row).not.toContainText('/ $500.00');
  await expect(page.getByTestId('budget-row-dining')).toHaveCount(1); // not duplicated

  // Clear it — the round-trip under test. No longer a cleanup: this user is a throwaway.
  //
  // The clear awaits its server action UNDER A DEADLINE and reloads in `finally` — the
  // component's own comment says the clear "usually COMMITTED" when the deadline fires. On a
  // loaded CI runner that reload can beat the commit, and one reload is ONE read: the old 15s
  // poll then watched a static post-reload DOM forever ("33 × resolved to 1" — the long-lived
  // "documented CI flake" at this exact line, same family as category-rename:110). So: wait for
  // the action's own response first, then poll with RELOADS, so a slow commit is re-read rather
  // than immortalised.
  const actionSettled = page
    .waitForResponse((r) => r.request().method() === 'POST', { timeout: 12000 })
    .catch(() => null);
  await page.getByTestId('budget-clear-dining').click();
  await actionSettled;
  await expect(async () => {
    await page.reload();
    await expect(page.getByTestId('budget-clear-dining')).toHaveCount(0, { timeout: 2000 });
  }).toPass({ timeout: 20000 });
});
