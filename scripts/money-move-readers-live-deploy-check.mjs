/**
 * Deploy proof for DECISIONS #792 (money moves, the remaining readers), run against
 * PRODUCTION. Node type: live probe (GRAPH.md §6).
 *
 * WHAT DISCRIMINATES THIS BUILD FROM THE LAST: the slice's figures move only for rows
 * filed as moves without the transfer flag, and the shared demo has none (every one of
 * its money-move rows is flagged), so no demo figure may change. But the transfer-repair
 * card on /settings is a client component that imports its one copy author, so the new
 * words — the note naming Investment & Savings among the marks it does not cover — ship
 * in a `/_next/static` chunk /settings loads: present on this build, absent on the last.
 * And the `/_next/static` files `/sign-in` serves must be the ones the deployment for this
 * commit serves (`DEPLOY_URL`, read from the GitHub deployment record for the sha).
 *
 * WHAT IT ALSO PROVES — NOTHING ELSE MOVED ON THE DEMO: /recurring's "Recurring income"
 * figure (`DEMO_RECURRING_INCOME`, read with MODE=read before the deploy) is unchanged, and
 * no row carries the "Money moved, not income" badge.
 *
 * WHAT IT CANNOT PROVE: a real reader's filed, unflagged moves. Those are proven by the
 * unit locks over invented households (tests/unit/money-move-readers.test.ts and the DB
 * test tests/unit/investment-not-spending-cycle2-db.test.ts).
 *
 * Read-only throughout: one-click demo sign-in, reads pages, writes nothing.
 *
 *   MODE=read node scripts/money-move-readers-live-deploy-check.mjs
 *   DEPLOY_URL=https://<deployment>.vercel.app DEMO_RECURRING_INCOME='<figure>' \
 *     node scripts/money-move-readers-live-deploy-check.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.LIVE_BASE ?? 'https://www.aimplifi.app';
const MODE = process.env.MODE ?? 'check';
const DEPLOY_URL = process.env.DEPLOY_URL;
const DEMO_RECURRING_INCOME = process.env.DEMO_RECURRING_INCOME;
const NEW_WORDS = 'filed as a transfer or Investment & Savings';
const OLD_WORDS = 'in a non-USD account, or filed as a transfer — and';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

/** The sorted `/_next/static` script and stylesheet paths a page serves. */
async function staticFiles(request, url) {
  const html = await (await request.get(url)).text();
  return [...new Set([...html.matchAll(/\/_next\/static\/[^"'\s)]+/g)].map((m) => m[0]))].sort();
}

/** How many of a page's client chunks carry each phrase. */
async function chunksCarrying(request, url, phrases) {
  const chunks = (await staticFiles(request, url)).filter((p) => p.endsWith('.js'));
  const counts = phrases.map(() => 0);
  for (const path of chunks) {
    const body = await (await request.get(`${BASE}${path}`)).text();
    phrases.forEach((p, i) => {
      if (body.includes(p)) counts[i]++;
    });
  }
  return { counts, total: chunks.length };
}

/** /recurring's "Recurring income" section hint, or '' when the section shows none. */
async function recurringIncome(page) {
  await page.goto(`${BASE}/recurring`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Recurring & subscriptions' }).waitFor({ timeout: 30_000 });
  const section = page.locator('section', { has: page.getByText('Recurring income', { exact: true }) });
  if ((await section.count()) === 0) return '';
  const text = (await section.first().textContent()) ?? '';
  return text.match(/\$[\d,]+\.\d{2}\/mo/)?.[0] ?? '';
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 380, height: 800 } });
try {
  if (MODE !== 'read' && (!DEPLOY_URL || DEMO_RECURRING_INCOME === undefined)) throw new Error('set DEPLOY_URL and DEMO_RECURRING_INCOME (or MODE=read)');
  if (MODE !== 'read') {
    const live = await staticFiles(page.context().request, `${BASE}/sign-in`);
    const built = await staticFiles(page.context().request, `${DEPLOY_URL}/sign-in`);
    check(
      `${BASE} serves this commit's build (its /_next/static files on /sign-in match ${DEPLOY_URL})`,
      live.length > 0 && JSON.stringify(live) === JSON.stringify(built),
      `${live.length} files live, ${built.length} in the deployment`,
    );
  }

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard', { timeout: 30_000 });
  check('signed into the shared demo', true, BASE);

  await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' });
  const { counts, total } = await chunksCarrying(page.context().request, `${BASE}/settings`, [NEW_WORDS, OLD_WORDS]);
  const income = await recurringIncome(page);
  if (MODE === 'read') {
    console.log(`/settings chunks: ${total}; carrying the new words: ${counts[0]}; the old words: ${counts[1]}`);
    console.log(`DEMO_RECURRING_INCOME='${income}'`);
  } else {
    check(`/settings: a client chunk carries the new repair note ("${NEW_WORDS}")`, counts[0] > 0, `${counts[0]} of ${total} chunks`);
    check('/settings: no chunk carries the old note', counts[1] === 0, `${counts[1]} of ${total} chunks`);
    check(`/recurring: the demo's "Recurring income" figure is unchanged ('${DEMO_RECURRING_INCOME}')`, income === DEMO_RECURRING_INCOME, `'${income}'`);
    check('/recurring: no demo row is badged "Money moved, not income" (the demo has none)', (await page.getByTestId('recurring-money-move-badge').count()) === 0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check('/recurring: no horizontal scroll at 380px', overflow <= 0, `${overflow}px`);
  }
} catch (err) {
  check('script completed without error', false, String(err).slice(0, 200));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\nDEPLOY PROOF: ${failed === 0 ? 'PASS' : 'FAIL'} (${results.length - failed}/${results.length})`);
process.exit(failed === 0 ? 0 : 1);
