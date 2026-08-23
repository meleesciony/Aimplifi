/**
 * Node type: live-probe (GRAPH.md §6 — proves one shipped claim against production).
 * Deploy proof for the Ask `rich_life` intent (DECISIONS #505), run against
 * PRODUCTION.
 *
 * /ask is auth-gated, so `curl | grep` gets a 307 (`committed-is-not-shipped`).
 * This signs into the shared demo — the demo row can never hold a vision (both
 * fences, #504) — so the answer to "what is my rich life?" MUST be the
 * not-written branch pointing at Settings. Read-only: it never submits a
 * form's data beyond the ask input, and writes nothing.
 *
 * ANTI-VACUITY. The answer copy is server-side only, so no bundle check is
 * possible; the discriminator is the answer itself — a pre-#505 build has no
 * rich_life kind and returns the UNKNOWN answer ("I can answer questions
 * grounded in your own accounts…"). Proving the answer is the rich_life
 * not-written branch AND not the unknown answer proves the routing shipped.
 *
 *   node scripts/ask-rich-life-live-check.mjs
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
  // and retry once.
  const question = 'What is my rich life?';
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByTestId('ask-input').fill(question);
    const value = await page.getByTestId('ask-input').inputValue();
    if (value === question) break;
  }

  await page.getByTestId('ask-submit').click();
  await page.getByTestId('ask-answer').waitFor({ state: 'visible', timeout: 30_000 });

  const headline = ((await page.getByTestId('ask-headline').textContent()) ?? '').trim();
  check('not-written branch answers (the demo can never hold a vision)', headline.includes("don't have"), headline.slice(0, 90));
  const answer = ((await page.getByTestId('ask-answer').textContent()) ?? '');
  check('the answer points at Settings', answer.includes('Settings'));
  check('no "this card"/"below" claims in the answer', !/this card|below/i.test(answer));

  // ANTI-VACUITY (DOM side, deliberate): the answer copy is server-side only
  // (assistant.ts answers in the request), so a bundle-content check is
  // impossible for it. The discriminator is the ANSWER ITSELF: a pre-#505
  // build has no rich_life kind and answers the off-topic/unknown sentence —
  // a different headline AND body. Proving the answer is NOT the unknown
  // answer proves the routing shipped.
  check(
    'the demo answer is the rich_life branch, not the pre-#505 unknown answer',
    !answer.includes('I can answer questions grounded in your own accounts'),
  );
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? '\nALL CHECKS PASSED' : `\n${failed.length} CHECK(S) FAILED`);
process.exit(failed.length === 0 ? 0 : 1);
