/**
 * Phase 2 golden flow at 380×800 — the mobile triage inbox.
 *
 * HUMAN-TIME BUDGET (documented mapping for the "<60 seconds" target, since CI
 * wall-clock ≠ human time): each logged interaction is one thumb action with a
 * decision glance:
 *   swipe  = 1.2s motion + 2.5s glance = 3.7s
 *   tap    = 1.5s motion + 2.5s glance = 4.0s
 * A session of N interactions costs ≤ N × 4.0s. The acceptance targets are
 * <15 interactions and <60 seconds — 15 × 4.0 = 60, so interactions < 15
 * implies the time budget holds. Both are asserted with the emitted log.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

async function signInToTriage(page: Page) {
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
  await page.getByTestId('bottom-nav-triage').click();
  await page.waitForURL('**/triage');
}

async function interactionLog(page: Page) {
  return page.evaluate(() => window.__triageLog ?? []);
}

test('gestures: swipe right accepts, swipe left reveals 3 alternatives, long-press opens split — all undoable', async ({ page }) => {
  await signInToTriage(page);
  const card = page.getByTestId('triage-card');
  await expect(card).toBeVisible();
  const before = Number(await page.getByTestId('triage-inbox').getAttribute('data-remaining'));
  expect(before).toBeGreaterThan(0);

  // swipe RIGHT (mouse-driven pointer events) → accepts the suggestion.
  // Top item is a Zelle payment — an AGGREGATE merchant, so the durable-rule
  // prompt must NOT be offered (one "Always" would mis-file all future Zelle).
  const box = (await card.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 140, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId('triage-inbox')).toHaveAttribute('data-remaining', String(before - 1));
  await expect(page.getByTestId('rule-prompt')).toHaveCount(0);

  // swipe LEFT on the next card (Store Card — a real merchant) → 3 alternatives
  const box2 = (await card.boundingBox())!;
  await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
  await page.mouse.down();
  await page.mouse.move(box2.x + box2.width / 2 - 140, box2.y + box2.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId('triage-alternatives')).toBeVisible();
  await expect(page.getByTestId('triage-alternatives').locator('button')).toHaveCount(3);
  await page.getByTestId('triage-alternatives').locator('button').first().click();

  // the one-tap durable rule IS offered for a real merchant, with an explanation
  await expect(page.getByTestId('rule-prompt')).toBeVisible();
  await expect(page.getByTestId('rule-prompt')).toContainText('skip review');
  await expect(page.getByTestId('rule-always')).toBeVisible();
  await page.getByTestId('rule-once').click();
  const box3 = (await card.boundingBox())!;
  await page.mouse.move(box3.x + box3.width / 2, box3.y + box3.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
  await expect(page.getByTestId('triage-split')).toBeVisible();
  await page.getByTestId('split-amount').fill('5');
  await page.getByTestId('split-confirm').click();
  await expect(page.getByTestId('triage-inbox')).toHaveAttribute('data-remaining', String(before - 3));

  // universal undo: three undos restore all three actions (no reload needed)
  for (let i = 3; i >= 1; i--) {
    await page.getByTestId('triage-undo').click();
    await expect(page.getByTestId('triage-inbox')).toHaveAttribute(
      'data-remaining',
      String(before - i + 1),
    );
  }
});

test('write-in category: create + file in one step, joins pickers, errors stay inline (#136)', async ({ page }) => {
  await signInToTriage(page);
  const catName = `Golf ${Date.now().toString().slice(-6)}`; // unique per run (retry-safe)
  const inbox = page.getByTestId('triage-inbox');
  const before = Number(await inbox.getAttribute('data-remaining'));
  expect(before).toBeGreaterThan(1);

  // ── Lock (critic P1): a half-typed write-in form must NOT survive when the
  // top card changes without advance() (batchApply/undoLast paths). Accept a
  // card, open the form on the next one and type into it, then UNDO — reopening
  // alternatives on the restored card must show the button, not a stale form
  // carrying the previous card's group prefill.
  await page.getByTestId('triage-accept').click();
  await expect(inbox).toHaveAttribute('data-remaining', String(before - 1));
  if (await page.getByTestId('rule-once').isVisible().catch(() => false)) {
    await page.getByTestId('rule-once').click();
  }
  await page.getByTestId('triage-more').click();
  await expect(page.getByTestId('triage-alternatives')).toBeVisible();
  await expect(page.getByTestId('triage-alternatives').locator('button')).toHaveCount(3);
  await page.getByTestId('triage-add-category').click();
  await page.getByTestId('new-category-name').fill('Stale draft');
  await page.getByTestId('triage-undo').click();
  await expect(inbox).toHaveAttribute('data-remaining', String(before));
  await page.getByTestId('triage-more').click();
  await expect(page.getByTestId('triage-new-category')).toHaveCount(0); // form closed
  await expect(page.getByTestId('triage-add-category')).toBeVisible();
  const afterBatch = before; // queue fully restored by the undo

  // Open the write-in mini-form; the group select is prefilled (spending groups
  // only) and the whole page stays WCAG A/AA clean with the form open.
  await page.getByTestId('triage-add-category').click();
  await expect(page.getByTestId('triage-new-category')).toBeVisible();
  await expect(page.getByTestId('new-category-group')).not.toHaveValue('');
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(axe.violations).toEqual([]);

  // Create & file — the card advances by exactly one, and (rule-eligible
  // merchant) the durable-rule prompt names the CUSTOM category.
  await page.getByTestId('new-category-name').fill(catName);
  await page.getByTestId('new-category-submit').click();
  await expect(inbox).toHaveAttribute('data-remaining', String(afterBatch - 1));
  if (await page.getByTestId('rule-once').isVisible().catch(() => false)) {
    await expect(page.getByTestId('rule-prompt')).toContainText(catName);
    await page.getByTestId('rule-once').click();
  }

  // The fresh category is assignable on the NEXT card without a reload…
  await page.getByTestId('triage-more').click();
  await expect(
    page.getByTestId('triage-all-categories').locator('option', { hasText: catName }),
  ).toHaveCount(1);

  // ── Lock (critic P1): a REJECTED create action (network failure) degrades to
  // the inline error — never the route error boundary. Abort the next action POST.
  let abortedOnce = false;
  await page.route('**/triage*', async (route) => {
    if (!abortedOnce && route.request().method() === 'POST') {
      abortedOnce = true;
      await route.abort('connectionfailed');
    } else {
      await route.continue();
    }
  });
  await page.getByTestId('triage-add-category').click();
  await page.getByTestId('new-category-name').fill(`${catName} B`);
  await page.getByTestId('new-category-submit').click();
  await expect(page.getByTestId('new-category-error')).toBeVisible();
  await expect(inbox).toBeVisible(); // the island survived — no error boundary
  await page.unroute('**/triage*');

  // …and a duplicate name errors INLINE, filing nothing (queue count unchanged).
  await page.getByTestId('new-category-name').fill(catName);
  await page.getByTestId('new-category-submit').click();
  await expect(page.getByTestId('new-category-error')).toBeVisible();
  await expect(inbox).toHaveAttribute('data-remaining', String(afterBatch - 1));

  // Persistence: a full server re-render (fresh getVisibleCategories) must offer
  // the category — proves the DB row, not the client-side overlay.
  await page.reload();
  await expect(inbox).toHaveAttribute('data-remaining', String(afterBatch - 1));
  await page.getByTestId('triage-more').click();
  await expect(
    page.getByTestId('triage-all-categories').locator('option', { hasText: catName }),
  ).toHaveCount(1);
});

test('a full review session completes in <15 interactions (→ <60s human time)', async ({ page }) => {
  await signInToTriage(page);
  await page.evaluate(() => {
    window.__triageLog = [{ type: 'tap', detail: 'nav → Review', at: 1 }];
  });

  // Clear the whole queue thumb-style: batch when offered, otherwise accept.
  for (let guard = 0; guard < 20; guard++) {
    if (await page.getByTestId('triage-empty').isVisible().catch(() => false)) break;
    // dismiss rule prompt only when it covers the batch button — otherwise ignore
    if (await page.getByTestId('triage-batch').isVisible().catch(() => false)) {
      await page.getByTestId('triage-batch').click();
    } else {
      await page.getByTestId('triage-accept').click();
      // take the one-tap durable rule once, to prove the flow (counts as a tap)
      if (guard === 0 && (await page.getByTestId('rule-always').isVisible().catch(() => false))) {
        await page.getByTestId('rule-always').click();
      }
    }
    await page.waitForTimeout(150);
  }

  await expect(page.getByTestId('triage-empty')).toBeVisible();

  const log = await interactionLog(page);
  console.log('=== TRIAGE INTERACTION LOG (evidence for <15 / <60s) ===');
  for (const entry of log) console.log(`  ${entry.at}. [${entry.type}] ${entry.detail}`);
  const seconds = log.reduce((s, e) => s + (e.type === 'swipe' ? 3.7 : 4.0), 0);
  console.log(`  interactions=${log.length}  human-time≈${seconds.toFixed(1)}s (budget: tap 4.0s, swipe 3.7s)`);

  expect(log.length).toBeLessThan(15);
  expect(seconds).toBeLessThan(60);

  // the dashboard badge is gone — feed fully reviewed
  await page.goto('/dashboard');
  await expect(page.getByTestId('review-badge')).toHaveCount(0);
});

test('categorization accuracy card shows a measured value (DECISIONS #37)', async ({ page }) => {
  await signInToTriage(page);
  const card = page.getByTestId('accuracy-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Categorization accuracy');
  // seeded known-merchant labels guarantee a measured percentage (n > 0)
  await expect(page.getByTestId('accuracy-value')).toContainText('%');
});

