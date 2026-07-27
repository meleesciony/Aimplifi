/**
 * Guided first-run connect flow (Competitive-Gap Gap 3 §3): connect → see an
 * instant best-guess Cash-Needed number (Step 2) → confirm the payment
 * account to lock it in (Step 3) — numbered to match the app's actual
 * top-to-bottom reveal, not the plan doc's prose order (see step-indicator.tsx
 * for why). Live SimpleFIN/Plaid network paths need real credentials and stay
 * UNVERIFIED in this environment (same stance as docs/SIMPLEFIN_WALKTHROUGH.md
 * / docs/PLAID_WALKTHROUGH.md and the #171 connection-health precedent), so
 * this proves the STRUCTURAL wiring — that Step 1's connect widgets are
 * inlined with zero navigation, and that Steps 2/3 appear together AND IN
 * VISUAL ORDER the instant an account exists — via the deterministic
 * manual-account path. That "zero navigation between having an account and
 * seeing the number" is the PHASES.md <10s benchmark expressed structurally,
 * not as a stopwatch assertion.
 */
import { expect, test } from './helpers/test';

test('signup → Step 1 inlined connect → manual account → Steps 2/3 together → confirm → flow complete', async ({
  page,
}) => {
  const email = `e2e-onboard-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  const password = 'e2e-password-123';

  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill(password);
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20000 });

  // Step 1: the SimpleFIN token walkthrough and the Plaid button are INLINED on
  // the welcome screen — no navigation needed to reach either.
  await expect(page.getByTestId('empty-dashboard')).toBeVisible();
  await expect(page.getByTestId('onboarding-step-1')).toContainText('Step 1 of 3');
  await expect(page.getByTestId('simplefin-connect-btn')).toBeVisible();
  await expect(page.getByTestId('connect-bank-btn')).toBeVisible();
  await page.getByTestId('simplefin-connect-btn').click();
  await expect(page.getByTestId('simplefin-form')).toBeVisible();
  await expect(page.getByTestId('simplefin-form')).toContainText('setup token');

  // No live bank credentials in this environment — take the deterministic,
  // network-free manual-account path via the secondary "Add manually" link.
  await page.getByTestId('onboard-manual').click();
  await page.waitForURL('**/accounts');
  await page.getByTestId('add-asset-btn').click();
  await page.getByTestId('manual-name').fill('Guided Checking');
  await page.getByTestId('manual-value').fill('2500');
  // manual-type defaults to CHECKING (lib/engine/networth/manual.ts) — eligible
  // as a payment account, which is exactly what this flow needs to reach Step 2.
  await page.getByTestId('manual-submit').click();
  await expect(page.getByTestId('manual-account-row')).toBeVisible({ timeout: 20000 });

  // Steps 2 and 3 appear TOGETHER, on first load, zero clicks apart — the
  // instant an account exists, both the Cash-Needed card and the
  // payment-account nudge render on the same screen, AND in that numeric
  // order top-to-bottom (hostile-critic P1: an earlier version numbered the
  // card "3" above a "Step 2" nudge below it, reading backwards).
  await page.goto('/dashboard');
  await expect(page.getByTestId('empty-dashboard')).toHaveCount(0);
  await expect(page.getByTestId('onboarding-step-2')).toContainText('Step 2 of 3');
  await expect(page.getByTestId('cash-needed-card')).toBeVisible();
  await expect(page.getByTestId('onboarding-step-3')).toContainText('Step 3 of 3');
  await expect(page.getByTestId('onboarding-nudge')).toBeVisible();
  const step2Box = await page.getByTestId('onboarding-step-2').boundingBox();
  const step3Box = await page.getByTestId('onboarding-step-3').boundingBox();
  expect(step2Box, 'Step 2 badge must be present and visible').not.toBeNull();
  expect(step3Box, 'Step 3 badge must be present and visible').not.toBeNull();
  expect(step2Box!.y, 'Step 2 must render ABOVE Step 3, not after it').toBeLessThan(step3Box!.y);

  // Confirm the payment account (Step 3) on /settings.
  await page.getByTestId('onboarding-nudge-cta').click();
  await page.waitForURL('**/settings');
  await page.getByTestId('dials-payment-account').selectOption({ label: 'Guided Checking' });
  await page.getByTestId('dials-submit').click();
  await expect(page.getByTestId('dials-saved')).toBeVisible({ timeout: 20000 });

  // Back on the dashboard: the guided flow is complete — no more step badges
  // or nudge, but the Cash-Needed card (now grounded in the confirmed account)
  // remains. This account has no card statements, so "nothing due" is the
  // correct, honest answer — a real state the engine renders on purpose, not
  // a placeholder (cash-needed-card.tsx's headline.byDate === null branch).
  await page.goto('/dashboard');
  await expect(page.getByTestId('onboarding-nudge')).toHaveCount(0);
  await expect(page.getByTestId('onboarding-step-2')).toHaveCount(0);
  await expect(page.getByTestId('onboarding-step-3')).toHaveCount(0);
  await expect(page.getByTestId('cash-needed-card')).toBeVisible();
  await expect(page.getByTestId('cash-needed-card')).toContainText('nothing due');
});
