/**
 * Ask Aimplifi (DECISIONS #75): a grounded NL assistant discoverable from a
 * dashboard card, answering questions about the user's own seed data with zero
 * credentials (deterministic routing + tested engines, no LLM key). Pins real
 * seed values (net worth $144,804.74; biggest June purchase Costco $158.44) and
 * runs a WCAG-AA axe scan on the answered page.
 */
import { execSync } from 'node:child_process';
import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from './helpers/test';
import { E2E_DB_URL } from '../setup/test-db';

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
}

async function ask(page: Page, question: string) {
  await page.getByTestId('ask-input').fill(question);
  await page.getByTestId('ask-submit').click();
  await expect(page.getByTestId('ask-answer')).toBeVisible();
}

test('Ask is reachable from the app nav (Home no longer stacks the Ask card)', async ({ page }) => {
  await signIn(page);
  // Owner 2026-08-01: Ask moved off the Home stack to cut clutter; the route stays first-class.
  await page.goto('/ask');
  await expect(page.getByTestId('ask-input')).toBeVisible();
});

test('answers a suggestion chip', async ({ page }) => {
  await signIn(page);
  await page.goto('/ask');
  await page.getByTestId('ask-suggestion').filter({ hasText: 'net worth' }).first().click();
  await expect(page.getByTestId('ask-answer')).toBeVisible();
  await expect(page.getByTestId('ask-headline')).toContainText('$144,804.74');
});

test('shows contextual follow-up chips after a spend answer and re-asks on click', async ({
  page,
}) => {
  await signIn(page);
  await page.goto('/ask');
  // "this month" = June 2026 on the demo clock — biggest purchase is the #249
  // engineered Blue Bottle anomaly ($214.36), the same charge the Unusual Charge
  // Radar flags (Ask and the radar agree by construction).
  await ask(page, 'How much did I spend on groceries this month?');
  const chips = page.getByTestId('ask-follow-up');
  await expect(chips).toHaveCount(3);
  await chips.filter({ hasText: /biggest purchase/i }).click();
  await expect(page.getByTestId('ask-answer')).toBeVisible();
  await expect(page.getByTestId('ask-headline')).toContainText('Blue Bottle Coffee');
});

test('answers typed questions grounded in the seed', async ({ page }) => {
  await signIn(page);
  await page.goto('/ask');

  await ask(page, 'What is my net worth?');
  await expect(page.getByTestId('ask-headline')).toContainText('Your net worth is $144,804.74.');

  await ask(page, 'What was my biggest purchase this month?');
  // #249: the engineered Blue Bottle anomaly ($214.36 on 2026-06-02) is June's biggest.
  await expect(page.getByTestId('ask-headline')).toContainText('Blue Bottle Coffee');
  await expect(page.getByTestId('ask-headline')).toContainText('$214.36');

  // #168 per-merchant spend: "at Costco" sums that merchant's purchases (the seed
  // has June Costco spend, so a real figure — grounded to /transactions activity).
  await ask(page, 'How much did I spend at Costco this month?');
  await expect(page.getByTestId('ask-headline')).toContainText(/You spent \$[\d,]+\.\d{2} at Costco this month\./);
  await expect(page.getByTestId('ask-source')).toHaveAttribute('href', '/transactions');

  // O.10a: "at Costco Gas" is a different store — must NOT print Costco's dollars
  // or the warehouse name. Demo seed /trends Costco Gas = $37.38; the pre-fix
  // Ask path answered $195.82 at Costco (warehouse rows swept in).
  await ask(page, 'How much did I spend at Costco Gas this month?');
  await expect(page.getByTestId('ask-headline')).toContainText('You spent $37.38 at Costco Gas this month.');
  await expect(page.getByTestId('ask-headline')).not.toContainText('$195.82');
  await expect(page.getByTestId('ask-headline')).not.toContainText('at Costco this month');

  // O.7: Costco is refund-free and fully POSTED, so it reads the same on either
  // basis — an e2e critic proved this whole block passes under a full revert.
  // Blue Bottle is the demo merchant that actually moves, and it is reachable:
  // it holds a seeded PENDING −$6.75 (build.ts:540), so the pre-O.7 POSTED-only
  // rule answered $239.38 where the register and /reports both count $246.13.
  // O.10a: ask the exact canonical ("Blue Bottle Coffee") — a truncated
  // "Blue Bottle" no longer prefix-matches. (Note "at Amazon" does NOT reach
  // this intent — `resolveSpendTarget` runs first and the deliberate
  // Amazon→shopping synonym routes it to a category answer, #168. The
  // engine-level Amazon case is locked in the unit suite.)
  // The figure and its pending disclosure are asserted together — counting
  // unsettled money is only honest if the answer says so.
  await ask(page, 'How much did I spend at Blue Bottle Coffee this month?');
  await expect(page.getByTestId('ask-headline')).toContainText('You spent $246.13 at Blue Bottle Coffee this month.');
  await expect(page.getByTestId('ask-answer')).toContainText('Includes $6.75 still pending.');

  // …and a pseudo-merchant is refused rather than totalled: both O.7 critics
  // independently caught "You spent $49.27 at ATM Withdrawal this month" here.
  // O.10a: exact canonical — "ATM" alone no longer prefix-matches.
  await ask(page, 'How much did I spend at ATM Withdrawal this month?');
  await expect(page.getByTestId('ask-headline')).toContainText("isn't a single store");
  await expect(page.getByTestId('ask-headline')).not.toContainText('You spent');

  await ask(page, 'How much can I safely spend this month?');
  await expect(page.getByTestId('ask-headline')).toContainText(/guilt-free allocation|over your plan/);
  await expect(page.getByTestId('ask-source')).toBeVisible();

  // savings_rate delegates to the Coach read-path (same value as /coach)
  await ask(page, "What's my savings rate?");
  await expect(page.getByTestId('ask-headline')).toContainText(/savings rate was .*%|full month of income/);
});

