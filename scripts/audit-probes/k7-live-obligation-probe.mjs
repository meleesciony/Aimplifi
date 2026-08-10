/**
 * K.7 production probe #2 — READ-ONLY. Answers ONE question with evidence rather
 * than inference: does production's demo `acct-autoloan` carry a DATEABLE
 * obligation (`selectLoanObligations`: minimumPaymentCents > 0 AND dueDayOfMonth)?
 *
 * /accounts renders no loan terms, so the obligation is read through the OTHER
 * surfaces `loanObligations` feeds — /forecast (loanObligationsToScheduledFlows)
 * and the dashboard's loan dues. If the obligation existed, at least one of them
 * would name the Auto Loan; if it does not, none can.
 *
 *   node scripts/audit-probes/k7-live-obligation-probe.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.LIVE_BASE ?? 'https://www.aimplifi.app';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });

const report = async (route) => {
  await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  const hits = [];
  for (const re of [/Auto Loan[^.]{0,60}/gi, /auto ?loan[^.]{0,60}/gi]) {
    for (const m of body.matchAll(re)) hits.push(m[0].trim().slice(0, 100));
  }
  console.log(`\n=== ${route} ===`);
  const uniq = [...new Set(hits)];
  if (uniq.length === 0) console.log('  (no mention of the Auto Loan anywhere on the page)');
  for (const h of uniq) console.log(`  ${h}`);
};

try {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard', { timeout: 60_000 });
  console.log(`signed into the shared demo on ${BASE}`);

  await report('/dashboard');
  await report('/forecast');
  await report('/accounts');
} finally {
  await browser.close();
}
