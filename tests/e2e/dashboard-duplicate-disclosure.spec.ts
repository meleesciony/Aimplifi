/**
 * TASKS L.8 — the DASHBOARD stops double-counting a both-live duplicate card SILENTLY.
 *
 * The owner-reported shape (2026-07-24): one real Chase card arriving through TWO live Plaid
 * connections emits two full obligations, so the cash-needed hero carries the card twice and the
 * payment-reminders list asks him to pay it twice. #299 taught /cards to say so and deliberately
 * left this half open — a reader who never opens /cards met the inflated number and nothing else.
 *
 * FAIL-OLD: before this slice the dashboard rendered no `cards-duplicate` element at all, on either
 * card, so every disclosure assertion below fails against the old build.
 *
 * The two assertions that matter most are the ones that are NOT about the banner:
 *   1. the headline still equals the SUM of both rows — disclose, never silently adjust (#192 /
 *      #221 / DECISIONS #289: subtracting a suspected duplicate asserts two rows are one card,
 *      which only the user can confirm);
 *   2. the two rows paint DIFFERENT headings, because a disclosure that names one card twice tells
 *      the reader nothing (#296/#297/#298, now on a fourth surface).
 *
 * Seeding is direct-to-SQLite on the off-tree e2e DB (the duplicate-connections.spec.ts pattern). A
 * demo user cannot be used: EXCLUDED_PROVIDERS drops every demo row before pairing.
 */
import AxeBuilder from '@axe-core/playwright';
import Database from 'better-sqlite3';
import { expect, test, type Page } from './helpers/test';
import { E2E_DB_URL } from '../setup/test-db';

