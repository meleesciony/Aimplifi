/**
 * Backfill button at PLAIN pacing (#167): "Re-run categorizer" must (a) report
 * an honest result and (b) leave the visible queue COHERENT with that report —
 * "Auto-filed N" while the N rows still sit in the inbox is the failure. The
 * old code router.refresh()ed, which never updated TriageInbox's client-held
 * groups at all. Reads data-remaining on [data-testid=triage-inbox].
 */
import { chromium, devices } from '@playwright/test';

const BASE = 'http://127.0.0.1:3100';

(async () => {
  const browser = await chromium.launch(process.env.CHAN ? { channel: process.env.CHAN } : {});
  const ctx = await browser.newContext({
    ...(process.env.PIXEL === '1' ? devices['Pixel 5'] : {}),
    viewport: { width: 380, height: 800 },
    serviceWorkers: (process.env.SW === '0' ? 'block' : 'allow') as 'block' | 'allow',
  });
  const page = await ctx.newPage();
  page.on('requestfailed', (r) => console.log(`FAIL ${r.url().slice(21, 90)} :: ${r.failure()?.errorText}`));
  page.on('pageerror', (e) => console.log(`PAGEERR ${String(e).slice(0, 250)}`));

  await page.goto(`${BASE}/sign-in`);
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard', { timeout: 30_000 });
  await page.goto(`${BASE}/triage`);
  await page.waitForLoadState('networkidle');

  let failures = 0;
  const remaining = async () =>
    (await page.getByTestId('triage-inbox').getAttribute('data-remaining').catch(() => null)) ?? 'empty';
  const beforeRemaining = await remaining();
  console.log(`queue before: remaining=${beforeRemaining}`);

  console.log('--- RUN BACKFILL ---');
  await page.getByTestId('backfill-run').click();
  let msg: string | null = null;
  try {
    await page
      .locator('[data-testid="backfill-result"], [data-testid="backfill-error"]')
      .first()
      .waitFor({ state: 'visible', timeout: 20_000 });
    msg =
      (await page.getByTestId('backfill-result').textContent().catch(() => null)) ??
      (await page.getByTestId('backfill-error').textContent().catch(() => null));
    console.log(`message: "${msg?.trim()}"`);
  } catch {
    console.log('BACKFILL FAILED — no result or error message within 20s');
    failures++;
  }

  const m = msg?.match(/Auto-filed (\d+)/);
  if (m) {
    const refiled = Number(m[1]);
    // Coherence: the visible queue must have shrunk (or gone empty) to match.
    try {
      await page.waitForFunction(
        (prev) => {
          const el = document.querySelector('[data-testid="triage-inbox"]');
          if (!el) return true; // triage-empty state — queue fully drained
          return Number(el.getAttribute('data-remaining')) < prev;
        },
        Number(beforeRemaining === 'empty' ? 0 : beforeRemaining),
        { timeout: 8000 },
      );
      console.log(`COHERENT — queue shrank after auto-filing ${refiled}`);
    } catch {
      console.log(
        `INCOHERENT — "Auto-filed ${refiled}" but remaining=${await remaining()} (was ${beforeRemaining})`,
      );
      failures++;
    }
  } else {
    console.log('no rows refiled — coherence check not applicable this run');
  }

  console.log(failures === 0 ? 'PROBE PASS' : `PROBE FAIL (${failures})`);
  await browser.close();
  process.exit(failures === 0 ? 0 : 1);
})();
