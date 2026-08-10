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
 * two-copies fixture. The LOAN half could not move here either — see K.7 below.
 */
test('upcoming card payments are listed by name — /calendar', async ({ page }) => {
  await signIn(page);
  await page.goto('/calendar');

  const list = page.getByTestId('calendar-list');
  await expect(list).toBeVisible({ timeout: 20_000 });

  // The seed has cards due this cycle → dated due events, each named and badged.
  await expect(list).toContainText('Platinum Card due');
  await expect(list).toContainText('Sapphire Card due');
  await expect(list.getByText('due', { exact: true }).first()).toBeVisible();

  // TASKS K.7 — the loan half, locked at last. The demo's Auto Loan paints as a badged
  // `loan-due` obligation ("Auto Loan due"), never as a detected series. June's payment
  // (due the 5th, before the pinned demo asOf) has already passed, so the lock looks at
  // July — `k7-loan-due-probe.mts` swept Jul 2026 → Mar 2027 on a fresh seed and found
  // exactly one loan-due per month at $385.00, business-day-adjusted to 07-02.
  await page.goto('/calendar?month=2026-07');
  await expect(page.getByTestId('calendar-list')).toContainText('Auto Loan due');
});

/**
 * TASKS K.7 — the loan half of #134, now asserted above (see the lock in the test).
 *
 * It could not be asserted while K.7 was open: /calendar painted the demo's Auto Loan as a
 * DETECTED RECURRING SERIES ("Auto loan — CarMax", `scheduled` badge) and never as a `loan-due`,
 * because the STALE production demo had been seeded once and never reseeded. The diagnosis
 * (PROGRESS 2026-08-09) proved by execution that a FRESH seed is correct — the obligation paints
 * `Auto Loan due` every month from the anchor forward and no detected series exists — and that
 * the real defect was a double-count: on the ordinary shape a loan obligation AND the
 * recurring-detected ACH that pays it both projected the same payment. The ownership rule
 * (`src/lib/engine/loans/duplicate-projection.ts`) now suppresses the C.25-proven row on
 * /calendar, /forecast and /radar, so the demo's loan-due paints exactly once — and the fresh
 * seed (which this suite runs against) is the state the assertion locks.
 */


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
