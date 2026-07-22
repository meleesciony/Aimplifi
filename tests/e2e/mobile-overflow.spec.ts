/**
 * Wave M.1 — the mobile layout gate that was missing (docs/MOBILE_UI_BRIEF.md).
 *
 * WHY THIS FILE EXISTS: the 143-test e2e suite renders at exactly ONE width
 * (mobile-380) and NO test asserted anything about layout — so a page whose
 * content runs off the right edge passed here and looked broken on the owner's
 * phone (real screenshots 2026-07-21: /accounts Assets + Liabilities, money
 * values and the Delete action clipped by the viewport edge). A half-visible
 * figure is a WRONG figure — the cardinal sin this codebase is organised around.
 *
 * This spec asserts the objective invariant a screenshot can't: at every real
 * phone width, the document is not wider than the viewport
 * (scrollWidth <= clientWidth). It loops widths inside one browser context
 * (cheaper and more targeted than 4×-ing every project) and reproduces the
 * owner's exact trigger — LONG account names + 6/7-figure balances — on a
 * throwaway signup user, because the frozen demo seed has short names and
 * modest figures and so cannot by itself reproduce the reported overflow.
 */
import Database from 'better-sqlite3';
import { expect, test, type Page } from '@playwright/test';
import { E2E_DB_URL } from '../setup/test-db';

// Narrowest common Android, iPhone 15/16, and Pro Max — all below Tailwind `sm`
// (640), so this is the unprefixed mobile default every real phone lands on.
const WIDTHS = [360, 393, 430] as const;
const HEIGHT = 900;

async function assertFitsEveryWidth(page: Page, label: string) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: HEIGHT });
    // Let flex/grid reflow settle before measuring.
    await page.waitForTimeout(50);
    const m = await page.evaluate(() => {
      const el = document.scrollingElement ?? document.documentElement;
      return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
    });
    // +1 absorbs sub-pixel rounding only. Anything beyond that is real overflow.
    expect(
      m.scrollWidth,
      `${label} @${width}px overflows horizontally: scrollWidth ${m.scrollWidth} > clientWidth ${m.clientWidth}. A money value pushed off the right edge is a wrong value.`,
    ).toBeLessThanOrEqual(m.clientWidth + 1);
  }
}

async function signInDemo(page: Page) {
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
}

async function signUpThrowaway(page: Page): Promise<string> {
  const email = `e2e-overflow-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  return email;
}

/**
 * Seed a SYNCED (provider='simplefin') account for a signed-up user, straight
 * into the e2e SQLite the running server reads. This is the ONLY way to render a
 * real LinkedRow with a long institution name — the manual-add UI caps names at
 * 60 chars and always renders a ManualRow, but the owner's overflow is in
 * LinkedRow (a synced name like "Charles Schwab US Community Property …383 (383)"
 * that doesn't truncate). Synced names have no length cap.
 */
function seedSyncedAccount(opts: {
  email: string;
  name: string;
  type: string;
  balanceCents: number;
}) {
  const file = E2E_DB_URL.replace(/^file:/, '');
  const db = new Database(file, { timeout: 15_000 });
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(opts.email) as
      | { id: string }
      | undefined;
    if (!user) throw new Error(`seedSyncedAccount: user ${opts.email} not found`);
    const id = `e2e-linked-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    db.prepare(
      `INSERT INTO Account (id, userId, provider, name, type, currentBalanceCents, currency)
       VALUES (?, ?, 'simplefin', ?, ?, ?, 'USD')`,
    ).run(id, user.id, opts.name, opts.type, opts.balanceCents);
  } finally {
    db.close();
  }
}

async function addManual(
  page: Page,
  kind: 'asset' | 'liability',
  name: string,
  typeId: string,
  value: string,
) {
  const btn = kind === 'asset' ? 'add-asset-btn' : 'add-liability-btn';
  await expect(async () => {
    await page.getByTestId(btn).click({ timeout: 2_000 });
    await expect(page.getByTestId('manual-name')).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await page.getByTestId('manual-name').fill(name);
  await page.getByTestId('manual-type').selectOption(typeId);
  await page.getByTestId('manual-value').fill(value);
  await page.getByTestId('manual-submit').click();
  await expect(
    page.getByTestId('manual-account-row').filter({ hasText: name }),
  ).toBeVisible({ timeout: 20_000 });
}

test('/accounts (demo) fits every phone width without horizontal overflow', async ({ page }) => {
  await signInDemo(page);
  await page.goto('/accounts');
  await expect(page.getByTestId('accounts-net-worth')).toBeVisible();
  await assertFitsEveryWidth(page, '/accounts (demo)');
});

test('/accounts with long names + large balances fits every phone width', async ({ page }) => {
  await signUpThrowaway(page);
  await page.goto('/accounts');
  // Mirror the owner's real rows: a long institution name and a 7-figure asset,
  // plus a long-named 6-figure liability, so BOTH the net-worth summary line
  // (two big figures side by side) and a long row name are exercised.
  // Names stay <=60 chars (the manual-account cap); synced names can be longer,
  // but the overflow driver the owner hit is the net-worth summary line holding
  // two big figures, which these 6/7-figure balances reproduce.
  await addManual(
    page,
    'asset',
    'Charles Schwab US Roth Contributory IRA 156',
    'INVESTMENT',
    '1735553.08',
  );
  await addManual(
    page,
    'liability',
    'American Express Delta SkyMiles Platinum Card',
    'OTHER_LIABILITY',
    '997970.24',
  );
  await expect(page.getByTestId('accounts-net-worth')).toBeVisible();
  await assertFitsEveryWidth(page, '/accounts (long names + large balances)');
});

test('/accounts with a long SYNCED account name fits every phone width', async ({ page }) => {
  // The owner's exact failure mode: a synced (LinkedRow) account whose long
  // institution name pushes the balance and Delete control off the right edge.
  const email = await signUpThrowaway(page);
  seedSyncedAccount({
    email,
    name: 'Charles Schwab US Community Property Brokerage 383 (383)',
    type: 'INVESTMENT',
    balanceCents: 89876543,
  });
  seedSyncedAccount({
    email,
    name: 'American Express Additional Delta SkyMiles Platinum Card 20',
    type: 'CREDIT',
    balanceCents: 22544,
  });
  await page.goto('/accounts');
  await expect(
    page.getByTestId('account-row').filter({ hasText: 'Charles Schwab US Community Property' }),
  ).toBeVisible({ timeout: 20_000 });
  await assertFitsEveryWidth(page, '/accounts (long synced name)');
});