test('What should I cut agrees with Coach opportunities (P.1)', async ({ page }) => {
  await signIn(page);
  await page.goto('/ask');
  await ask(page, 'What should I cut?');
  await expect(page.getByTestId('ask-headline')).toContainText('LA Fitness');
  await expect(page.getByTestId('ask-headline')).toContainText('$34.99');
  await expect(page.getByTestId('ask-headline')).not.toContainText(/FI date|years to FI|weeks sooner/i);
  await expect(page.getByTestId('ask-source')).toHaveAttribute('href', '/coach');
});

test('Is my lifestyle creeping agrees with Coach creep card', async ({ page }) => {
  await signIn(page);
  await page.goto('/coach');
  const title = ((await page.getByTestId('creep-title').textContent()) ?? '').trim();
  const verdict = ((await page.getByTestId('creep-verdict').textContent()) ?? '').trim();
  expect(title, 'Coach creep title').not.toBe('');
  expect(verdict, 'Coach creep verdict').not.toBe('');

  await page.goto('/ask');
  await ask(page, 'Is my lifestyle creeping?');
  await expect(page.getByTestId('ask-headline')).toHaveText(title);
  await expect(page.getByTestId('ask-answer')).toContainText(verdict);
  await expect(page.getByTestId('ask-answer')).not.toContainText(/this card/i);
  await expect(page.getByTestId('ask-source')).toHaveAttribute('href', '/coach');
});

test('When can I retire agrees with Coach FI card', async ({ page }) => {
  await signIn(page);
  await page.goto('/coach');
  const fiNumber = (await page.getByTestId('fi-number').textContent()) ?? '';
  const yearsLine = (await page.getByTestId('years-to-fi').textContent()) ?? '';
  const span = yearsLine.match(/in about \d+ years(?: \d+ months)?/);
  expect(fiNumber, 'Coach FI number').toMatch(/\$[\d,]+\.\d{2}/);
  expect(span, 'Coach years-to-FI span').toBeTruthy();

  await page.goto('/ask');
  await ask(page, 'When can I retire?');
  await expect(page.getByTestId('ask-headline')).toContainText(span![0]);
  await expect(page.getByTestId('ask-answer')).toContainText(fiNumber.trim());
  await expect(page.getByTestId('ask-answer')).not.toContainText(/this card/i);
  await expect(page.getByTestId('ask-source')).toHaveAttribute('href', '/coach');
});

