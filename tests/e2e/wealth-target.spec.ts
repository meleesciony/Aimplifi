/**
 * Wealth target on /coach — the "$10M, what do I need to do?" card.
 *
 * What this spec is for: the engine's own suite proves the arithmetic, and a pure-engine
 * test can never see whether the numbers reach the page or whether the controls are wired
 * to them (the L.31 lesson — a unit test on a converter proves the arithmetic, never the
 * intake). So every assertion here is about the RENDERED card changing when the reader
 * acts, plus the two claims the copy makes that a reader would be misled by if they were
 * silently dropped: today's-dollars basis, and the return spread.
 */
import { expect, test } from './helpers/test';

test('wealth target: typing a target and dragging the horizon move the live answer', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');

  await page.getByTestId('bottom-nav-coach').click();
  await page.waitForURL('**/coach');

  const card = page.getByTestId('wealth-target-card');
  await expect(card).toBeVisible();

  // The basis is stated on the card itself, never left to a footnote: both the
  // today's-dollars reading and the after-inflation rate it was computed at.
  const basis = page.getByTestId('wealth-target-basis');
  await expect(basis).toContainText("today's money");
  await expect(basis).toContainText('after inflation');

  // ---- The three inputs that used to be invisible (owner, 2026-07-31) ------------------
  // "I set 10 mil and it gave me some arbitrary savings for arbitrary time." The figures were
  // consistent; the card rendered no control and no figure for the inputs that decided them.

  // 1. The STARTING BALANCE. Every figure on this card grows from it, so a reader who cannot
  //    see it has no way to believe an instalment computed against it — and it must say which
  //    accounts it counts, because it is INVESTMENT rows only.
  const startingFrom = page.getByTestId('wealth-target-starting-from');
  await expect(startingFrom).toBeVisible();
  await expect(startingFrom).toContainText('investment accounts');
  await expect(startingFrom).toContainText('checking and savings');
  // The assumption that makes compounding a cash leftover at an investing rate coherent.
  await expect(startingFrom).toContainText('invested too rather than left as cash');

  // 2. The DIALS, named as the reader's own and reachable in one tap rather than described.
  const dials = page.getByTestId('wealth-target-dials');
  // The demo user has no stored `inflationBps`, so this is the DEFAULTED branch — the card must
  // not call Aimplifi's own 2.50% "yours" while /settings calls the same number "our defaults".
  await expect(dials).toContainText("Aimplifi's default");
  await expect(dials).not.toContainText('Both rates are yours');
  await expect(dials).toContainText('How long the target takes');
  await expect(page.getByTestId('wealth-target-dials-link')).toHaveAttribute(
    'href',
    '/settings#money-dials',
  );

  // 3. The HORIZON, seeded from the reader's own arrival instead of a constant 25. At the
  //    default target the demo's pace lands inside the control's range, so the slider must open
  //    on the first whole year that pace arrives — read out of the pace sentence itself rather
  //    than hard-coded, so this cannot quietly pass against a drifted seed.
  const paceText = (await page.getByTestId('wealth-target-pace').textContent()) ?? '';
  const arrival = /about (\d+) years?(?: (\d+) months?)?/.exec(paceText);
  expect(arrival, `pace line did not state an arrival: ${paceText}`).not.toBeNull();
  const arrivalMonths = Number(arrival![1]) * 12 + Number(arrival![2] ?? 0);
  const seededYears = Math.ceil(arrivalMonths / 12);
  await expect(page.getByTestId('wealth-target-horizon-value')).toHaveText(
    `${seededYears} year${seededYears === 1 ? '' : 's'}`,
  );
  await expect(page.getByTestId('wealth-target-horizon-basis')).toContainText('your current pace');
  // And the seed's whole point: the card OPENS self-consistent. The horizon is the first year
  // the current pace lands, so the required contribution cannot exceed what is already going in
  // — the two halves agree before the reader touches anything.
  await expect(page.getByTestId('wealth-target-additional')).toContainText(
    'at or below what you',
  );

  // Raising the target can only push the answer further out — the pace line must MOVE.
  const paceBefore = await page.getByTestId('wealth-target-pace').textContent();
  await page.getByTestId('wealth-target-amount').fill('$10,000,000');
  await expect(page.getByTestId('wealth-target-pace')).not.toHaveText(paceBefore ?? '');

  // $10M does not arrive within the slider's 40-year ceiling on this fixture, so the seed is
  // REFUSED rather than clamped: parking the control on 40 would present its ceiling as the
  // reader's trajectory. The fallback appears, and says plainly that nothing chose it.
  await expect(page.getByTestId('wealth-target-horizon-value')).toHaveText('25 years');
  await expect(page.getByTestId('wealth-target-horizon-basis')).toContainText(
    'Nothing has picked this date for you',
  );

  // The required-contribution half answers the deadline question, and dragging the
  // horizon changes it live (a shorter horizon demands more per month).
  const requiredAt25 = await page.getByTestId('wealth-target-required').textContent();
  await page.getByTestId('wealth-target-horizon').fill('10');
  await expect(page.getByTestId('wealth-target-horizon-value')).toHaveText('10 years');
  const requiredAt10 = await page.getByTestId('wealth-target-required').textContent();
  expect(requiredAt10).not.toBe(requiredAt25);
  expect(requiredAt10).toContain('/month');

  // A dragged slider is the READER'S date, and the card must say so — not "nothing has picked
  // this date for you", printed one line under the control they just moved.
  await expect(page.getByTestId('wealth-target-horizon-basis')).toContainText('you picked');

  // And the drag must SURVIVE a target edit that would otherwise seed successfully. Typing back
  // the default target re-enters the range where `seededHorizon` returns `seeded: true`, so an
  // implementation where the seed overrides the drag would move the slider off 10 here — which
  // the previous version of this assertion (a target that refuses the seed) could never catch.
  await page.getByTestId('wealth-target-amount').fill('$1,000,000');
  await expect(page.getByTestId('wealth-target-horizon-value')).toHaveText('10 years');
  await expect(page.getByTestId('wealth-target-horizon-basis')).toContainText('you picked');

  // A negative guilt-free figure must never be described as money the reader HAS. The demo
  // is overspent (`leftToSpendCents` = -$2,432.33, `overspent: true`), so this fixture
  // genuinely exercises the branch — asserted here so the lock cannot quietly degrade into
  // measuring only the affordable case if the seed ever changes.
  const additional = page.getByTestId('wealth-target-additional');
  await expect(additional).toContainText('no guilt-free figure to weigh it against');
  await expect(additional).not.toContainText('-$');
  await expect(additional).not.toContainText('guilt-free spending you have');

  // The two cards on this page rest on different bases; the newer one names the difference
  // rather than leaving a reader to reconcile two dates on their own.
  await expect(page.getByTestId('wealth-target-vs-fi')).toContainText('before inflation');

  // The sensitivity table always carries three rows — the spread is the point, and a
  // single confident date would hide it. Open the disclosure so the assertion is about
  // what the reader can actually SEE, not merely what is in the DOM.
  await page.getByTestId('wealth-target-sensitivity').locator('summary').click();
  const rows = page.getByTestId('wealth-target-sensitivity-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toBeVisible();
  // Each row names the nominal assumption AND what it deflates to.
  await expect(rows.first()).toContainText('after inflation');
});

