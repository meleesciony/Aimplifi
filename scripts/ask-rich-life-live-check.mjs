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
 * ANTI-VACUITY. The not-written answer is exactly what a pre-#505 build would
 * answer UNKNOWN, so two discriminators matter: the answer must be the
 * rich_life branch ("I don't have your Rich Life line yet") AND the live
 * /ask client bundles must contain that sentence — a pre-#505 deploy has it
 * nowhere. The script fetches every script the live page loaded and greps them.
 *
 *   node scripts/ask-rich-life-live-check.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.LIVE_BASE ?? 'https://www.aimplifi.app';
const MARKER = "I don't have your Rich Life line yet";
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
  await page.getByTestId('ask-input').fill('What is my rich life?');
  await page.getByTestId('ask-submit').click();
  await page.getByTestId('ask-answer').waitFor({ state: 'visible', timeout: 30_000 });

  const headline = ((await page.getByTestId('ask-headline').textContent()) ?? '').trim();
  check('not-written branch answers (the demo can never hold a vision)', headline.includes("don't have"), headline.slice(0, 90));
  const answer = ((await page.getByTestId('ask-answer').textContent()) ?? '');
  check('the answer points at Settings', answer.includes('Settings'));
  check('no "this card"/"below" claims in the answer', !/this card|below/i.test(answer));

  // The sha, proved by content: the rich_life sentence is in the live /ask
  // client bundles. A pre-#505 deploy has the string nowhere.
  const loaded = await page.evaluate(async (marker) => {
    const hrefs = performance
      .getEntriesByType('resource')
      .map((e) => e.name)
      .filter((u) => u.includes('/_next/') && /\.[jt]s/.test(u));
    const found = [];
    for (const u of hrefs) {
      try {
        const t = await fetch(u).then((r) => r.text());
        if (t.includes(marker)) found.push(u);
      } catch {
        /* a chunk that can't be read is not the proof; skip */
      }
    }
    return found;
  }, MARKER);
  check('rich_life not-written sentence is in the live /ask client bundles', loaded.length > 0, `${loaded.length} chunk(s)`);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? '\nALL CHECKS PASSED' : `\n${failed.length} CHECK(S) FAILED`);
process.exit(failed.length === 0 ? 0 : 1);
