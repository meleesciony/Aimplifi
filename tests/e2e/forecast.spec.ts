/**
 * Cash-flow forecast (DECISIONS #72): discoverable from the cash-needed card,
 * then a 90-day projected balance line with milestones and the lowest-point
 * read — all from the seed's scheduled flows, zero credentials.
 */
import { type Page, expect, test } from './helpers/test';

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
}

test('forecast is linked from the cash-needed card', async ({ page }) => {
  await signIn(page);
  await expect(page.getByTestId('see-forecast')).toBeVisible();
});

test('forecast view projects the balance with chart, milestones, and lowest point', async ({ page }) => {
  await signIn(page);
  await page.goto('/forecast');

  await expect(page.getByTestId('forecast-hero')).toBeVisible();
  await expect(page.getByTestId('forecast-projected')).toContainText('$');
  await expect(page.getByTestId('forecast-chart')).toBeVisible();
  await expect(page.getByTestId('forecast-milestones')).toBeVisible();
  await expect(page.getByTestId('forecast-lowest')).toBeVisible();

  // Anchored on the seed's Everyday Checking starting balance.
  await expect(page.getByTestId('forecast-hero')).toContainText('$3,400.00');
  await expect(page.getByTestId('forecast-hero')).toContainText('Everyday Checking');

  // #134: the auto-loan payment ($385/mo, due day 5) now appears in the projection — it was
  // invisible before (represented only as a loan-due obligation on the calendar/reminders, not a
  // checking scheduled row). Locks the balance projection agreeing with those surfaces.
  await expect(page.getByTestId('forecast-upcoming')).toContainText('Auto Loan');
});

test('C.12: the card-payment omission caveat lands BEFORE the first figure it qualifies', async ({ page }) => {
  // P1-18: the note used to sit three screens below the hero — after every figure it
  // qualifies. The placement rule its siblings enforce: the reader meets the caveat
  // before the figure. DOM-order lock, not a screenshot.
  await signIn(page);
  await page.goto('/forecast');

  const note = page.getByTestId('forecast-scope-note');
  await expect(note).toBeVisible();
  await expect(note).toContainText('include card payments');
  const noteBeforeFigure = await page.evaluate(() => {
    const n = document.querySelector('[data-testid="forecast-scope-note"]');
    const f = document.querySelector('[data-testid="forecast-projected"]');
    return (
      n !== null &&
      f !== null &&
      (n.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    );
  });
  expect(noteBeforeFigure).toBe(true);
});
