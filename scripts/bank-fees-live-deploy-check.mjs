/**
 * Deploy proof for DECISIONS #796 (Fees you paid: the bank and card fees in the last 12
 * months of records, by kind, and what came back), run against PRODUCTION. Node type: live probe
 * (GRAPH.md §6).
 *
 * WHAT DISCRIMINATES THIS BUILD FROM THE LAST: /coach renders a new server-rendered card,
 * `bank-fees-card` (`#fees-you-paid`), absent on the last build; and `/coach` is a named
 * return page — a transaction opened with `?back=_coach` offers "Back to your coach", where
 * the last build decoded the unknown token to the register's fallback. And the
 * `/_next/static` files `/sign-in` serves must be the ones the deployment for this commit
 * serves (`DEPLOY_URL`, read from the GitHub deployment record for the sha).
 *
 * WHAT IT ALSO PROVES: the card reads the shared demo's own rows (nothing there is filed as
 * a fee, so the lead names that zero), the rule is one tap away, and /coach still fits a
 * 380px phone.
 *
 * WHAT IT CANNOT PROVE: the kinds, the refunds, the not-counted rows and the left-out interest
 * on a real reader's rows — the demo has no fee rows. Those are proven by the unit locks over invented rows
 * (tests/unit/bank-fees.test.ts, the worked example in tests/edge-cases/bank-fees.md) and
 * the e2e throwaway reader (tests/e2e/bank-fees.spec.ts).
 *
 * Read-only throughout: one-click demo sign-in, reads pages, writes nothing.
 *
 *   MODE=read node scripts/bank-fees-live-deploy-check.mjs
 *   DEPLOY_URL=https://<deployment>.vercel.app node scripts/bank-fees-live-deploy-check.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.LIVE_BASE ?? 'https://www.aimplifi.app';
const MODE = process.env.MODE ?? 'check';
const DEPLOY_URL = process.env.DEPLOY_URL;

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

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 380, height: 800 } });
try {
  if (MODE !== 'read' && !DEPLOY_URL) throw new Error('set DEPLOY_URL (or MODE=read)');
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

  await page.goto(`${BASE}/coach`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('opportunities-card').first().waitFor({ timeout: 30_000 });
  const card = page.getByTestId('bank-fees-card');
  const present = (await card.count()) > 0;

  // A demo transaction to open with the new return token: the first row's detail link on the register.
  await page.goto(`${BASE}/transactions`, { waitUntil: 'domcontentloaded' });
  const firstRow = page.getByTestId('txn-detail-link').first();
  await firstRow.waitFor({ state: 'attached', timeout: 30_000 }); // hidden in a closed row on a phone
  const rowHref = (await firstRow.getAttribute('href')) ?? '';
  const rowId = /^\/transactions\/([^/?#]+)/.exec(rowHref)?.[1] ?? '';
  await page.goto(`${BASE}/transactions/${rowId}?back=_coach`, { waitUntil: 'domcontentloaded' });
  const backToCoach = (await page.getByRole('link', { name: 'Back to your coach' }).count()) > 0;

  if (MODE === 'read') {
    console.log(`bank-fees card present: ${present}`);
    console.log(`"Back to your coach" on ?back=_coach: ${backToCoach} (row ${rowId || 'none found'})`);
  } else {
    await page.goto(`${BASE}/coach`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('opportunities-card').first().waitFor({ timeout: 30_000 });
    check('/coach: the "Fees you paid" card renders', present && (await page.locator('#fees-you-paid').count()) === 1);
    const lead = present ? ((await page.getByTestId('bank-fees-lead').textContent()) ?? '').trim() : '';
    check(
      '/coach: the lead is one of the card’s shapes, over a named window',
      // The card's lead shapes (critic cycle 1: never a "cost you" net).
      (/^(No bank or card fees counted|You paid at least \$[\d,]+\.\d{2} in bank and card fees)/.test(lead) &&
        /(in the last 12 months|since your records begin on [A-Z][a-z]{2} \d{1,2}, \d{4})/.test(lead) &&
        !/cost you/.test(lead)) ||
        lead === 'No checking, savings or card records yet, so there are no fees to count.',
      lead,
    );
    const how = page.getByTestId('bank-fees-how');
    let rule = '';
    if ((await how.count()) === 1) {
      await how.locator('summary').click();
      rule = ((await page.getByTestId('bank-fees-rule').textContent()) ?? '').trim();
    }
    check('/coach: the rule is one tap away and names what it counts', /Fees & Charges, ATM Fee or Late Fee/.test(rule), rule.slice(0, 80));
    check('/transactions/<id>?back=_coach offers "Back to your coach"', backToCoach, rowId);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check('/coach: no horizontal scroll at 380px', overflow <= 0, `${overflow}px`);
  }
} catch (err) {
  check('script completed without error', false, String(err).slice(0, 200));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\nDEPLOY PROOF: ${failed === 0 ? 'PASS' : 'FAIL'} (${results.length - failed}/${results.length})`);
process.exit(failed === 0 ? 0 : 1);
