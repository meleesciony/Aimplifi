/**
 * Connection-health / data-staleness surfaces (Competitive-Gap plan, Gap 1 §3–4).
 *
 * Negative (demo user, all accounts provider 'demo' → never linked): NO dashboard
 * staleness banner, and /accounts shows the SimpleFIN connect front-door (not connected).
 * Positive (throwaway user given a linked account with month-old data via the guarded
 * helper): the dashboard banner AND the /accounts "you may need to reconnect" hint render.
 *
 * Copy is asserted on its STABLE parts — the day count varies with business "today", so the
 * spec pins the wording, not the number (the exact boundaries live in tests/unit/sync-health).
 */
import { execSync } from 'node:child_process';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './helpers/test';
import { E2E_DB_URL } from '../setup/test-db';

test('demo user (no linked feed) sees no staleness banner; /accounts shows the connect front-door', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard', { timeout: 20000 });
  // Anchor on page content below the route-group Suspense boundary before asserting
  // absence (the #141 anchor rule — never a layout element that flushes over a skeleton).
  await expect(page.getByTestId('net-worth-card')).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('stale-data-banner')).toHaveCount(0);
  // Gap 1 §4: no connection ever failed for the demo user → no reconnect alert (no false alarm).
  await expect(page.getByTestId('connection-alerts-card')).toHaveCount(0);

  await page.goto('/accounts');
  await expect(page.getByTestId('accounts-net-worth')).toBeVisible({ timeout: 20000 });
  // No SimpleFIN connection for the demo user → the connect front-door, not the connected row.
  await expect(page.getByTestId('simplefin-connect-btn')).toBeVisible();
  await expect(page.getByTestId('simplefin-connected')).toHaveCount(0);
  // Every demo account is provider 'demo' → no per-account freshness line (golden-safe).
  await expect(page.getByTestId('account-freshness')).toHaveCount(0);
});

test('a linked account with month-old data surfaces the staleness banner + reconnect hint', async ({ page }) => {
  const email = `e2e-stale-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  const password = 'e2e-password-123';

  // Ad-hoc real signup (tests/e2e/auth.spec.ts pattern) — lands on empty onboarding.
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill(password);
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20000 });
  await expect(page.getByTestId('empty-dashboard')).toBeVisible();

  // Give this user a linked account whose newest transaction is a month old, plus a
  // connection whose last sync is a month old (guarded — off-tree e2e DB + throwaway email).
  execSync(`npx tsx scripts/e2e-add-stale-linked-account.ts ${email}`, {
    env: { ...process.env, DATABASE_URL: E2E_DB_URL },
    stdio: 'inherit',
  });

  // Dashboard: the linked feed is very stale → banner renders (stable copy).
  await page.goto('/dashboard');
  const banner = page.getByTestId('stale-data-banner');
  await expect(banner).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('empty-dashboard')).toHaveCount(0);
  await expect(banner).toContainText("haven't shown new activity");
  await expect(banner).toContainText('A sync may have stopped');
  await expect(banner.getByRole('link', { name: 'Go to Accounts' })).toBeVisible();

  // Axe on the banner — the demo user never renders it, so phase5-a11y can't cover it.
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(axe.violations).toEqual([]);

  // /accounts: the connected SimpleFIN row shows the stale reconnect hint (amber).
  await page.goto('/accounts');
  await expect(page.getByTestId('accounts-net-worth')).toBeVisible({ timeout: 20000 });
  const status = page.getByTestId('simplefin-sync-status');
  await expect(status).toBeVisible();
  await expect(status).toContainText('you may need to reconnect');

  // Per-account freshness (Gap 1 §3 follow-up): the linked checking row carries its own
  // very_stale line — the same month-old reference the connection status uses.
  const freshness = page.getByTestId('account-freshness');
  await expect(freshness).toHaveCount(1);
  await expect(freshness).toContainText('you may need to reconnect');

  // Axe on /accounts in the stale state — the demo page never renders the amber freshness
  // line (all accounts are provider 'demo'), so phase5-a11y cannot cover it.
  const accountsAxe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(accountsAxe.violations).toEqual([]);
});

test('a connection whose last sync FAILED surfaces the dashboard reconnect alert (Gap 1 §4)', async ({ page }) => {
  const email = `e2e-broken-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  const password = 'e2e-password-123';

  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill(password);
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20000 });
  await expect(page.getByTestId('empty-dashboard')).toBeVisible();

  // Put this user's SimpleFIN connection into a persisted FAILED state (guarded helper).
  execSync(`npx tsx scripts/e2e-set-broken-connection.ts ${email}`, {
    env: { ...process.env, DATABASE_URL: E2E_DB_URL },
    stdio: 'inherit',
  });

  await page.goto('/dashboard');
  const alert = page.getByTestId('connection-alerts-card');
  await expect(alert).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('empty-dashboard')).toHaveCount(0);
  await expect(alert).toContainText("couldn't sync");
  await expect(alert).toContainText('Reconnect it on the Accounts page');
  // The sanitized reason is a breadcrumb only — never shown to the user.
  await expect(alert).not.toContainText('auth');
  await expect(alert.getByRole('link', { name: 'Go to Accounts' })).toBeVisible();

  // Axe on the destructive alert — the demo user never renders it, so phase5-a11y can't cover it.
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(axe.violations).toEqual([]);
});

