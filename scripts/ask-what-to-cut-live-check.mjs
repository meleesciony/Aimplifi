/**
 * Node type: live-probe (GRAPH.md §6 — proves one shipped claim against production).
 * Deploy proof for the Ask `what_to_cut` counterfactual (P.1 — FI half #506,
 * radar/cash-dip half #507), run against PRODUCTION.
 *
 * /ask is auth-gated, so `curl | grep` gets a 307 (`committed-is-not-shipped`).
 * This signs into the shared demo and asks "What should I cut?". The demo's
 * seed is pinned (asOf 2026-06-10), so the dollar figures over its four
 * opportunities are fixed: $78.87/mo total, the FI number $23,661.00 lower
 * (locked by tests/unit/fi-cut-counterfactual.test.ts's demo wiring test).
 * The month-span is computed by `monthsToFI` from `today`, so it is asserted
 * as a present movement (the ask.spec.ts regex), not a specific N — production
 * `today` is not the seed asOf, and pinning 11 (local seed) fails the live
 * 12-month sentence. Read-only: it never submits a form's data beyond the ask
 * input, and writes nothing.
 *
 * ANTI-VACUITY. The answer copy is server-side only, so no bundle check is
 * possible; the discriminator is the answer itself — a pre-#506 build answers
 * the SAME list with NO FI-movement sentence (the pre-#506 e2e asserted its
 * absence). Proving the movement sentence with the pinned dollar figures is
 * present proves the counterfactual shipped.
 *
 *   node scripts/ask-what-to-cut-live-check.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.LIVE_BASE ?? 'https://www.aimplifi.app';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 380, height: 800 } });

/** The demo button is type="submit": a pre-hydration click natively submits to
 *  /sign-in (seen twice, 2026-08-23). Retry through '/' — the hydrated click
 *  always signs in. */
async function signInDemo() {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('demo-sign-in').click();
    try {
      await page.waitForURL('**/dashboard', { timeout: 10_000 });
      return;
    } catch {
      // Native/aborted submit — reload and click again once hydrated.
    }
  }
  throw new Error('demo sign-in never reached /dashboard in 3 attempts');
}

try {
  await signInDemo();
  check('signed into the shared demo on production', true, BASE);

  await page.goto(`${BASE}/ask`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('ask-input').waitFor({ state: 'visible', timeout: 30_000 });

  // Hydration: the ask input is CONTROLLED — a fill that lands before React
  // attaches gets reset to empty (and the submit button stays disabled), the
  // same class as the demo-button pre-hydration race. Verify the value stuck
  // AND the submit is enabled before clicking; retry through the race.
  const question = 'What should I cut?';
  let ready = false;
  for (let attempt = 0; attempt < 6 && !ready; attempt++) {
    await page.getByTestId('ask-input').fill(question);
    const value = await page.getByTestId('ask-input').inputValue();
    ready = value === question && (await page.getByTestId('ask-submit').isEnabled());
    if (!ready) await page.waitForTimeout(500);
  }
  if (!ready) throw new Error('ask input never hydrated (value never stuck / submit stayed disabled)');

  await page.getByTestId('ask-submit').click();
  await page.getByTestId('ask-answer').waitFor({ state: 'visible', timeout: 30_000 });

  const headline = ((await page.getByTestId('ask-headline').textContent()) ?? '').trim();
  check('the standing list still answers first (LA Fitness $34.99/mo)',
    headline.includes('LA Fitness') && headline.includes('$34.99'), headline.slice(0, 90));

  const answer = ((await page.getByTestId('ask-answer').textContent()) ?? '');
  const acting = answer.indexOf('Acting on');
  const snippet = (acting >= 0 ? answer.slice(acting) : answer).replace(/\s+/g, ' ').slice(0, 280);
  check('the FI-movement sentence is present (month-span computed, not pinned)',
    /moves your FI date about \d+ months? sooner/.test(answer), snippet);
  check('the target drop is the pinned seed figure ($23,661.00)',
    answer.includes('$23,661.00'));
  check('the deduped total is the pinned seed figure (about $78.87 a month, part estimated)',
    answer.includes('about $78.87 a month, part of it estimated'));
  check('assumptions are stated inline (cuts stick; same rates as Coach; illustration)',
    answer.includes('Assumes the cuts stick')
    && answer.includes('same return and inflation assumptions as Coach')
    && answer.includes('Illustration, not advice'));
  check('no "this card"/"below" claims in the answer', !/this card|below/i.test(answer));
  // Demo seed: the four opportunities are card-billed, not checking
  // scheduled, so the radar re-walk is the honest null. A production
  // answer that invents "your July dip disappears" on this seed is a
  // fabricated effect (the unit lock is
  // test_regression__p1_cut_does_not_invent_a_radar_dip_on_the_demo_seed).
  check('demo seed has no radar-dip sentence (honest null — nothing on checking scheduled matches)',
    !/90-day cash-flow walk/.test(answer), snippet);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? '\nALL CHECKS PASSED' : `\n${failed.length} CHECK(S) FAILED`);
process.exit(failed.length === 0 ? 0 : 1);