/**
 * The input boundary. Both hostile critics broke the card here and a pure-engine test
 * could not have seen any of it: the crash lived in a `useMemo` during render, and the
 * stale-answer bug lived in the gap between what the box showed and what state held.
 */
test('wealth target: the amount box refuses rather than crashing or answering a stale number', async ({
  page,
}) => {
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
  await page.goto('/coach');

  const box = page.getByTestId('wealth-target-amount');
  const basis = page.getByTestId('wealth-target-basis');
  await expect(page.getByTestId('wealth-target-card')).toBeVisible();

  // A 14-digit paste used to reach `cents()`, throw mid-render, and unwind the WHOLE page
  // to the error boundary — every other coach card with it. The engine refuses instead.
  await box.fill('90000000000000');
  await expect(page.getByTestId('wealth-target-card')).toBeVisible();
  await expect(basis).toContainText('Enter a target between');
  // The card refuses as a whole: no date, no contribution, no sensitivity rows.
  await expect(page.getByTestId('wealth-target-pace')).toHaveCount(0);
  await expect(page.getByTestId('wealth-target-required')).toHaveCount(0);
  await expect(page.getByTestId('wealth-target-sensitivity-row')).toHaveCount(0);

  // Clearing the box must not leave the previous target's answer standing under an empty
  // field: the reader can see no number, so the card claims none.
  await box.fill('$25,000.00');
  await expect(basis).toContainText('$25,000.00');
  await box.fill('');
  await expect(basis).toContainText('Enter a target amount');
  await expect(basis).not.toContainText('$25,000.00');
  await expect(box).toHaveAttribute('aria-invalid', 'true');

  // Unparseable text is the same state — "ten million" is not a number this app reads.
  await box.fill('ten million');
  await expect(basis).toContainText('Enter a target amount');
  await expect(box).toHaveAttribute('aria-invalid', 'true');

  // And a real number brings the answer back, with the field no longer flagged.
  await box.fill('$2,000,000');
  await expect(basis).toContainText('$2,000,000.00');
  await expect(box).toHaveAttribute('aria-invalid', 'false');
  await expect(page.getByTestId('wealth-target-pace')).toBeVisible();
});
