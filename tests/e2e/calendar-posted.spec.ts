/**
 * TASKS K.1 — the past half of /calendar shows what actually POSTED (owner report
 * 2026-08-06: "Calendar makes no sense. I have forward data but not trailing?").
 *
 * The unit suite proves the pure builder; the server test proves the posted read
 * and the register query one row set. What only the browser can prove is the K.1
 * GATE at the shipped seam: the money a calendar day PAINTS equals the money the
 * register paints when the day's own link is followed — read off both DOMs and
 * compared, never trusted from either. Plus the two closures the task names: the
 * "Previous month" arrow lands on a grid with real content, and an empty month
 * names WHICH zero (here: a month before the demo corpus began names the floor).
 *
 * Read-only against the shared demo dataset (asOf pinned 2026-06-10) — nothing
 * here writes, so the golden seed is safe.
 */
import { expect, test, type Page } from './helpers/test';

/** "$1,629.44" → 162944; handles signed "−$1,629.44" / "+$1,629.44". */
function parseCents(text: string): number {
  const negative = /[-−]/.test(text);
  const digits = text.replace(/[^0-9.]/g, '');
  const value = Math.round(Number(digits) * 100);
  return negative ? -value : value;
}

async function signInDemo(page: Page) {
  await page.goto('/');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
}

/** The month before the pinned demo today (2026-06-10): a full posted month in the seed. */
const PAST_MONTH = '2026-05';
/** Safely before the 18-month demo corpus begins. */
const PREHISTORIC_MONTH = '2023-01';

test('the previous month paints posted activity, and a day agrees with the register it links to', async ({
  page,
}) => {
  await signInDemo(page);
  await page.goto('/calendar');
  await expect(page.getByTestId('cal-month')).toHaveAttribute('data-month', '2026-06', {
    timeout: 20_000,
  });

  // K.1 closure #1: the Previous arrow no longer lands on a grid that can only be empty.
  await page.getByTestId('cal-prev').click();
  await expect(page.getByTestId('cal-month')).toHaveAttribute('data-month', PAST_MONTH, {
    timeout: 20_000,
  });
  await expect(page.getByTestId('cal-posted-line')).toContainText('Posted', { timeout: 20_000 });

  // Anti-vacuity: a real posted day with a non-zero outflow, read off the calendar's own DOM.
  // The day item is the OUTER list row (it contains the posted-out line as a descendant — the
  // inner line itself has no such descendant, so :has() selects exactly the day).
  const dayItem = page.locator('li:has([data-testid="cal-posted-out"])').first();
  await expect(dayItem).toBeVisible({ timeout: 20_000 });
  const outText = await dayItem
    .getByTestId('cal-posted-out')
    .locator('span.tabular-nums')
    .innerText();
  const calendarOut = Math.abs(parseCents(outText));
  expect(calendarOut).toBeGreaterThan(0);

  // Follow the day's OWN link and compare the register's painted summary against the
  // calendar's painted figures — the K.1 gate at the shipped seam.
  const link = dayItem.getByTestId('cal-posted-day-link').first();
  const href = await link.getAttribute('href');
  expect(href).toMatch(/\/transactions\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}/);
  await link.click();
  await page.waitForURL('**/transactions**');
  const registerOut = Math.abs(parseCents(await page.getByTestId('summary-out').innerText()));
  expect(registerOut).toBe(calendarOut);
});

test('the current month separates posted fact from scheduled projection', async ({ page }) => {
  await signInDemo(page);
  await page.goto('/calendar');
  await expect(page.getByTestId('cal-month')).toHaveAttribute('data-month', '2026-06', {
    timeout: 20_000,
  });
  // Both header lines, never one sentence: fact through today, projection ahead. The demo seed
  // holds three PENDING rows at its pinned today, so the header must NAME them (critic F-1) —
  // "Posted + pending through …" — never claim "posted" alone over money that hasn't.
  await expect(page.getByTestId('cal-posted-line')).toContainText('Posted + pending through');
  await expect(page.getByTestId('cal-posted-line')).toContainText('pending');
  await expect(page.getByTestId('cal-scheduled-line')).toContainText('Expected');
  // The forward half must not read like data: a scheduled flow event is badged.
  await expect(
    page.getByTestId('calendar-list').getByText('scheduled', { exact: true }).first(),
  ).toBeVisible({ timeout: 20_000 });
});

test('a month before the corpus names WHICH zero — the history floor, not "no activity"', async ({
  page,
}) => {
  await signInDemo(page);
  await page.goto(`/calendar?month=${PREHISTORIC_MONTH}`);
  await expect(page.getByTestId('cal-month')).toHaveAttribute('data-month', PREHISTORIC_MONTH, {
    timeout: 20_000,
  });
  const empty = page.getByTestId('cal-empty');
  await expect(empty).toBeVisible({ timeout: 20_000 });
  await expect(empty).toContainText('history starts');
});
