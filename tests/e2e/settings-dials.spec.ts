/**
 * Money Dials settings / onboarding flow (380×800).
 *
 * The dials are visitor-personalization state on the SHARED demo row: a visitor's
 * dials re-derive the coaching figures the NEXT visitor sees, so the demo now
 * renders the fence note instead of the form (server action refuses too — the
 * unit locks live in tests/unit/shared-demo-fences.test.ts). The round-trip
 * coverage that used to drive the demo row moved to a THROWAWAY user (the
 * budget-targets.spec.ts pattern, TASKS G.1): sign up a fresh user, seed two
 * accounts, run the validation + persistence flow on that user's own row.
 *
 * The two read-only specs (AI-trust, activation) stay demo-signed: they mutate
 * nothing and are golden-safe alongside the throwaway test under fullyParallel.
 */
import { expect, test, type Page } from './helpers/test';
import AxeBuilder from '@axe-core/playwright';
import Database from 'better-sqlite3';
import { E2E_DB_URL } from '../setup/test-db';

async function signInDemo(page: Page) {
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
}

/** Throwaway user + two fundable accounts (CHECKING + SAVINGS) so the payment-
 *  account picker's eligibility rule (checking/savings offered, credit cards
 *  not) stays assertable on a fresh row no other spec reads. The checking
 *  account is ALSO stored as the user's payment account, exactly like the demo
 *  seed: the form's select `defaultValue` reads the stored id, so it survives
 *  the reloads this flow drives. (Without it the fresh user's select resets to
 *  its disabled placeholder after every reload, and the select's `required`
 *  silently blocks every later submit — first observed as a dials-saved
 *  timeout on the moneyDials round-trip.) */
async function signUpAndSeed(page: Page) {
  const email = `e2e-dials-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });

  const db = new Database(E2E_DB_URL.replace(/^file:/, ''), { timeout: Number(process.env.SQLITE_BUSY_TIMEOUT_MS) || 15_000 });
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as { id: string } | undefined;
    if (!user) throw new Error(`signUpAndSeed: user ${email} not found`);
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const chkId = `e2e-dials-acct-chk-${suffix}`;
    const insert = db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, name, type, currentBalanceCents, currency)
       VALUES (?, ?, 'manual', ?, ?, ?, 0, 'USD')`,
    );
    insert.run(chkId, user.id, `cd-${suffix}`, 'Checking', 'CHECKING');
    insert.run(`e2e-dials-acct-sav-${suffix}`, user.id, `cd-sav-${suffix}`, 'Savings', 'SAVINGS');
    db.prepare('UPDATE User SET paymentAccountId = ? WHERE id = ?').run(chkId, user.id);
  } finally {
    db.close();
  }
  return email;
}

