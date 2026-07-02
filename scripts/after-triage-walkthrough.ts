/**
 * Phase-5 AFTER walkthrough (PULSE_CATEGORIZATION_FIX): drive the REBUILT
 * merchant-group triage over the IDENTICAL messy 60-day dataset (same corpus,
 * same seed, same user-intent labels) and measure the after side of the
 * before/after comparison. Produces:
 *   docs/baseline/phase5/shots/*.png     - screenshots of each distinct UI state
 *   docs/baseline/phase5/after-run.json  - the full interaction log + metrics
 *
 * User policy (naive-efficient, same intent labels as Phase 2):
 *   - group suggestion matches the human label -> "File all N" (1 tap)
 *   - otherwise -> Pick (1 tap) -> quick-pick if it is one of the 3 (1 tap),
 *     else search (1 interaction) + tap the category row (1 tap) - files the GROUP
 * Interactions counted = taps + search-fills; human time via the documented
 * 4.0s budget + raw bot wall-clock, labeled separately.
 */
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, devices } from '@playwright/test';
import { testDbUrl } from '../tests/setup/test-db';
import { CATEGORIES } from '../src/lib/engine/categorize/categories';
import { BASELINE_EMAIL, BASELINE_PASSWORD, MESSY_MERCHANTS } from './messy-corpus';

const PORT = 3112;
const BASE = `http://127.0.0.1:${PORT}`;
const DB_URL = testDbUrl('baseline');
const OUT_DIR = path.join(process.cwd(), 'docs', 'baseline', 'phase5');
const SHOTS = path.join(OUT_DIR, 'shots');
const ACTION_TIMEOUT = 45_000;

const nameById = new Map(CATEGORIES.map((c) => [c.id, c.name]));
const intendedByRaw = new Map<string, { id: string; name: string; merchant: string }>();
for (const m of MESSY_MERCHANTS) {
  for (const v of m.variants) {
    intendedByRaw.set(v, { id: m.intended, name: nameById.get(m.intended) ?? m.intended, merchant: m.name });
  }
}

interface LogEntry {
  i: number;
  kind: 'accept' | 'batch' | 'pick' | 'alt' | 'search' | 'option' | 'stall';
  merchant: string;
  raw: string;
  cardDate: string;
  suggestion: string;
  intended: string;
  remainingBefore: number;
  remainingAfter: number;
  ms: number;
}

