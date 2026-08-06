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

  // The loan half of #134 is NOT asserted here, and deliberately not asserted as an absence
  // either: pinning "no loan due appears" would lock in the very gap K.7 exists to close, and this
  // test would then go red when someone fixes it. See K.7 below.
});

/**
 * TASKS K.7 — the half of #134 that this file can no longer assert anywhere.
 *
 * The test above USED to end `await expect(card).toContainText('Auto Loan')`, on the reminders card,
 * for the #134 claim: "loan payments share the reminders surface with cards, while the cash-needed
 * dollar headline stays card-only." #369 deleted that card, and while re-pointing this I first
 * wrote the assertion against /calendar and it PASSED — for the wrong reason, which is why it is
 * not here now.
 *
 * What /calendar actually paints for the demo's Auto Loan, verified on production 2026-08-06 across
 * Jun/Jul/Sep/Oct/Nov 2026: a row labelled "Auto loan — CarMax" carrying the `scheduled` badge —
 * a DETECTED RECURRING SERIES (an `outflow` event), never a `loan-due`. No month shows the
 * `${accountName} due` label with the `due` badge that `build.ts` emits for a loan obligation.
 *
 * That contradicts the seed's own stated design (`src/lib/seed/build.ts:550`): the auto-loan
 * payment was deliberately REMOVED from the scheduled rows because "the loan account drives a
 * first-class loan-due obligation on the calendar + reminders (#134) … a duplicate scheduled row
 * here would double-display it." The account is there with the right terms (`acct-autoloan`,
 * `minimumPaymentCents: 38500`, `dueDayOfMonth: 5`) and $385.00 on the 5th is exactly what shows —
 * as a series, not as a due.
 *
 * So either `selectLoanObligations` yields nothing for the demo loan and a detected series is
 * standing in, or the calendar is not receiving it. Both are outside K.5 (a test-debt slice) and
 * neither should be papered over by an assertion that matches the string "Auto loan" wherever it
 * happens to appear — an assertion that would stay green if loan dues were deleted outright.
 * Recorded in TASKS as K.7 rather than asserted here.
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
