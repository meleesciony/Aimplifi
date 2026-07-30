/**
 * O.15 slice 1 — nothing the app CLAIMS is a dead end.
 *
 * Owner's verdict, 2026-07-30: "no cohesion in the app… most def not at parity
 * with Mint/Simplifi." The concrete defect behind it: surfaces named a merchant
 * and stopped there. /recurring would state "you pay Netflix $15.99/mo" and the
 * Today feed would state a charge was "larger than the typical $11.56 there",
 * and neither name did anything — the only affordance on a nudge was Dismiss.
 * The rule this spec enforces is that a named merchant is always a way in to the
 * rows behind the claim.
 *
 * WHY AN E2E AND NOT JUST THE UNIT LOCK: merchant-register-links.test.ts proves
 * the href is built and decoded correctly, which is a fact about a string. It
 * cannot see whether the string is on the page. The O.13b lesson in this repo is
 * exactly that gap — a banner that typechecked, built, and passed 225 e2e tests
 * while rendering nothing, because a server component imported a constant from a
 * 'use client' module and got a stub. Only a rendered-page assertion catches
 * that class, so this walks the real routes and reads the real DOM.
 *
 * Render-only: every assertion here navigates and reads. Nothing mutates, so
 * this is safe against the shared demo row (the #182/#234 precedent).
 */
import { expect, test, type Page } from './helpers/test';

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard', { timeout: 20000 });
}

/**
 * Every merchant link in the app points at the register filtered to that name.
 * Asserts the href is well-formed AND that its parameter decodes back to the
 * link's own visible text — the property that makes the destination the rows the
 * reader just read about, rather than an empty page.
 */
async function expectMerchantLink(
  page: Page,
  testId: string,
  /**
   * How the visible text relates to the merchant, for surfaces that wrap the name
   * in a phrase ("View charges at X"). Defaults to the name alone. Required as a
   * FUNCTION of the merchant rather than a literal so the assertion still pins
   * the exact name and cannot be satisfied by a truncation.
   */
  expectedText?: (merchant: string) => string,
) {
  const link = page.getByTestId(testId).first();
  await expect(link).toBeVisible();

  const href = await link.getAttribute('href');
  expect(href, `${testId} must carry an href`).toBeTruthy();

  const url = new URL(href!, 'https://www.aimplifi.app');
  expect(url.pathname).toBe('/transactions');
  const merchant = url.searchParams.get('merchant');
  expect(merchant, `${testId} must filter by a merchant`).toBeTruthy();

  // The link's parameter must be EXACTLY the name the reader tapped.
  //
  // `toBe`, never `toContain`, and the first draft of this got it wrong in a way
  // worth recording: a substring check can never catch truncation, because
  // truncation always produces a substring. An unescaped "Barnes & Noble" yields
  // the parameter "Barnes ", and `"Barnes & Noble".includes("Barnes ")` is true —
  // so the assertion whose comment claimed to catch an encoding regression passed
  // on precisely that regression. Same for "A#1 Auto" → "A".
  const text = (await link.innerText()).trim();
  expect(text.length, `${testId} must have visible text`).toBeGreaterThan(0);
  const expected = expectedText ? expectedText(merchant!) : merchant!;
  expect(text).toBe(expected);
}

test('the register row merchant name still links (builder refactor regression)', async ({ page }) => {
  // O.15 moved four inline `?merchant=` template literals onto one builder. This
  // is the oldest of the four and the one with e2e coverage elsewhere; asserting
  // it here means the refactor cannot silently change where the original links
  // land while the new surfaces look fine.
  await signIn(page);
  await page.goto('/transactions');
  await expectMerchantLink(page, 'txn-merchant-link');
});

test('/recurring — the merchant in every row and every upcoming renewal is a way in', async ({ page }) => {
  await signIn(page);
  await page.goto('/recurring');

  // Assert the hard case is PRESENT before asserting anything about it: a
  // `getByTestId(...).first()` over an empty list passes vacuously, and this
  // page is the whole reason the slice exists.
  await expect(page.getByTestId('recurring-merchant-link').first()).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('recurring-row').first()).toBeVisible();
  await expectMerchantLink(page, 'recurring-merchant-link');

  const rows = await page.getByTestId('recurring-row').count();
  const links = await page.getByTestId('recurring-merchant-link').count();
  // EVERY row, not merely one: the defect was systemic, and a single linked row
  // beside nine plain ones is the same dead end for a reader who taps a different
  // one. Equality also catches a future row variant added without a link.
  expect(links, 'every recurring row names a merchant and so every row links').toBe(rows);
});

test('/recurring — the coming-up list links too', async ({ page }) => {
  await signIn(page);
  await page.goto('/recurring');
  const comingUp = page.getByTestId('coming-up-row');
  // The demo seed's renewal window is data-dependent, so this list can legitimately
  // be empty. Assert the invariant that matters either way — no row may exist
  // WITHOUT its link — rather than pretending a count is guaranteed.
  const rowCount = await comingUp.count();
  const linkCount = await page.getByTestId('coming-up-merchant-link').count();
  expect(linkCount, 'no coming-up row may name a merchant without linking it').toBe(rowCount);
  if (rowCount > 0) await expectMerchantLink(page, 'coming-up-merchant-link');
});

