/**
 * Phase 3 golden flow (380×800): FI Coach — savings rate headline parity,
 * FI card with the live slider, opportunities, creep, runway, life-energy
 * toggle, and the monthly Money Review.
 */
import { expect, test } from './helpers/test';

test('coach page: savings rate, FI slider moves the date live, life-energy toggle, money review', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');

  // headline parity on the dashboard: savings rate next to net worth
  await expect(page.getByTestId('net-worth-card')).toBeVisible();
  await expect(page.getByTestId('savings-rate-card')).toBeVisible();

  await page.getByTestId('bottom-nav-coach').click();
  await page.waitForURL('**/coach');

  // FI number present and formatted
  await expect(page.getByTestId('fi-number')).toContainText('$');
  await expect(page.getByTestId('savings-rate-amount')).toContainText('%');
  // Wave 1.4: demo seed has consecutive positive full months → streak and/or PB line
  await expect(page.getByTestId('savings-rate-streak').or(page.getByTestId('savings-rate-personal-best'))).toBeVisible();

  // W.2 — the FI card states the basis its dates were computed on, in the browser, on the
  // demo. The demo user has no stored `inflationBps`, so this is the DEFAULTED branch: the
  // card may not call Aimplifi's own 2.50% "yours" while /settings calls the same number "our
  // defaults" (the possessive rule the wealth card one slice earlier had to learn).
  const basis = page.getByTestId('fi-projection-basis');
  await expect(basis).toContainText("today's money");
  await expect(basis).toContainText('4.50%'); // 7.00% nominal less the 2.50% default
  await expect(basis).toContainText('our default 2.50% inflation assumption');
  await expect(basis).not.toContainText('your 2.50%');
  // W.13 — and the same is true of the OTHER dial on the same line, which this sentence went
  // on calling "your 7.00% return assumption" for four slices while correctly disclaiming the
  // inflation half one clause later. `expectedReturnBps` is non-nullable with the app's own 700
  // as its default, so the demo — and every reader who has never opened /settings — is here.
  await expect(basis).toContainText('our default 7.00% return assumption');
  await expect(basis).not.toContainText('your 7.00%');

  // W.12 — payoff sits ABOVE the basis paragraph (fold), and neither the headline nor Coast
  // restates the 4.50% the basis owns. Measured on the painted card, not the copy functions.
  const years = page.getByTestId('years-to-fi');
  const payoff = page.getByTestId('freedom-dividend');
  const coast = page.getByTestId('coast-fi');
  await expect(years).not.toContainText('4.50%');
  await expect(payoff).not.toContainText('4.50%');
  await expect(coast).not.toContainText('4.50%');
  const payoffBox = await payoff.boundingBox();
  const basisBox = await basis.boundingBox();
  expect(payoffBox).toBeTruthy();
  expect(basisBox).toBeTruthy();
  expect(payoffBox!.y).toBeLessThan(basisBox!.y);

  // W.9 — the Coast horizon says the app chose it. An unlabelled "25 years" beside a monthly
  // dollar figure is the shape the owner called "arbitrary time" on the card below.
  await expect(coast).toContainText('not a date you set');

  // W.11 — first paint is the unchanged branch. A hard 70% ceiling used to clamp a high
  // saver and fire "Lowering your savings rate…" before anyone dragged; the demo sits
  // below 70%, so this also locks the ordinary case.
  const before = await page.getByTestId('slider-result').textContent();
  expect(before ?? '').toContain('current pace');
  expect(before ?? '').not.toMatch(/Lowering|Raising/);

  // interactive slider: dragging to a different rate CHANGES the live caption
  await page.getByTestId('fi-slider').fill('6000'); // 60% savings rate
  const after = await page.getByTestId('slider-result').textContent();
  expect(after).not.toBe(before);
  await expect(page.getByTestId('slider-rate')).toHaveText('60%');

  // opportunities ranked with the unused gym present, estimates labeled
  await expect(page.getByTestId('opportunities-list')).toContainText('LA Fitness');
  await expect(page.getByTestId('opportunities-list')).toContainText('Netflix');
  await expect(page.getByTestId('opportunities-card')).toContainText('est.');

  // W.10 — the rendered figures are in today's money. This lives in the e2e and not only in
  // the unit locks because the defect class is a PROP: a unit test calls the copy with whatever
  // rate it chooses itself, so it cannot see the page handing over the wrong one.
  //
  // The GOLDEN below is what makes that real. LA Fitness is $34.99/mo on the demo seed, and
  // $20,350.61 is that amount grown at 7.00% for 360 months and deflated at 2.50% — the demo's
  // two dials. Hand the copy any other rate pair and this figure moves, which a phrase-level
  // assertion would never notice.
  await expect(page.getByTestId('opportunities-list')).toContainText("in today's money");
  await expect(page.getByTestId('opportunities-list')).toContainText('$20,350.61 in today\'s money over 30 years');
  await expect(page.getByTestId('opportunities-list')).not.toContainText('future wealth');
  // The provenance sentence renders once, beside the rows, naming both dials in their roles.
  //
  // W.13 — and naming WHOSE they are. The demo user has never opened /settings, so both dials
  // hold the app's own numbers and the sentence may not call either one the reader's. This is
  // the rendered half of the fix: the flag is computed in `getCoachData` and threaded through
  // the page, so a unit test on the copy function cannot see the page handing over the wrong
  // answer — which is the same reason the golden figure above lives here.
  await expect(page.getByTestId('opportunities-basis')).toContainText(
    'our default 7.00% return assumption',
  );
  await expect(page.getByTestId('opportunities-basis')).not.toContainText(
    'your 7.00% return assumption',
  );
  await expect(page.getByTestId('opportunities-basis')).toContainText(
    'our default 2.50% inflation assumption',
  );
  await expect(page.getByTestId('opportunities-basis')).toContainText('what the total would buy today');
  // W.10a critic — the payoff clause is now gated on the printed figures rather than on the
  // return dial alone, and the demo's 7.00%/2.50% is a pair where nothing trails. Asserting it
  // STILL renders is the half a unit test cannot see: the guard must be a predicate at the
  // render site, not a deletion. (The refusing direction is locked in fi-real-basis.test.ts,
  // where the dials that trail are ones no seeded user has.)
  await expect(page.getByTestId('opportunities-list')).toContainText(
    'compounding does the work, not willpower',
  );

  // creep flagged on the engineered seed rise — phrased as a question, not a verdict
  await expect(page.getByTestId('creep-verdict')).toContainText('not a verdict');

  // runway card
  await expect(page.getByTestId('runway-months')).toContainText('months');

  // #252 Money Signature: demo pinned copy (default-asOf narrative — see the
  // money-signature.test.ts seed lock for the hand math behind these literals).
  // Weather calm; saving habit steady 12/12 held since May 2025; spending
  // steadiness steady at 3.0% typical variation (spreadBps 296).
  await expect(page.getByTestId('money-signature-card')).toBeVisible();
  await expect(page.getByTestId('signature-weather')).toContainText('calm');
  await expect(page.getByTestId('signature-weather')).toContainText('cash ÷ your 6-month average expenses');
  await expect(page.getByTestId('signature-saving')).toContainText('12 of your last 12 full months with income');
  await expect(page.getByTestId('signature-saving')).toContainText('May 2025');
  await expect(page.getByTestId('signature-steadiness')).toContainText('3.0%');
  await expect(page.getByTestId('signature-steadiness')).toContainText('median');
  await expect(page.getByTestId('money-signature-card')).toContainText('3 months in a row');

  // P1.2 staying-wealthy row: composes the three engines already on this
  // page. Demo has a 17-month cleared streak and a positive runway (calm
  // weather ≥ 3 months). Income label must match the creep card's state —
  // never a fabricated "all three true".
  await expect(page.getByTestId('staying-wealthy-card')).toBeVisible();
  await expect(page.getByTestId('staying-wealthy-framing')).toHaveText(
    'Getting wealthy and staying wealthy are different skills.',
  );
  await expect(page.getByTestId('staying-wealthy-cards')).toContainText('every card clears in full');
  await expect(page.getByTestId('staying-wealthy-cards')).toHaveAttribute('data-present', 'true');
  const runwayTitle = ((await page.getByTestId('runway-months').textContent()) ?? '').trim();
  const runwayMonths = runwayTitle.match(/^([\d.]+) months$/);
  expect(runwayMonths, 'Coach runway title is N months').toBeTruthy();
  await expect(page.getByTestId('staying-wealthy-runway')).toContainText(
    `${runwayMonths![1]}-month cushion`,
  );
  const creepTitle = ((await page.getByTestId('creep-title').textContent()) ?? '').trim();
  if (creepTitle === 'Tracking income') {
    await expect(page.getByTestId('staying-wealthy-income')).toContainText(
      'spending is tracking income',
    );
  } else if (creepTitle === 'Spending is outpacing income') {
    await expect(page.getByTestId('staying-wealthy-income')).toContainText(
      'spending outpaced income recently',
    );
  } else {
    await expect(page.getByTestId('staying-wealthy-income')).toContainText(
      "spending vs income isn't comparable yet",
    );
  }

  // #254 Habit streaks: demo pinned copy (default-asOf narrative — see the
  // cleared-streak / creep-streak seed locks for the hand math). Cleared-in-full
  // 17 months across 4 cards through May 2026; no-creep 3 full months with the
  // Netflix $15.49 → $17.99 (Feb 2026) increase as the last break, facts inline.
  await expect(page.getByTestId('habit-streaks-card')).toBeVisible();
  await expect(page.getByTestId('card-cleared-streak')).toContainText('17 months in a row');
  await expect(page.getByTestId('card-cleared-streak')).toContainText('paid in full by its due date');
  await expect(page.getByTestId('card-cleared-streak')).toContainText('(4 cards, 59 statements)');
  await expect(page.getByTestId('no-creep-streak')).toContainText('3 full months');
  await expect(page.getByTestId('no-creep-last-increase')).toContainText('Netflix, $15.49 → $17.99 in Feb 2026');

  // life-energy toggle flips $ → hours
  const firstRow = page.getByTestId('life-energy-list').locator('li').first();
  await expect(firstRow).toContainText('$');
  await page.getByTestId('life-energy-toggle').click();
  await expect(firstRow).toContainText('hrs');

  // Money Review: one improvement, one creep, one concrete next action.
  // In demo (no AI key) the §2.4 recap is the DETERMINISTIC floor — same three role lines,
  // and NO "Personalized" badge (the LLM ordering path only runs with a key).
  await expect(page.getByTestId('review-improvement')).not.toBeEmpty();
  await expect(page.getByTestId('review-creep')).not.toBeEmpty();
  await expect(page.getByTestId('review-next-action')).toContainText('One next action');
  await expect(page.getByTestId('review-personalized-badge')).toHaveCount(0);

  // Wave 1.3 value receipts: visiting /coach mints the seed's single price-increase
  // catch (Netflix $15.49 → $17.99 = $2.50/mo, keyed on its change date), so the
  // "What Aimplifi caught" card shows the tally — and a reload doesn't double-count
  // (the mint is idempotent per key).
  await expect(page.getByTestId('value-receipts-card')).toBeVisible();
  await expect(page.getByTestId('value-receipts-headline')).toContainText('1 catch so far');
  await expect(page.getByTestId('value-receipts-lines')).toContainText(
    '1 quiet price increase flagged — $2.50/mo in total.',
  );
  await page.reload();
  await expect(page.getByTestId('value-receipts-headline')).toContainText('1 catch so far');

  // the educational disclaimer is on the page (global footer)
  await expect(page.locator('text=not financial advice')).toBeVisible();
});

