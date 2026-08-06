/**
 * Payment reminders (ROADMAP #6) — the in-app surface + the cron mechanism's gate.
 * /calendar shows upcoming card and loan payments (derived from the same obligations
 * as the headline), and the reminder cron route is secret-guarded like sync.
 */
import { type Page, expect, test } from './helpers/test';

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
}

/**
 * TASKS K.5 — re-pointed from the dashboard to /calendar.
 *
 * This asserted the dashboard reminders card, which #369 deleted on 2026-08-01. The capability it
 * guarded — upcoming dues listed by NAME, cards and loans in one place — did not move to /cards,
 * which is cards-only by design (L.19), and did not survive on Home: the Today feed's `payment_due`
 * row prints "Payment due — $X by DATE" and names no account at all (`Proposal.merchant` is null
 * for that kind). /calendar is the one surface that still names both, painting `card-due` and
 * `loan-due` events with the account label and a "due" badge, which is what K.1 built.
 *
 * The "no card listed twice" half does NOT move here: on a calendar a card legitimately recurs
 * across months, so counting labels would assert the wrong thing. That invariant is guarded where
 * it belongs — per-cardId rows on /cards, and dashboard-duplicate-disclosure.spec's explicit
 * two-copies fixture.
 */
test('upcoming card AND loan payments are listed by name — /calendar', async ({ page }) => {
  await signIn(page);
  await page.goto('/calendar');

  const list = page.getByTestId('calendar-list');
  await expect(list).toBeVisible({ timeout: 20_000 });

  // The seed has cards due this cycle → dated due events, each named and badged.
  await expect(list).toContainText('Platinum Card due');
  await expect(list).toContainText('Sapphire Card due');
  await expect(list.getByText('due', { exact: true }).first()).toBeVisible();

  // The seed Auto Loan surfaces the same way (#134): loan payments share this surface with cards,
  // while the cash-needed dollar headline stays card-only. It is not in the CURRENT month — its
  // anchor sits on or before the pinned today (2026-06-10) and `build.ts` skips a due already
  // past — so this steps to the next month rather than asserting a loan the fixture cannot show
  // here. The claim under test is that a loan appears as a named due at all, not which month.
  await page.getByTestId('cal-next').click();
  await expect(page.getByTestId('calendar-list')).toContainText('Auto Loan');
});

test('reminder cron route requires the secret', async ({ browser }) => {
  const fresh = await browser.newContext();
  const anon = await fresh.newPage();
  const res = await anon.request.get('/api/cron/reminders');
  expect(res.status()).toBe(401);
  await fresh.close();
});

test('weekly digest cron route requires the secret', async ({ browser }) => {
  const fresh = await browser.newContext();
  const anon = await fresh.newPage();
  const res = await anon.request.get('/api/cron/digest');
  expect(res.status()).toBe(401);
  await fresh.close();
});