test('year windows and merchant-scoped largest answer honestly (TASKS 2.7)', async ({ page }) => {
  await signIn(page);
  await page.goto('/ask');

  // A bare-year window is that calendar year, not a silent this-month figure.
  await ask(page, 'How much did I spend in 2025?');
  await expect(page.getByTestId('ask-headline')).toContainText(/(You spent \$[\d,]+\.\d{2} in 2025\.|No spending recorded in 2025\.)/);

  // Merchant-scoped largest: the seed's biggest June purchase IS Costco $158.44,
  // so the scoped answer must find the same row the global ranking pins.
  await ask(page, 'What was my biggest purchase at Costco this month?');
  await expect(page.getByTestId('ask-headline')).toContainText('Your biggest purchase at Costco this month was $158.44.');

  // The follow-up window swap CARRIES the merchant scope — never the global biggest.
  await ask(page, 'what about last month?');
  await expect(page.getByTestId('ask-headline')).toContainText(/at Costco last month/);

  // A window the parser cannot represent gets the honest redirect, never a
  // different-window figure (pre-2.7 this answered the THIS-MONTH groceries total).
  await ask(page, 'How much did I spend on groceries in 2027?');
  await expect(page.getByTestId('ask-headline')).not.toContainText('You spent');
});

test('Glass-Box: a row-sum figure is tappable and reconciles to its rows (slice 2)', async ({ page }) => {
  // GLASSBOX_PLAN slice 2: tap the number in an Ask answer → the exact transaction
  // rows behind it, reconciled to the penny. spend_total is the richest case — a
  // guaranteed-non-zero June total that reconciles hierarchically (total → per-
  // category groups → rows), so it exercises the grouped panel end-to-end.
  await signIn(page);
  await page.goto('/ask');
  await ask(page, 'How much did I spend this month?');

  const headline = page.getByTestId('ask-headline');
  // A row-sum headline is a disclosure control, collapsed by default — the panel
  // is not in the DOM until the user taps.
  await expect(headline).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('ask-trace')).toHaveCount(0);

  // The exact figure the answer shows; the panel must reconcile to THIS number.
  const amount = ((await headline.textContent()) ?? '').match(/\$[\d,]+\.\d{2}/)?.[0];
  expect(amount).toBeTruthy();

  await headline.click();
  await expect(headline).toHaveAttribute('aria-expanded', 'true');
  const trace = page.getByTestId('ask-trace');
  await expect(trace).toBeVisible();
  // The reconciliation line states the rows' sum — and it equals the headline figure.
  await expect(page.getByTestId('ask-trace-reconciled')).toContainText(amount!);
  // Hierarchical: at least one per-category group, each with its cited rows.
  await expect(page.getByTestId('ask-trace-group').first()).toBeVisible();
  await expect(page.getByTestId('ask-trace-row').first()).toBeVisible();

  // The answered page — trace panel OPEN — still passes WCAG 2.1 AA.
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations, JSON.stringify(results.violations.map((v) => v.id))).toEqual([]);
});

test('Glass-Box: top-categories traces ONLY the top category, not the whole period (slice-2 P1-1)', async ({ page }) => {
  // The headline figure is the TOP category's amount; the panel must reconcile to
  // THAT — never green-check a count/sum folded across the other listed categories.
  // Post-fix that means the panel shows the flat top-category rows with NO group
  // sub-headers (groups are only shown when they sum to the tapped figure).
  await signIn(page);
  await page.goto('/ask');
  await ask(page, 'What are my top spending categories this month?');

  const headline = page.getByTestId('ask-headline');
  await expect(headline).toHaveAttribute('aria-expanded', 'false');
  const amount = ((await headline.textContent()) ?? '').match(/\$[\d,]+\.\d{2}/)?.[0];
  expect(amount).toBeTruthy();

  await headline.click();
  await expect(page.getByTestId('ask-trace')).toBeVisible();
  // Reconciles to the headline (top category), and shows no cross-category groups.
  await expect(page.getByTestId('ask-trace-reconciled')).toContainText(amount!);
  await expect(page.getByTestId('ask-trace-group')).toHaveCount(0);
  await expect(page.getByTestId('ask-trace-row').first()).toBeVisible();
});

