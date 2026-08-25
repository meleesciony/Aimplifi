/**
 * Expected-net-worth lens on /dashboard (DECISIONS #518).
 * Demo has income and net worth, no stored age — idle is the anti-vacuous marker.
 * /accounts is not the host: getCoachData throws with zero accounts, and that
 * page is the first-run add-asset surface.
 */
import { expect, test } from './helpers/test';

test('Dashboard: expected-NW lens starts idle and compares after an age is set', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
  await expect(page.getByTestId('net-worth-card')).toBeVisible();
  await expect(page.getByTestId('paw-lens-card')).toBeVisible();
  const idle = page.getByTestId('paw-lens-idle');
  await expect(idle).toContainText('age × yearly income ÷ 10');
  await expect(idle).toContainText('not a grade');
  await expect(idle).toContainText('same income the FI card uses');
  await expect(idle).not.toContainText('PAW');
  await expect(idle).not.toContainText('UAW');
  await expect(page.getByTestId('paw-lens-slider')).toBeVisible();
  await expect(page.getByTestId('paw-lens-empty')).toHaveCount(0);

  await page.getByTestId('paw-lens-slider').fill('40');
  const sentence = page.getByTestId('paw-lens-sentence');
  await expect(sentence).toContainText('age 40');
  await expect(sentence).toContainText('not a grade');
  await expect(sentence).toContainText('$144,804.74');
  await expect(sentence).not.toContainText('PAW');
  await expect(sentence).not.toContainText('below');
});
