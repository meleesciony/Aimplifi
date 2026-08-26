/**
 * Idle-cash lens on /dashboard (DECISIONS #519).
 * Demo has checking + savings and a runway expense average — idle or
 * surplus is pinned by the coach unit, but the card must name the
 * 6-month cushion and refuse a nudge. /accounts is not the host.
 */
import { expect, test } from './helpers/test';

test('Dashboard: idle-cash note names the 6-month cushion and does not nudge', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
  await expect(page.getByTestId('net-worth-card')).toBeVisible();
  const card = page.getByTestId('idle-cash-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Cash vs a 6-month cushion');
  await expect(page.getByTestId('idle-cash-idle')).toBeVisible();
  await expect(page.getByTestId('idle-cash-idle')).toContainText('never moves money');
  await expect(page.getByTestId('idle-cash-idle')).toContainText(/not a recommendation/i);
  await expect(page.getByTestId('idle-cash-idle')).toContainText('same expense average the runway figure uses');
  await expect(page.getByTestId('idle-cash-idle')).not.toContainText('this card');
  await expect(page.getByTestId('idle-cash-idle')).not.toContainText('you should');
  await expect(page.getByTestId('idle-cash-idle')).not.toContainText('high-yield');
  await expect(page.getByTestId('idle-cash-empty')).toHaveCount(0);
  await expect(page.getByTestId('idle-cash-sentence')).toHaveCount(0);
});