test('the Today feed offers a way to check the charge it is talking about', async ({ page }) => {
  await signIn(page);
  await expect(page.getByTestId('today-feed-card')).toBeVisible({ timeout: 20000 });

  // The demo seed renders an unusual-charge nudge (today-feed.spec.ts asserts the
  // same row), and that proposal carries a merchant — so this link must exist.
  // Before O.15 the only control on this row was Dismiss: the app made a claim
  // about a named merchant and offered no way to check it.
  await expect(page.getByTestId('nudge-unusual_charge')).toBeVisible();
  await expectMerchantLink(page, 'nudge-merchant-link-unusual_charge', (m) => `View charges at ${m}`);
});

test('an income row says deposits, not charges', async ({ page }) => {
  // A paycheck is not a charge. The feed's own copy is audited to describe money
  // that did not ARRIVE and never says "spent" — and a link added beside money
  // copy is money copy. `income_pause` is one of exactly two kinds carrying a
  // merchant, so half the feed's links sit on income rows.
  await signIn(page);
  await expect(page.getByTestId('today-feed-card')).toBeVisible({ timeout: 20000 });
  const incomeRow = page.getByTestId('nudge-income_pause');
  if ((await incomeRow.count()) === 0) return; // data-dependent on the seed
  const link = page.getByTestId('nudge-merchant-link-income_pause').first();
  await expect(link).toBeVisible();
  await expect(link).toContainText('View deposits from');
  await expect(link).not.toContainText('charges');
});

test('/trends — the merchants it names open their own rows', async ({ page }) => {
  await signIn(page);
  await page.goto('/trends');
  // "Largest purchases" is a list of single charges the reader is invited to
  // examine; "New this month" is a card whose entire subject is a name they have
  // never seen. Both were plain text until this slice.
  await expect(page.getByTestId('trends-largest-merchant-link').first()).toBeVisible({ timeout: 20000 });
  await expectMerchantLink(page, 'trends-largest-merchant-link');
});

test('the coach page merchant and flow claims are links', async ({ page }) => {
  await signIn(page);
  await page.goto('/coach');

  // The two merchant links on this page had NO rendered assertion in the first
  // draft of this spec — the test named for the coach page asserted only the
  // creep link. That is exactly the hole this file's docblock argues against, so
  // a critic finding it is a finding about the test, not about the code.
  await expectMerchantLink(page, 'coach-opportunity-link');
  await expectMerchantLink(page, 'life-energy-merchant-link');

  // The lifestyle-creep verdict is a claim about a SET of transactions, so the
  // verdict itself opens that set — spending when it is flagged, income when it
  // is not. Asserted by pathname + type rather than by which branch rendered,
  // because either is a legitimate state of the demo data.
  const creep = page.getByTestId('coach-creep-link');
  await expect(creep).toBeVisible({ timeout: 20000 });
  const creepHref = new URL((await creep.getAttribute('href'))!, 'https://www.aimplifi.app');
  expect(creepHref.pathname).toBe('/transactions');
  expect(['expense', 'income']).toContain(creepHref.searchParams.get('type'));
});

test('following a merchant link actually lands on that merchant’s rows', async ({ page }) => {
  // The end-to-end claim the whole slice rests on. Every assertion above is about
  // an href attribute; this one follows it and reads what the reader would see.
  // A link that is present, well-formed, and lands on an unfiltered register is
  // still a dead end — worse, it silently shows a much larger set than the name
  // promised, with no error and an HTTP 200.
  await signIn(page);
  await page.goto('/recurring');
  const link = page.getByTestId('recurring-merchant-link').first();
  await expect(link).toBeVisible({ timeout: 20000 });
  const name = (await link.innerText()).trim();

  await link.click();
  await page.waitForURL('**/transactions?merchant=*', { timeout: 20000 });

  // Assert on the ROWS, not on the Merchant Lens card. The lens is the obvious
  // landmark and it is the wrong one to hang this on: `transactions/page.tsx`
  // renders it as `{lens && <MerchantLensCard/>}` and the engine abstains on thin
  // history, so a merchant with few charges would fail this test for a reason
  // that has nothing to do with the link. The rows are unconditional.
  const landed = page.getByTestId('txn-merchant-link');
  await expect(landed.first()).toBeVisible({ timeout: 20000 });

  // EVERY row on the page is the merchant that was clicked. A link that landed on
  // an unfiltered register would show a mix — the exact silent failure (a much
  // larger set than the name promised, HTTP 200, no error) this slice must not
  // ship, and one that asserting `.first()` alone would sail straight past.
  const names = await landed.allInnerTexts();
  expect(names.length).toBeGreaterThan(0);
  for (const shown of names) expect(shown.trim()).toBe(name);
});