async function signUpThrowaway(page: Page): Promise<string> {
  const email = `e2e-dashdup-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  return email;
}

/**
 * THE reported pair: one real card, two live Plaid connections to the same bank. Same name, same
 * last-4, same balance, same cycle days — byte-identical, exactly as his /cards screenshot showed.
 * Both rows are datable, so both land in this cycle's obligations and both reach the headline.
 *
 * A checking account funds the projection; without a payment account the hero answers a different
 * question entirely.
 */
function seedDuplicateCard(email: string): void {
  const file = E2E_DB_URL.replace(/^file:/, '');
  const db = new Database(file, { timeout: 15_000 });
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as
      | { id: string }
      | undefined;
    if (!user) throw new Error(`seedDuplicateCard: user ${email} not found`);
    const uid = user.id;
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const itemA = `e2e-dashdup-item-a-${suffix}`;
    const itemB = `e2e-dashdup-item-b-${suffix}`;
    const insItem = db.prepare(
      `INSERT INTO PlaidItem (id, userId, itemId, accessToken, institution, lastSyncedAt)
       VALUES (?, ?, ?, 'ct-e2e', 'Chase', '2026-07-24')`,
    );
    insItem.run(`e2e-dashdup-row-a-${suffix}`, uid, itemA);
    insItem.run(`e2e-dashdup-row-b-${suffix}`, uid, itemB);

    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, plaidItemId, name, type, mask, currentBalanceCents, currency)
       VALUES (?, ?, 'plaid', ?, ?, 'Everyday Checking', 'CHECKING', '1111', 5000000, 'USD')`,
    ).run(`e2e-dashdup-chk-${suffix}`, uid, `pl-chk-${suffix}`, itemA);

    // POSITIVE is owed on a card: Plaid reports `balances.current` that way and the engine reads it
    // that way (`engine.ts:89-90` estimates a statement from it only when > 0). Seeding the sign
    // backwards produces a card in credit, which is due nothing — and no obligation to duplicate.
    const insCard = db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, plaidItemId, name, type, mask,
                            currentBalanceCents, currency, dueDayOfMonth, cycleCloseDayOfMonth)
       VALUES (?, ?, 'plaid', ?, ?, 'CREDIT CARD', 'CREDIT', '0977', 667968, 'USD', 5, 8)`,
    );
    insCard.run(`e2e-dashdup-card-a-${suffix}`, uid, `pl-ca-${suffix}`, itemA);
    insCard.run(`e2e-dashdup-card-b-${suffix}`, uid, `pl-cb-${suffix}`, itemB);
  } finally {
    db.close();
  }
}

/** "$6,679.68" → 667968. The page is the source of truth for what the reader was told. */
function centsFrom(text: string): number {
  const m = text.match(/\$([\d,]+)\.(\d{2})/);
  if (!m) throw new Error(`no money figure in: ${text}`);
  return Number(m[1].replace(/,/g, '')) * 100 + Number(m[2]);
}

test('the dashboard says a card may be counted twice — and still shows the unadjusted figure', async ({
  page,
}) => {
  const email = await signUpThrowaway(page);
  seedDuplicateCard(email);
  await page.goto('/dashboard');

  const hero = page.getByTestId('cash-needed-card');
  await expect(hero).toBeVisible({ timeout: 20_000 });

  // THE REGRESSION. Pre-L.8 the dashboard rendered no disclosure of any kind.
  const heroDisclosure = hero.getByTestId('cards-duplicate');
  await expect(heroDisclosure).toBeVisible();
  await expect(heroDisclosure).toContainText('One card may be listed twice');
  // The claim is the strong one — both rows really are inside this headline — and it is only ever
  // made in that state (the #299 P0: an estimated or paid-off duplicate inflates nothing).
  await expect(heroDisclosure).toContainText('Both are counted in the total above');
  // The heuristic states its strength and its evidence, never a bare verdict above a money figure.
  await expect(heroDisclosure).toContainText('Likely — matched on');
  await expect(heroDisclosure).toContainText('0977');
  // No figure moved, and the page says so rather than leaving the reader to wonder.
  await expect(heroDisclosure).toContainText('No figure above has been adjusted');

  // DISCLOSE, NEVER ADJUST: the headline is still the sum of both copies. This is the assertion
  // that would catch a future "helpful" subtraction — which would assert two rows are one card.
  const rows = page.getByTestId('reminder-row');
  await expect(rows).toHaveCount(2);
  const rowCents = await Promise.all(
    (await rows.allInnerTexts()).map((t) => Promise.resolve(centsFrom(t))),
  );
  expect(rowCents[0]).toBe(rowCents[1]);
  const headlineCents = centsFrom(await page.getByTestId('cash-needed-amount').innerText());
  expect(headlineCents).toBe(rowCents[0] + rowCents[1]);

  // The reminders list makes its OWN claim, about a duplicated instruction rather than a total it
  // does not have.
  const remindersCard = page.getByTestId('payment-reminders-card');
  const listDisclosure = remindersCard.getByTestId('cards-duplicate');
  await expect(listDisclosure).toBeVisible();
  // Says nothing about WHICH CYCLE: the reminders list carries estimated obligations too, so a
  // "this cycle" claim here contradicted the hero calling the same pair next-cycle estimates.
  await expect(listDisclosure).toContainText('asking to be paid twice');
  await expect(listDisclosure).not.toContainText('this cycle');
  await expect(listDisclosure).toContainText('No amount below has been adjusted');
  await expect(listDisclosure).not.toContainText('counted in the total above');

  // Two rows for two Account ids, painted DIFFERENTLY — the whole point of naming them. With the
  // same name and the same last-4 on both, only the positional marker can separate them.
  const names = await remindersCard.getByTestId('reminder-card-name').allInnerTexts();
  expect(names).toHaveLength(2);
  expect(names[0].trim()).not.toBe(names[1].trim());

  // Announced, not merely coloured: without this a screen-reader user meets the figure and the
  // transfer instruction under it with no signal that either is qualified.
  await expect(heroDisclosure).toHaveAttribute('role', 'alert');
  // And EXACTLY one alert region. Both cards are on screen at load with the same title and a
  // near-identical body, so a second alert announces the same sentence twice before the reader
  // reaches either list (critic P2). The reminders copy is read in document order instead.
  await expect(listDisclosure).not.toHaveAttribute('role', 'alert');
  await expect(page.locator('[role="alert"][data-testid="cards-duplicate"]')).toHaveCount(1);
});

test('the hero and the reminders call the same card the SAME thing', async ({ page }) => {
  // A fresh-context critic reproduced the #299 residual across COMPONENTS: each ran its own
  // `cardIdentityLabels` pass over its own list, and since the numbering is by position, "1." meant
  // one account in the hero and a different one on the reminders card six inches below. The page
  // now computes one pass and hands it down. With the same name AND the same last-4 on both rows,
  // the positional marker is the only thing separating them, so this is the state that catches it.
  const email = await signUpThrowaway(page);
  seedDuplicateCard(email);
  await page.goto('/dashboard');
  await expect(page.getByTestId('cash-needed-card')).toBeVisible({ timeout: 20_000 });

  const heroText = await page.getByTestId('due-date-list').innerText();
  const rowNames = (await page.getByTestId('reminder-card-name').allInnerTexts()).map((t) => t.trim());
  expect(rowNames).toHaveLength(2);
  expect(rowNames[0]).not.toBe(rowNames[1]);
  // Every name the reminders card paints is painted by the hero too, character for character.
  for (const name of rowNames) expect(heroText).toContain(name);
});

test('an UNDATED duplicate pair is named where it is disclosed', async ({ page }) => {
  // The branch two critics broke independently. With no cycle days the engine can date nothing, so
  // the hero takes its "due dates missing" branch — which summed BALANCES and named no card at all,
  // while the disclosure quoted two headings and two ordinals that appeared nowhere on screen. It
  // is also the likeliest home for a duplicate: a Plaid card whose issuer returns no liabilities.
  const email = await signUpThrowaway(page);
  const file = E2E_DB_URL.replace(/^file:/, '');
  const db = new Database(file, { timeout: 15_000 });
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as { id: string };
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const insItem = db.prepare(
      `INSERT INTO PlaidItem (id, userId, itemId, accessToken, institution, lastSyncedAt)
       VALUES (?, ?, ?, 'ct-e2e', 'Chase', '2026-07-24')`,
    );
    const insAcct = db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, plaidItemId, name, type, mask,
                            currentBalanceCents, currency)
       VALUES (?, ?, 'plaid', ?, ?, ?, ?, ?, ?, 'USD')`,
    );
    for (const side of ['a', 'b']) {
      const item = `e2e-undated-item-${side}-${suffix}`;
      insItem.run(`e2e-undated-row-${side}-${suffix}`, user.id, item);
      // No dueDayOfMonth and no cycleCloseDayOfMonth: undatable by construction, and the engine
      // refuses to invent a date from one day alone (#277 cycle-2 counter-lock).
      insAcct.run(
        `e2e-undated-card-${side}-${suffix}`, user.id, `pl-u${side}-${suffix}`, item,
        'CREDIT CARD', 'CREDIT', '0977', 667968,
      );
    }
  } finally {
    db.close();
  }

  await page.goto('/dashboard');
  await expect(page.getByTestId('cash-needed-card')).toContainText('Cards: due dates missing', {
    timeout: 20_000,
  });

  // The cards are NAMED now, not just counted.
  const names = page.getByTestId('cash-needed-unknown-names');
  await expect(names).toBeVisible();
  const namesText = await names.innerText();

  const disclosure = page.getByTestId('cash-needed-card').getByTestId('cards-duplicate');
  await expect(disclosure).toBeVisible();
  // The balance-branch claim, which is about the combined BALANCE — never this cycle's total, a
  // figure this branch explicitly says these cards are NOT in.
  await expect(disclosure).toContainText('inside the combined balance stated above');
  await expect(disclosure).not.toContainText('cash required');

  // THE FIX: every heading the banner quotes is a string the reader can actually find above it.
  const quoted = [...(await disclosure.innerText()).matchAll(/“([^”]+)”/g)].map((m) => m[1]);
  expect(quoted.length).toBeGreaterThanOrEqual(2);
  for (const name of quoted) expect(namesText).toContain(name);
  expect(quoted[0]).not.toBe(quoted[1]);
});

