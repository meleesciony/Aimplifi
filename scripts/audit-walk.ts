/**
 * Seamlessness audit walker (session tool, not a test): visits every app page as
 * the demo user at the primary 380x800 viewport, records console errors, page
 * errors, failed requests, and coarse load timing, and saves full-page
 * screenshots to .audit/ for human review. Run with the production server on
 * http://127.0.0.1:3100 and the audit DB seeded.
 *
 *   npx tsx scripts/audit-walk.ts [--desktop]
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const BASE = 'http://127.0.0.1:3100';
const OUT = '.audit';
const desktop = process.argv.includes('--desktop');
const viewport = desktop ? { width: 1280, height: 800 } : { width: 380, height: 800 };
const tag = desktop ? 'desktop' : 'mobile';

const PAGES = [
  '/dashboard',
  '/triage',
  '/transactions',
  '/accounts',
  '/cards',
  '/spending-plan',
  '/budgets',
  '/reports',
  '/trends',
  '/recurring',
  '/forecast',
  '/calendar',
  '/goals',
  '/coach',
  '/investments',
  '/ask',
  '/settings',
];

interface PageReport {
  path: string;
  ms: number;
  consoleErrors: string[];
  consoleWarnings: string[];
  pageErrors: string[];
  failedRequests: string[];
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport, hasTouch: !desktop });
  const page = await ctx.newPage();

  const reports: PageReport[] = [];
  let current: PageReport | null = null;

  page.on('console', (msg) => {
    if (!current) return;
    const text = `${msg.text()}`.slice(0, 300);
    if (msg.type() === 'error') current.consoleErrors.push(text);
    else if (msg.type() === 'warning') current.consoleWarnings.push(text);
  });
  page.on('pageerror', (err) => {
    if (current) current.pageErrors.push(String(err).slice(0, 300));
  });
  page.on('response', (res) => {
    if (current && res.status() >= 400) {
      current.failedRequests.push(`${res.status()} ${res.url().slice(0, 160)}`);
    }
  });

  // Sign in as demo user first.
  current = { path: '/sign-in', ms: 0, consoleErrors: [], consoleWarnings: [], pageErrors: [], failedRequests: [] };
  const t0 = Date.now();
  await page.goto(`${BASE}/sign-in`);
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard', { timeout: 30_000 });
  current.ms = Date.now() - t0;
  reports.push(current);

  for (const path of PAGES) {
    current = { path, ms: 0, consoleErrors: [], consoleWarnings: [], pageErrors: [], failedRequests: [] };
    const t = Date.now();
    try {
      await page.goto(`${BASE}${path}`, { waitUntil: 'load', timeout: 30_000 });
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
      current.ms = Date.now() - t;
      await page.screenshot({ path: `${OUT}/${tag}${path.replace(/\//g, '_')}.png`, fullPage: true });
    } catch (e) {
      current.pageErrors.push(`NAVIGATION FAILED: ${String(e).slice(0, 200)}`);
      current.ms = Date.now() - t;
    }
    reports.push(current);
  }

  await browser.close();
  fs.writeFileSync(`${OUT}/report-${tag}.json`, JSON.stringify(reports, null, 2));

  // Console summary
  for (const r of reports) {
    const flags = [
      r.consoleErrors.length ? `console-errors:${r.consoleErrors.length}` : '',
      r.pageErrors.length ? `PAGE-ERRORS:${r.pageErrors.length}` : '',
      r.failedRequests.length ? `failed-req:${r.failedRequests.length}` : '',
      r.ms > 3000 ? 'SLOW' : '',
    ].filter(Boolean).join(' ');
    console.log(`${r.path.padEnd(18)} ${String(r.ms).padStart(5)}ms  ${flags}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