/** "$1,234.56" / "−$1,234.56" → signed integer cents (DOM re-computation helper). */
const centsOf = (t: string) => Number(t.replace(/[^0-9]/g, '')) * (/^[−-]/.test(t.trim()) ? -1 : 1);

test('Glass-Box 3: net worth is tappable — the formula panel shows assets − liabilities = the headline', async ({ page }) => {
  // GLASSBOX_PLAN slice 3: derivation figures get a "formula + inputs" panel, not
  // a fake row-sum. Net worth = assets − liabilities; we re-run the subtraction
  // off the DOM's own subtotals and it must land on the tapped headline figure.
  await signIn(page);
  await page.goto('/ask');
  await ask(page, 'What is my net worth?');

  const headline = page.getByTestId('ask-headline');
  await expect(headline).toContainText('$144,804.74');
  // Now a disclosure control (slice 3 superseded the slice-2 "stays a plain <p>"
  // pin — the tap is honored by a derivation trace), collapsed by default.
  await expect(headline).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('ask-trace')).toHaveCount(0);

  await headline.click();
  await expect(page.getByTestId('ask-trace')).toBeVisible();
  await expect(page.getByTestId('ask-deriv-row').first()).toBeVisible(); // per-account lines

  // The formula re-run off the DOM: own − owe = the tapped number, to the penny.
  const owned = centsOf((await page.getByTestId('ask-deriv-assets-total').textContent()) ?? '');
  const owed = centsOf((await page.getByTestId('ask-deriv-owed-total').textContent()) ?? '');
  expect(owned - owed).toBe(14480474);
  await expect(page.getByTestId('ask-deriv-total')).toContainText('$144,804.74');

  // The answered page — formula panel OPEN — still passes WCAG 2.1 AA.
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations, JSON.stringify(results.violations.map((v) => v.id))).toEqual([]);
});

test('Glass-Box 3: cash needed is tappable — per-card due amounts re-sum to the headline', async ({ page }) => {
  // The seed has cards due this cycle (the dashboard glass-box spec pins the same
  // engine result), so the Ask answer carries a real figure and its derivation.
  await signIn(page);
  await page.goto('/ask');
  await ask(page, 'What do I owe on my cards?');

  const headline = page.getByTestId('ask-headline');
  await expect(headline).toContainText(/You need \$[\d,]+\.\d{2}/);
  const amount = ((await headline.textContent()) ?? '').match(/\$[\d,]+\.\d{2}/)?.[0];
  expect(amount).toBeTruthy();

  await headline.click();
  await expect(page.getByTestId('ask-trace')).toBeVisible();
  const rowTexts = await page.getByTestId('ask-deriv-row-amount').allTextContents();
  expect(rowTexts.length).toBeGreaterThan(0);
  expect(rowTexts.reduce((s, t) => s + centsOf(t), 0)).toBe(centsOf(amount!));
  await expect(page.getByTestId('ask-deriv-total')).toContainText(amount!);
  // The footer restates the headline's "by DATE" claim in the SAME format —
  // one formatter, never two renderings of one claim (critic F3).
  const byDate = ((await headline.textContent()) ?? '').match(/by ([A-Z][a-z]{2} \d{1,2}, \d{4})/)?.[1];
  expect(byDate).toBeTruthy();
  await expect(page.getByTestId('ask-trace')).toContainText(`Needed by ${byDate}`);
});

