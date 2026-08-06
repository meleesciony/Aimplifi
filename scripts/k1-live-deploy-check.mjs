/**
 * Deploy proof for K.1 (DECISIONS #419), run against PRODUCTION.
 *
 * /calendar is auth-gated, so `curl | grep` gets a 307 and proves nothing. This
 * signs into the shared demo (one click, no credentials) and reads the real page.
 * Read-only throughout.
 *
 * ANTI-VACUITY. Every check is written to FAIL on the pre-K.1 build, not merely
 * to find some text:
 *
 *   - the header must read "Posted + pending through …" — the old build had no
 *     posted half at all, and the demo's pinned month holds three PENDING rows,
 *     so the pending-naming (critic F-1) is exercised live, not just the feature;
 *   - the old header title "Inflows, outflows, and card due dates" must be
 *     ABSENT — an absence check that would pass on a blank page, so the NEW
 *     title is asserted present first;
 *   - the projection line must say "Expected:" (the old build's one-line summary
 *     said neither Expected nor Posted);
 *   - May 2026 (a wholly-past month, unreachable-with-content on the old build:
 *     its grid could only hold scheduled replays or nothing) must paint a posted
 *     day whose link carries its own one-day register window;
 *   - January 2023 must name WHICH zero ("history starts"), where the old build
 *     said "No scheduled activity this month".
 *
 *   node scripts/k1-live-deploy-check.mjs
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

try {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard', { timeout: 30_000 });
  check('signed into the shared demo on production', true, BASE);

  // ---- current month: both header lines, pending named ----
  await page.goto(`${BASE}/calendar`, { waitUntil: 'domcontentloaded' });
  const postedLine = page.getByTestId('cal-posted-line');
  await postedLine.waitFor({ state: 'visible', timeout: 30_000 });
  const postedText = await postedLine.innerText();
  check(
    'header names the pending money it counts (critic F-1, live)',
    /Posted \+ pending through/.test(postedText),
    postedText.slice(0, 80),
  );
  const schedText = await page.getByTestId('cal-scheduled-line').innerText();
  check('projection line reads "Expected:"', /^Expected:/.test(schedText), schedText.slice(0, 60));
  const newTitle = await page.getByText('Posted activity and upcoming payments').count();
  check('new card title present (anchor for the absence check)', newTitle > 0);
  const oldTitle = await page.getByText('Inflows, outflows, and card due dates').count();
  check('old card title ABSENT (old build not being served)', oldTitle === 0, `${oldTitle} found`);

  // ---- a wholly-past month paints posted days that link to their own register window ----
  await page.goto(`${BASE}/calendar?month=2026-05`, { waitUntil: 'domcontentloaded' });
  const dayLink = page.getByTestId('cal-posted-day-link').first();
  await dayLink.waitFor({ state: 'visible', timeout: 30_000 });
  const href = await dayLink.getAttribute('href');
  check(
    'May 2026 paints posted days, each linking to a one-day register window',
    /\/transactions\?from=2026-05-\d{2}&to=2026-05-\d{2}$/.test(href ?? ''),
    href ?? 'no href',
  );
  const outCount = await page.getByTestId('cal-posted-out').count();
  check('…with real Money out lines on the grid', outCount > 0, `${outCount} days`);

  // ---- a month before the corpus names WHICH zero ----
  await page.goto(`${BASE}/calendar?month=2023-01`, { waitUntil: 'domcontentloaded' });
  const empty = page.getByTestId('cal-empty');
  await empty.waitFor({ state: 'visible', timeout: 30_000 });
  const emptyText = await empty.innerText();
  check(
    'January 2023 names the history floor, not "no activity"',
    /history starts/.test(emptyText),
    emptyText.slice(0, 80),
  );
} catch (err) {
  check('script completed without a thrown error', false, String(err).slice(0, 200));
} finally {
  await browser.close();
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
