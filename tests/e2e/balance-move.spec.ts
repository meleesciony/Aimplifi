/**
 * Balance-Move Explainer (AI plan §2.3, DECISIONS #240): the /trends "What changed"
 * section leads with a grounded, descriptive one-liner. In demo (no LLM key) it is
 * the DETERMINISTIC template — never an "AI-worded" interpretation — and every
 * money figure it names must also appear in the movers list (it cannot drift).
 */
import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

const BANNED = /\b(because|due to|driven by|wasted|splurge|doubled|tripled|surged|skyrocket|most of)\b/i;

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
}

test('trends leads with a grounded, deterministic balance-move explainer', async ({ page }) => {
  await signIn(page);
  await page.goto('/trends');

  const explainer = page.getByTestId('balance-move-explainer');
  await expect(explainer).toBeVisible();

  // Demo has no LLM key → the sentence is the deterministic template, NOT an AI rewording.
  await expect(page.getByTestId('balance-move-interpreted')).toHaveCount(0);

  // Descriptive, not causal or shaming.
  const text = (await explainer.textContent())?.trim() ?? '';
  expect(text.length).toBeGreaterThan(0);
  expect(text).not.toMatch(BANNED);

  // Grounding: the money figure the explainer names must also be a mover figure on
  // the same page — the explainer reshapes the engine, it cannot originate a number.
  const money = text.match(/\$[\d,]+\.\d{2}/);
  expect(money, `explainer had no money figure: "${text}"`).not.toBeNull();
  await expect(page.getByTestId('trends-movers')).toContainText(money![0]);
});

test('the balance-move explainer keeps the page WCAG 2.1 AA clean', async ({ page }) => {
  await signIn(page);
  await page.goto('/trends');
  await expect(page.getByTestId('balance-move-explainer')).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations, JSON.stringify(results.violations.map((v) => v.id))).toEqual([]);
});