test('Glass-Box 3: savings rate is tappable — income − expenses = kept, and the panel rate IS the headline rate', async ({ page }) => {
  await signIn(page);
  await page.goto('/ask');
  await ask(page, "What's my savings rate?");

  const headline = page.getByTestId('ask-headline');
  await expect(headline).toContainText(/savings rate was -?\d+\.\d%/);
  const pct = ((await headline.textContent()) ?? '').match(/(-?\d+\.\d)%/)?.[1];
  expect(pct).toBeTruthy();

  await headline.click();
  await expect(page.getByTestId('ask-trace')).toBeVisible();
  // The subtraction re-run off the DOM's own lines: income + (−expenses) = kept.
  const lines = await page.getByTestId('ask-deriv-row-amount').allTextContents();
  expect(lines).toHaveLength(2);
  const kept = centsOf((await page.getByTestId('ask-deriv-saved').textContent()) ?? '');
  expect(lines.reduce((s, t) => s + centsOf(t), 0)).toBe(kept);
  // One formatter end to end: the panel's rate is exactly the headline's rate.
  await expect(page.getByTestId('ask-deriv-rate')).toHaveText(`${pct}%`);
});

test('Glass-Box 3: an UNTRACED derivation figure (safe-to-spend) stays a plain, untappable <p>', async ({ page }) => {
  // Slice 3 built formula panels for net_worth / cash_needed / savings_rate ONLY.
  // Every other derivation intent must keep the honest non-offer — no trace, no tap.
  await signIn(page);
  await page.goto('/ask');
  await ask(page, 'How much can I safely spend this month?');
  const headline = page.getByTestId('ask-headline');
  await expect(headline).toContainText(/guilt-free allocation|over your plan/);
  await expect(headline).toHaveJSProperty('tagName', 'P'); // a paragraph, not a button
  await expect(page.getByTestId('ask-trace')).toHaveCount(0);
});

test('Glass-Box 2b: a listed FACT is tappable on its own and reconciles to its rows', async ({ page }) => {
  // Slice 2b: per-fact tappability. On top_categories the HEADLINE panel honestly
  // hides the group breakdown (only the top category is behind the tapped figure,
  // slice-2a P1-1) — but each LISTED category fact now opens its OWN panel,
  // reconciled to that fact's figure. We tap a NON-TOP fact to prove exactly the
  // capability 2a couldn't offer, and re-sum its rows off the DOM.
  await signIn(page);
  await page.goto('/ask');
  await ask(page, 'What are my top spending categories this month?');

  // A non-top fact's value is a disclosure button, collapsed by default.
  const factValue = page.getByTestId('ask-fact-value').nth(1);
  await expect(factValue).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('ask-fact-trace')).toHaveCount(0);
  const amount = ((await factValue.textContent()) ?? '').match(/\$[\d,]+\.\d{2}/)?.[0];
  expect(amount).toBeTruthy();

  await factValue.click();
  await expect(factValue).toHaveAttribute('aria-expanded', 'true');
  const panel = page.getByTestId('ask-fact-trace');
  await expect(panel).toBeVisible();
  // The panel's ✓ line states this FACT's figure — and the rows really sum to it.
  await expect(page.getByTestId('ask-fact-reconciled')).toContainText(amount!);
  const rowTexts = await panel.getByTestId('ask-trace-row-amount').allTextContents();
  expect(rowTexts.length).toBeGreaterThan(0);
  const rowSum = rowTexts.reduce((acc, t) => acc + Number(t.replace(/[^0-9]/g, '')) * (/^[−-]/.test(t.trim()) ? -1 : 1), 0);
  expect(rowSum).toBe(Number(amount!.replace(/[^0-9]/g, '')));
  // The headline's own panel stayed closed — the fact tap is independent.
  await expect(page.getByTestId('ask-trace')).toHaveCount(0);

  // The answered page — fact panel OPEN — still passes WCAG 2.1 AA.
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations, JSON.stringify(results.violations.map((v) => v.id))).toEqual([]);
});