async function waitForServer(): Promise<void> {
  const deadline = Date.now() + 90_000;
  for (;;) {
    try {
      const res = await fetch(`${BASE}/sign-in`);
      if (res.status === 200) return;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error('server did not come up on ' + BASE);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function main(): Promise<void> {
  fs.mkdirSync(SHOTS, { recursive: true });
  for (const f of fs.readdirSync(SHOTS)) fs.unlinkSync(path.join(SHOTS, f)); // no stale evidence
  const env = { ...process.env, DATABASE_URL: DB_URL };

  console.log('[baseline] db:', DB_URL);
  execSync('npx prisma db push --accept-data-loss', { stdio: 'inherit', env });
  execSync('npx tsx scripts/set-sqlite-wal.ts', { stdio: 'inherit', env });
  execSync('npx tsx scripts/messy-categorization-seed.ts', { stdio: 'inherit', env });

  const serverLog = fs.openSync(path.join(OUT_DIR, 'server.log'), 'w');
  const server = spawn('npx', ['next', 'start', '-p', String(PORT)], {
    env, shell: true, stdio: ['ignore', serverLog, serverLog],
  });
  const killServer = () => {
    try { execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: 'ignore' }); } catch { /* already gone */ }
  };

  try {
    await waitForServer();
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 380, height: 800 } });
    const page = await ctx.newPage();
    page.setDefaultTimeout(ACTION_TIMEOUT);

    // ── sign in ──
    await page.goto(`${BASE}/sign-in`);
    await page.getByTestId('auth-email').fill(BASELINE_EMAIL);
    await page.getByTestId('auth-password').fill(BASELINE_PASSWORD);
    await page.getByTestId('auth-submit').click();
    await page.waitForURL('**/dashboard', { timeout: 30_000 });

    // ── triage: initial load ──
    const t0 = Date.now();
    await page.goto(`${BASE}/triage`);
    await page.getByTestId('triage-inbox').waitFor();
    const loadMs = Date.now() - t0;
    const initial = Number(await page.getByTestId('triage-inbox').getAttribute('data-remaining'));
    await page.screenshot({ path: path.join(SHOTS, '01-initial-queue.png'), fullPage: false });
    console.log(`[baseline] /triage loaded in ${loadMs}ms; queue = ${initial} items`);

    // When the last card clears, the inbox wrapper is REPLACED by the empty state —
    // so a missing wrapper means 0, not "wait 45s and die at the finish line".
    const remaining = async () =>
      page.evaluate(() => {
        const el = document.querySelector('[data-testid="triage-inbox"]');
        return el ? Number(el.getAttribute('data-remaining')) : 0;
      });

    const log: LogEntry[] = [];
    const shotsTaken = new Set<string>();
    const shotOnce = async (name: string) => {
      if (shotsTaken.has(name)) return;
      shotsTaken.add(name);
      await page.screenshot({ path: path.join(SHOTS, name) });
    };

    let stalls = 0;
    let interactions = 0;
    const started = Date.now();
    // Worst case is 3 interactions per card (pick + search + option) — cap well above
    // it so the cap only catches a genuine no-progress loop, never the honest cost.
    const cap = initial * 4 + 100;

    const persist = (aborted: string | null) => {
      const taps0 = log.filter((e) => e.kind !== 'stall').length;
      const byKind0: Record<string, number> = {};
      for (const e of log) byKind0[e.kind] = (byKind0[e.kind] ?? 0) + 1;
      fs.writeFileSync(
        path.join(OUT_DIR, 'after-run.json'),
        JSON.stringify({ db: DB_URL, aborted, initialQueue: initial, loadMs, interactions: taps0, byKind: byKind0, wallClockMs: Date.now() - started, modeledHumanSeconds: taps0 * 4.0, stalls, log }, null, 2),
      );
    };

    try {
    while ((await remaining()) > 0) {
      if (interactions > cap) { persist('interaction-cap'); throw new Error(`interaction cap ${cap} exceeded — aborting (partial log persisted)`); }
      const before = await remaining();
      const card = page.getByTestId('triage-card');
      // Group card: the first font-mono line is one of the group's raw variants.
      const raw = (await card.locator('p.font-mono').first().textContent())?.trim() ?? '';
      const cardDate = (await page.getByTestId('triage-group-meta').textContent())?.trim() ?? '';
      const suggestion =
        (await page.getByTestId('triage-suggestion').textContent({ timeout: 500 }).catch(() => null))?.trim() ?? '';
      const intended = intendedByRaw.get(raw) ?? { id: 'uncategorized', name: 'Uncategorized', merchant: `?? ${raw}` };

      const record = (kind: LogEntry['kind'], ms: number, after: number) => {
        interactions += 1;
        log.push({ i: interactions, kind, merchant: intended.merchant, raw, cardDate, suggestion, intended: intended.name, remainingBefore: before, remainingAfter: after, ms });
      };
      const stalled = async (label: string) => {
        stalls += 1;
        await shotOnce(`90-stall-${stalls}.png`);
        log.push({ i: interactions, kind: 'stall', merchant: intended.merchant, raw, cardDate, suggestion, intended: intended.name, remainingBefore: before, remainingAfter: before, ms: ACTION_TIMEOUT });
        console.error(`[baseline] STALL #${stalls} during ${label} on "${raw}"`);
        if (stalls >= 2) { persist('stalls'); throw new Error('2 stalls — aborting with partial log (environmental, STATUS #16/#17)'); }
      };

      await shotOnce('02-top-card.png');

      const groupCleared = async () =>
        page.waitForFunction(
          (n) => {
            const el = document.querySelector('[data-testid="triage-inbox"]');
            return el === null || Number(el.getAttribute('data-remaining')) < n;
          },
          before,
          { timeout: ACTION_TIMEOUT },
        );
      if (suggestion !== '' && suggestion === intended.name) {
        const a0 = Date.now();
        try {
          await page.getByTestId('triage-accept').click(); // files the WHOLE group
          await groupCleared();
          record('accept', Date.now() - a0, await remaining());
          await shotOnce('05-file-all.png');
        } catch { await stalled('accept'); }
      } else {
        // wrong suggestion → Pick, then alternative or search+row
        const a0 = Date.now();
        try {
          await page.getByTestId('triage-more').click();
          await page.getByTestId('triage-alternatives-panel').waitFor();
          record('pick', Date.now() - a0, before);
          await shotOnce('03-alternatives.png');

          const alt = page.getByTestId('triage-alternatives').getByRole('button', { name: intended.name, exact: true });
          const b0 = Date.now();
          if (await alt.isVisible().catch(() => false)) {
            await alt.click();
            await groupCleared();
            record('alt', Date.now() - b0, await remaining());
          } else {
            await page.getByTestId('triage-cat-search').fill(intended.name);
            record('search', Date.now() - b0, before);
            await shotOnce('04-picker-search.png');
            const c0 = Date.now();
            const exact = new RegExp(`^\\s*${intended.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);
            await page.getByTestId('triage-cat-option').filter({ hasText: exact }).first().click();
            await groupCleared();
            record('option', Date.now() - c0, await remaining());
          }
        } catch { await stalled('pick-path'); }
      }

      const now = await remaining();
      if (initial >= 4 && now <= Math.floor(initial / 2) && !shotsTaken.has('07-halfway.png')) {
        await shotOnce('07-halfway.png');
      }
    }
    } catch (e) {
      persist('crash'); // whatever happened, the interaction log survives
      throw e;
    }

    const wallMs = Date.now() - started;
    await page.getByTestId('triage-empty').waitFor();
    await page.screenshot({ path: path.join(SHOTS, '08-empty.png') });

    // ── metrics ──
    const taps = log.filter((e) => e.kind !== 'stall').length;
    const byKind: Record<string, number> = {};
    for (const e of log) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
    const modeledHumanSeconds = taps * 4.0; // documented budget, phase2-triage.spec.ts:9-11
    const result = {
      db: DB_URL, initialQueue: initial, loadMs, interactions: taps, byKind,
      wallClockMs: wallMs, modeledHumanSeconds, stalls,
      perActionMsP50: [...log.map((e) => e.ms)].sort((a, b) => a - b)[Math.floor(log.length / 2)] ?? 0,
      perActionMsMax: Math.max(...log.map((e) => e.ms), 0),
      log,
    };
    fs.writeFileSync(path.join(OUT_DIR, 'after-run.json'), JSON.stringify(result, null, 2));
    console.log('[baseline] DONE', JSON.stringify({ initialQueue: initial, loadMs, interactions: taps, byKind, wallClockMs: wallMs, modeledHumanSeconds, stalls }));

    await browser.close();
  } finally {
    if (!process.argv.includes('--keep-server')) killServer();
    fs.closeSync(serverLog);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