test('SimpleFIN accounts that OUTLIVED their connection get the honest disconnected surfaces (K.2b)', async ({ page }) => {
  const email = `e2e-orphan-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  const password = 'e2e-password-123';

  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill(password);
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20000 });
  await expect(page.getByTestId('empty-dashboard')).toBeVisible();

  // The K.2b production state: SimpleFIN accounts kept, connection row DELETED — the exact
  // shape disconnectSimplefin leaves behind (guarded helper; off-tree e2e DB only).
  execSync(`npx tsx scripts/e2e-orphan-simplefin.ts ${email}`, {
    env: { ...process.env, DATABASE_URL: E2E_DB_URL },
    stdio: 'inherit',
  });

  await page.goto('/accounts');
  await expect(page.getByTestId('accounts-net-worth')).toBeVisible({ timeout: 20000 });

  // The front door states the connection is GONE and names what it stranded — never
  // first-time setup over frozen accounts. Date is the helper's literal LAST_DATA_DATE.
  const notice = page.getByTestId('simplefin-disconnected-notice');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('Your SimpleFIN connection was removed');
  await expect(notice).toContainText('2 accounts');
  // "no new transactions since" — transaction-precise, because balances can move on paths
  // this date never sees (critic P2-3).
  await expect(notice).toContainText('no new transactions since Fri, May 1, 2026');
  await expect(notice).toContainText('your saved transactions are kept');
  await expect(page.getByTestId('simplefin-connect-btn')).toHaveText('Reconnect your bank (SimpleFIN)');
  await expect(page.getByTestId('simplefin-connected')).toHaveCount(0);

  // Per-row freshness: the PROVEN fact, not the stale-feed hedge — and NO per-row remedy
  // (critic P1-2/P1-3: "reconnect" cannot resume a Plaid dangling row or a superseded
  // predecessor, so the instruction lives only on the SimpleFIN front door above). The card
  // carries the last-transaction date; the checking row (no transactions) names the fact
  // without a date.
  const freshness = page.getByTestId('account-freshness');
  await expect(freshness).toHaveCount(2);
  await expect(freshness.filter({ hasText: 'last transaction' })).toHaveCount(1);
  for (const line of await freshness.all()) {
    await expect(line).toContainText('Bank connection removed');
    await expect(line).not.toContainText('may need to reconnect');
    await expect(line).not.toContainText('Reconnect to resume');
  }

  // Opening the door shows the reconnect framing (kept data + background backfill, bounded
  // by what the bank still shares — never "resumes where your data stopped", critic P1-1)
  // and the submit reads Reconnect — the reader is resuming, not starting over.
  await page.getByTestId('simplefin-connect-btn').click();
  await expect(page.getByTestId('simplefin-form')).toBeVisible();
  await expect(page.getByTestId('simplefin-form')).toContainText('keeps everything already saved');
  await expect(page.getByTestId('simplefin-form')).toContainText('as far back as your bank still shares');
  await expect(page.getByTestId('simplefin-submit')).toHaveText('Reconnect');

  // Axe on the disconnected state — no other spec renders this notice.
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(axe.violations).toEqual([]);
});