test('Glass-Box 2b: the correction chip renders on spend rows and NEVER on merchant rows (render-only)', async ({ page }) => {
  // RENDER-ONLY by design: clicking "Update category" would persist a Correction
  // for the SHARED demo user and perturb every parallel spec's pinned seed figures
  // (the #182 session-revoke precedent). The real write path — figure moves,
  // append-only Correction, undo restores — is proven by the integration test
  // (tests/unit/ask-correction-action.test.ts) against throwaway data.
  await signIn(page);
  await page.goto('/ask');
  await ask(page, 'How much did I spend this month?');
  await page.getByTestId('ask-headline').click();
  await expect(page.getByTestId('ask-trace')).toBeVisible();

  // Spend rows offer the chip; the editor opens with a picker and a disabled
  // apply until a category is chosen; Cancel closes it without any write.
  const fix = page.getByTestId('ask-trace-fix').first();
  await expect(fix).toBeVisible();
  await fix.click();
  const editor = page.getByTestId('ask-correction-editor');
  await expect(editor).toBeVisible();
  await expect(editor).toContainText('This should be');
  await expect(page.getByTestId('ask-correction-apply')).toBeDisabled();
  // The editor open passes WCAG 2.1 AA (labelled select, focusable controls).
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations, JSON.stringify(results.violations.map((v) => v.id))).toEqual([]);
  await fix.click(); // now reads "Cancel"
  await expect(editor).toHaveCount(0);

  // A merchant answer's rows carry NO chip — a category change doesn't move that
  // figure, so offering the correction there would be a write we can't show.
  await ask(page, 'How much did I spend at Costco this month?');
  await page.getByTestId('ask-headline').click();
  await expect(page.getByTestId('ask-trace')).toBeVisible();
  await expect(page.getByTestId('ask-trace-row').first()).toBeVisible();
  await expect(page.getByTestId('ask-trace-fix')).toHaveCount(0);
});

test('plans debt-free BY A DATE (inverse planning) and offers to save it as a goal', async ({ page }) => {
  // DECISIONS #125 — "Plan in Words" debt slice: a stated date is solved for the
  // required extra payment, grounded in the same debt read-path as /goals.
  await signIn(page);
  await page.goto('/ask');
  await ask(page, 'Can I be debt-free by December 2028?');

  const headline = page.getByTestId('ask-headline');
  await expect(headline).toContainText(/debt-free/i);
  await expect(headline).toContainText('December 2028');
  // Grounded: links to the debt plan, and offers the confirm-before-create save action.
  await expect(page.getByTestId('ask-source')).toHaveAttribute('href', '/goals');
  await expect(page.getByTestId('ask-save-goal')).toBeVisible();
  // Deterministic route (the demo has no LLM key) — the interpreted banner must be absent.
  await expect(page.getByText('I interpreted your question')).toHaveCount(0);

  // The new save affordance must also pass a11y (it adds a button to the answer card).
  // NOTE: we deliberately do NOT click Save here — persisting a goal would mutate the
  // shared demo user under parallel e2e; the save path is locked by save-debt-free-goal.test.ts.
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations, JSON.stringify(results.violations.map((v) => v.id))).toEqual([]);
});

test('plans a savings goal BY A DATE (inverse planning) and offers to save it as a goal', async ({ page }) => {
  // DECISIONS #126 — "Plan in Words" savings slice: a stated amount + date is solved for the
  // required monthly contribution, grounded in the same safe-to-spend read-path as /spending-plan.
  await signIn(page);
  await page.goto('/ask');
  await ask(page, 'Can I save $20,000 by December 2028?');

  const headline = page.getByTestId('ask-headline');
  await expect(headline).toContainText('$20,000.00');
  await expect(headline).toContainText('December 2028');
  await expect(headline).toContainText('/mo'); // a real monthly figure, whatever the budget state
  // Grounded: links to goals, and offers the confirm-before-create save action.
  await expect(page.getByTestId('ask-source')).toHaveAttribute('href', '/goals');
  await expect(page.getByTestId('ask-save-goal')).toBeVisible();
  // Deterministic route (the demo has no LLM key) — the interpreted banner must be absent.
  await expect(page.getByText('I interpreted your question')).toHaveCount(0);

  // The save affordance must pass a11y. We do NOT click Save — persisting a goal would mutate
  // the shared demo user under parallel e2e; the save path is locked by save-savings-goal.test.ts.
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations, JSON.stringify(results.violations.map((v) => v.id))).toEqual([]);
});