test('both disclosures are WCAG AA clean and fit every phone width', async ({ page }) => {
  // The blind spot #297 had to close, one surface over: the passive axe/overflow gates load routes
  // as the DEMO user, who has no duplicate — so this markup renders on no gated page and would
  // never be scanned. It is scanned here, where a duplicate actually exists, at the widths the
  // owner's phone reports.
  const email = await signUpThrowaway(page);
  seedDuplicateCard(email);
  await page.goto('/dashboard');
  await expect(page.getByTestId('cards-duplicate').first()).toBeVisible({ timeout: 20_000 });

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);

  for (const width of [360, 393, 430]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(async () => {
      const m = await page.evaluate(() => {
        const el = document.scrollingElement ?? document.documentElement;
        return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
      });
      expect(m.scrollWidth, `/dashboard duplicate disclosure at ${width}px`).toBeLessThanOrEqual(
        m.clientWidth + 1,
      );
    }).toPass({ timeout: 10_000 });
  }
});

test('a user with no duplicate is told nothing — no card is flagged on a hunch', async ({ page }) => {
  const email = await signUpThrowaway(page);
  const file = E2E_DB_URL.replace(/^file:/, '');
  const db = new Database(file, { timeout: 15_000 });
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as { id: string };
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const item = `e2e-dashclean-item-${suffix}`;
    db.prepare(
      `INSERT INTO PlaidItem (id, userId, itemId, accessToken, institution, lastSyncedAt)
       VALUES (?, ?, ?, 'ct-e2e', 'Chase', '2026-07-24')`,
    ).run(`e2e-dashclean-row-${suffix}`, user.id, item);
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, plaidItemId, name, type, mask,
                            currentBalanceCents, currency, dueDayOfMonth, cycleCloseDayOfMonth)
       VALUES (?, ?, 'plaid', ?, ?, 'Venture', 'CREDIT', '6271', 925093, 'USD', 5, 8)`,
    ).run(`e2e-dashclean-card-${suffix}`, user.id, `pl-clean-${suffix}`, item);
  } finally {
    db.close();
  }

  await page.goto('/dashboard');
  await expect(page.getByTestId('cash-needed-card')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('cards-duplicate')).toHaveCount(0);
});
