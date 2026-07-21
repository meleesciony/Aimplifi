/**
 * AI Trust Center & Audit Ledger (AI plan §3.2, DECISIONS #242; 380×800 viewport).
 *
 * Demo flow: Settings → "Open the AI Trust Center" → /trust. In demo the page
 * must show (1) the narrowed headline invariant, (2) the measured scorecard
 * (real engine output, sample size inline), (3) the closed touchpoint table,
 * and (4) an HONESTLY-EMPTY ledger with the shared-demo disclosure — the demo
 * account records no AI trail by construction. Pure navigation (one sign-in,
 * then GETs) — not subject to the environmental action-apply stall.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { AI_TOUCHPOINTS } from '@/lib/engine/ai-audit/describe';

test('demo Trust Center: headline invariant, scorecard, touchpoints, honestly-empty ledger', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');

  // Reached from Settings — no new nav icon.
  await page.goto('/settings');
  await page.getByTestId('trust-center-link').getByRole('link').click();
  await page.waitForURL('**/trust');
  await expect(page).toHaveTitle('AI Trust Center · Aimplifi');

  // (1) The narrowed §3.2 headline invariant, exactly.
  const headline = page.getByTestId('trust-headline');
  await expect(headline).toContainText('Dollar figures the AI has authored: 0');
  // The confidence disclosure keeps the claim honest (the one AI-originated number).
  await expect(page.getByTestId('trust-confidence-disclosure')).toContainText('confidence');

  // (2) Scorecard renders real engine output with its sample size inline
  // (either a measured % with "N of M labeled transactions" or the honest empty state).
  const scorecard = page.getByTestId('trust-scorecard');
  await expect(scorecard.getByTestId('accuracy-value')).toBeVisible();

  // (3) Every touchpoint renders, each with its May/Never limits and its measured
  // all-time count — which in the trail-less demo is honestly "not asked". Count
  // is derived from the source-of-truth array so a new touchpoint can't leave this
  // assertion stale (Fable critic P2-1 — the literal was already stale-red at HEAD).
  const touchpoints = page.getByTestId('trust-touchpoints');
  await expect(touchpoints.getByRole('listitem')).toHaveCount(AI_TOUCHPOINTS.length);
  await expect(touchpoints).toContainText('Transaction categorization');
  await expect(touchpoints).toContainText('Never:');
  await expect(page.getByTestId('trust-touchpoint-count-categorize')).toContainText(
    'Not asked about your data yet.',
  );

  // (4) Demo ledger is honestly empty with the shared-account disclosure —
  // and no summary chips pretend there were events.
  const ledger = page.getByTestId('trust-ledger');
  await expect(ledger.getByTestId('trust-ledger-empty')).toContainText('shared by every visitor');
  await expect(ledger.getByTestId('trust-ledger-summary')).toHaveCount(0);

  // Accessible: WCAG A + AA clean.
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(axe.violations).toEqual([]);
});