test('plans retire-at-age (inverse planning) and offers to save the age as a plan', async ({ page }) => {
  // DECISIONS #131 — "Plan in Words" retirement slice: a stated age is solved for the required
  // monthly contribution to make the portfolio last, grounded in the same /coach figures the
  // /investments retirement outlook uses. With a 20-year runway (default age 40 → 60) the outcome
  // is always reachable or already-on-track (never unreachable), so the save affordance appears.
  await signIn(page);
  await page.goto('/ask');
  await ask(page, 'Can I retire at 60?');

  const headline = page.getByTestId('ask-headline');
  await expect(headline).toContainText('60');
  // Grounded: a retirement plan persists to the planning dial, surfaced on /investments (not /goals).
  await expect(page.getByTestId('ask-source')).toHaveAttribute('href', '/investments');
  const save = page.getByTestId('ask-save-goal');
  await expect(save).toBeVisible();
  await expect(save).toContainText('Save as my plan'); // retirement-specific copy, not "Save as a goal"
  // Deterministic route (the demo has no LLM key) — the interpreted banner must be absent.
  await expect(page.getByText('I interpreted your question')).toHaveCount(0);

  // The save affordance must pass a11y. We do NOT click Save — persisting would mutate the
  // shared demo user under parallel e2e; the save path is locked by save-retirement-age.test.ts.
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations, JSON.stringify(results.violations.map((v) => v.id))).toEqual([]);
});

test('routes a spoken wealth target to the compounding planner (W.4)', async ({ page }) => {
  // W.1 shipped the engine and the /coach card; Ask did not route the owner's
  // question. No save affordance — the card is the place to change the number.
  await signIn(page);
  await page.goto('/ask');
  await ask(page, 'if I want to save up to 10 mil what do I need to do?');

  await expect(page.getByTestId('ask-headline')).not.toBeEmpty();
  await expect(page.getByTestId('ask-source')).toHaveAttribute('href', '/coach');
  await expect(page.getByTestId('ask-answer')).toContainText('$10,000,000.00');
  await expect(page.getByTestId('ask-save-goal')).toHaveCount(0);
  await expect(page.getByText('I interpreted your question')).toHaveCount(0);

  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations, JSON.stringify(results.violations.map((v) => v.id))).toEqual([]);
});

test('an off-topic question still returns a safe, non-empty answer (no crash)', async ({ page }) => {
  // Env-robust: with no LLM key this is the deterministic capabilities answer;
  // with a key the classifier routes it — either way the pipeline must not crash
  // and never throws. (The no-key capabilities path is covered by unit tests.)
  await signIn(page);
  await page.goto('/ask');
  await page.getByTestId('ask-input').fill('tell me a joke about taxes');
  await page.getByTestId('ask-submit').click();
  // Unknown phrasings may consult the LLM classifier (when a key is set), which is
  // bounded by a 7s timeout before falling back deterministically — allow for it.
  await expect(page.getByTestId('ask-answer')).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('ask-headline')).not.toBeEmpty();
});

test('a follow-up fragment is answered against the previous question (TASKS 2.1)', async ({
  page,
}) => {
  await signIn(page);
  await page.goto('/ask');

  // The frame: a category question in the current window (June 2026 on the demo clock).
  await ask(page, 'How much did I spend on groceries this month?');
  await expect(page.getByTestId('ask-headline')).toContainText(/Groceries/i);
  await expect(page.getByTestId('ask-headline')).toContainText(/this month/i);

  // Ellipsis 1 — swap the WINDOW; the category is carried, not re-stated.
  await ask(page, 'what about last month?');
  await expect(page.getByTestId('ask-headline')).toContainText(/Groceries/i);
  await expect(page.getByTestId('ask-headline')).toContainText(/last month/i);

  // Ellipsis 2 — swap the CATEGORY; the window (last month) is carried.
  await ask(page, 'and restaurants?');
  await expect(page.getByTestId('ask-headline')).toContainText(/last month/i);
  await expect(page.getByTestId('ask-headline')).not.toContainText(/Groceries/i);
});

test('the answered Ask page passes WCAG 2.1 AA (axe)', async ({ page }) => {
  await signIn(page);
  await page.goto('/ask');
  await ask(page, 'What is my net worth?');
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations, JSON.stringify(results.violations.map((v) => v.id))).toEqual([]);
});