test('settings surfaces the AI-trust accuracy panel (Competitive-Gap Gap 4 §2)', async ({ page }) => {
  // Read-only: this asserts the panel renders and reconciles with the seeded
  // accuracy data. It mutates nothing, so it is golden-safe alongside the mutating
  // dials test in this file under the fullyParallel suite.
  await signInDemo(page);
  await page.goto('/settings');

  const card = page.getByTestId('ai-trust-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('AI trust');
  await expect(card).toContainText('Categorization accuracy');
  // the seeded demo has labeled predictions (n > 0), so a real percentage renders
  // (same guarantee the triage accuracy-card test relies on).
  await expect(card).toContainText('%');
  // the no-fabrication promise is stated plainly (Gap 4 — make the trust moat visible)
  await expect(card).toContainText('never invents');

  // the new panel itself is WCAG-AA clean (scoped so unrelated page content can't flake it)
  const results = await new AxeBuilder({ page })
    .include('[data-testid="ai-trust-card"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});

test('settings shows the operator activation checklist, coherent and secret-free (Wave 0.5)', async ({ page }) => {
  // Read-only: renders env-var PRESENCE only. Mutates nothing → golden-safe under the
  // fullyParallel suite. Deliberately does NOT hard-code "0 of 7": the dev machine's
  // .env.local may set some keys, while CI sets none — so instead it asserts the panel
  // is internally coherent (the summary count equals the number of Live badges) and
  // that every dormant row advertises a real env-var NAME, never a value.
  const KEYS = [
    'error-tracking',
    'email',
    'web-push',
    'scheduled-jobs',
    'payment-reminders',
    'weekly-digest',
    'push-notifications',
  ];
  await signInDemo(page);
  await page.goto('/settings');

  const card = page.getByTestId('activation-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Activation checklist');

  const statuses: string[] = [];
  for (const key of KEYS) {
    await expect(page.getByTestId(`activation-row-${key}`)).toBeVisible();
    const status = (await page.getByTestId(`activation-status-${key}`).innerText()).trim();
    expect(status === 'Live' || status === 'Dormant', `${key} status is Live|Dormant`).toBe(true);
    statuses.push(status);
    // Dormant rows must name the env vars to set — from the known name set, never a value.
    if (status === 'Dormant') {
      const row = page.getByTestId(`activation-row-${key}`);
      await expect(row).toContainText('Set to activate:');
      await expect(row).toContainText(/CRON_SECRET|RESEND_API_KEY|VAPID_[A-Z_]+|SENTRY_DSN/);
    }
  }

  // Engine ↔ UI coherence: the header count must equal the Live badges actually shown.
  const liveCount = statuses.filter((s) => s === 'Live').length;
  await expect(page.getByTestId('activation-summary')).toContainText(`${liveCount} of 7 systems live`);

  // The panel itself is WCAG-AA clean (scoped so unrelated page content can't flake it).
  const results = await new AxeBuilder({ page })
    .include('[data-testid="activation-card"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});

test('money dials: the shared demo refuses edits — fence note, no form', async ({ page }) => {
  await signInDemo(page);

  // The onboarding nudge is gated on an unset payment account — the demo user
  // always has one, so it must NOT appear (and never displaces the answer).
  await expect(page.getByTestId('onboarding-nudge')).toHaveCount(0);

  await page.goto('/settings');

  // The card still renders (the stored values stay readable via the coach cards
  // that print them), but the fence note replaces the form: no submit, no inputs
  // — a visitor's dials can never re-derive the coaching figures the NEXT
  // visitor sees on the shared demo row.
  await expect(page.getByTestId('money-dials-card')).toBeVisible();
  await expect(page.getByTestId('dials-demo-note')).toBeVisible();
  await expect(page.getByTestId('money-dials-form')).toHaveCount(0);
  await expect(page.getByTestId('dials-submit')).toHaveCount(0);
});

test('money dials: a real user sees defaults, validation, and persistence round-trips (throwaway)', async ({ page }) => {
  // Fresh user — every dial at its default/blank state, nothing inherited.
  await signUpAndSeed(page);
  await page.goto('/settings');

  await expect(page.getByTestId('money-dials-card')).toBeVisible();
  await expect(page.getByTestId('dials-demo-note')).toHaveCount(0);

  // ── pre-populated defaults ──
  await expect(page.getByTestId('dials-swr')).toHaveValue('4');
  await expect(page.getByTestId('dials-return')).toHaveValue('7');
  await expect(page.getByTestId('dials-wage')).toHaveValue('');
  await expect(page.getByTestId('dials-money-dials')).toHaveValue('');

  // payment account: pre-selected to the seeded checking account (the stored
  // id feeds defaultValue, so it survives reloads); checking/savings are
  // offered, credit cards are not (only fundable accounts are eligible).
  const account = page.getByTestId('dials-payment-account');
  await expect(account).not.toHaveValue('');
  await expect(account).toContainText('Checking');
  await expect(account).toContainText('Savings');
  await expect(account).not.toContainText('Sapphire Card');

  // ── validation: 0% SWR would divide-by-zero the FI number → inline error, no save ──
  await page.getByTestId('dials-swr').fill('0');
  await page.getByTestId('dials-submit').click();
  await expect(page.getByTestId('dials-error-swr')).toBeVisible();
  await expect(page.getByTestId('dials-saved')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('dials-swr')).toHaveValue('4'); // unchanged in the DB

  // ── round-trip a real change through the DB (moneyDials carries no golden value) ──
  await page.getByTestId('dials-money-dials').fill('Travel, Dining Out, Climbing');
  await page.getByTestId('dials-submit').click();
  await expect(page.getByTestId('dials-saved')).toBeVisible();
  await page.reload(); // re-mounts from the DB → proves persistence, not just client state
  await expect(page.getByTestId('dials-money-dials')).toHaveValue('Travel, Dining Out, Climbing');
  await page.getByTestId('dials-money-dials').fill('');
  await page.getByTestId('dials-submit').click();
  await expect(page.getByTestId('dials-saved')).toBeVisible();

  // ── retirement plan (DECISIONS #123) ──
  // Fresh user: all four planning fields blank (= use the documented default).
  await expect(page.getByTestId('dials-current-age')).toHaveValue('');
  await expect(page.getByTestId('dials-retirement-age')).toHaveValue('');
  await expect(page.getByTestId('dials-end-age')).toHaveValue('');
  await expect(page.getByTestId('dials-inflation')).toHaveValue('');

  // ordering validation: a retirement age before the (default 40) current age → inline
  // error, nothing saved.
  await page.getByTestId('dials-retirement-age').fill('30');
  await page.getByTestId('dials-submit').click();
  await expect(page.getByTestId('dials-error-retirementAge')).toBeVisible();
  await expect(page.getByTestId('dials-saved')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('dials-retirement-age')).toHaveValue(''); // unchanged in the DB

  // round-trip the plan through the DB at the EXPLICIT default values — proves persistence
  // on the user's own row.
  await page.getByTestId('dials-current-age').fill('40');
  await page.getByTestId('dials-retirement-age').fill('65');
  await page.getByTestId('dials-end-age').fill('95');
  await page.getByTestId('dials-inflation').fill('2.5');
  await page.getByTestId('dials-submit').click();
  await expect(page.getByTestId('dials-saved')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('dials-current-age')).toHaveValue('40');
  await expect(page.getByTestId('dials-retirement-age')).toHaveValue('65');
  await expect(page.getByTestId('dials-end-age')).toHaveValue('95');
  await expect(page.getByTestId('dials-inflation')).toHaveValue('2.50'); // 250 bps display

  // ── clear back to unset — a throwaway row no other spec reads, but leave it clean ──
  await page.getByTestId('dials-current-age').fill('');
  await page.getByTestId('dials-retirement-age').fill('');
  await page.getByTestId('dials-end-age').fill('');
  await page.getByTestId('dials-inflation').fill('');
  await page.getByTestId('dials-submit').click();
  await expect(page.getByTestId('dials-saved')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('dials-current-age')).toHaveValue('');
  await expect(page.getByTestId('dials-retirement-age')).toHaveValue('');
  await expect(page.getByTestId('dials-end-age')).toHaveValue('');
  await expect(page.getByTestId('dials-inflation')).toHaveValue('');
});