/**
 * Learned vocabulary (TASKS 2.3 / DECISIONS #225). The demo dataset learns nothing on
 * its own, so the fixture plants the EVIDENCE a repeat-asker would generate and runs
 * the real miner over it (3 independent rescues → shadow; 2 held-out → flagged).
 *
 * Then the whole user-facing contract, in one flow: a phrasing the parser cannot route
 * is answered anyway, the answer says so, and one click ends it permanently.
 */
test('a learned phrasing answers, discloses itself, and can be forgotten', async ({ page }) => {
  // A REAL account, not the one-click demo: the shared demo login deliberately never
  // learns (one visitor's typed words must not reach the next), so the loop can only
  // be driven end-to-end as a signed-up user.
  const email = `vocab-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20000 });

  execSync('npx tsx scripts/e2e-vocab-fixture.ts', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: E2E_DB_URL, VOCAB_FIXTURE_EMAIL: email },
  });

  await page.goto('/ask');

  // Slang the deterministic parser has no rule for — with no LLM key configured, the
  // ONLY thing that can answer it is the learned phrase.
  await ask(page, 'Whats the damage on groceries?');
  await expect(page.getByTestId('ask-headline')).toContainText(/Groceries/i);
  // The figure is the ENGINE's, not the rule's — this account has no transactions, so
  // the honest answer is the zero-spend copy. The rule routed the question; it did not
  // supply, and could not have supplied, a number.
  await expect(page.getByTestId('ask-headline')).toContainText(/No Groceries spending/i);
  const learnedHeadline = await page.getByTestId('ask-headline').textContent();

  // Nothing is served silently: the flagged band discloses + offers the undo.
  const learned = page.getByTestId('ask-learned');
  await expect(learned).toBeVisible();
  await expect(learned).toContainText(/learned from how you ask/i);

  // Forgetting is terminal — the same question falls back to the honest `unknown`.
  await page.getByTestId('ask-forget-phrase').click();
  await expect(page.getByTestId('ask-forget-phrase')).toContainText(/Forgotten/i);

  // Reload first: the previous answer is still the client's conversation frame
  // (TASKS 2.1), and this question names a category the frame would legitimately swap
  // in. A fresh page isolates the vocabulary route, which is what's under test.
  await page.reload();
  await ask(page, 'Whats the damage on groceries?');
  await expect(page.getByTestId('ask-answer')).not.toContainText(/learned from how you ask/i);
  await expect(page.getByTestId('ask-headline')).toContainText(
    /I can answer questions grounded in your own accounts/i,
  );
  expect(learnedHeadline).not.toBe(await page.getByTestId('ask-headline').textContent());
});

test('O.19b: a capped spend answer carries a remainder line recomposing the headline total', async ({ page }) => {
  // The owner's /reports finding applied to Ask: a period total above a capped
  // category list must state its tail. The demo seed has >3 spend categories,
  // so the hard case is guaranteed present — the count assertion below fails if
  // the fixture ever degrades to a complete (≤3) list, keeping this non-vacuous.
  await signIn(page);
  await page.goto('/ask');
  await ask(page, 'How much did I spend this month?');

  const headlineText = (await page.getByTestId('ask-headline').textContent()) ?? '';
  const headlineAmount = headlineText.match(/\$[\d,]+\.\d{2}/)?.[0];
  expect(headlineAmount).toBeTruthy();

  const facts = page.getByTestId('ask-fact');
  await expect(facts).toHaveCount(4); // top 3 + the remainder line
  const tail = facts.nth(3);
  await expect(tail).toContainText(/Everything else · \d+ more categor(y|ies)/);
  // The tail is many categories, not one trace group — plain text, never a dead tap.
  await expect(tail.getByRole('button')).toHaveCount(0);

  // The painted money recomposes the headline: 3 listed categories + the
  // remainder value sum to exactly the total the headline prints.
  const values = await page.getByTestId('ask-fact-value').allTextContents();
  expect(values).toHaveLength(4);
  const sumCents = values.reduce((acc, t) => acc + Number(t.replace(/[^0-9]/g, '')), 0);
  expect(sumCents).toBe(Number(headlineAmount!.replace(/[^0-9]/g, '')));
});
