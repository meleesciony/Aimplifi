/**
 * O.19c — /trends capped two lists under headers that read as complete:
 * "What changed" caps at MAX_MOVERS (6) and "New this month" at
 * MAX_NEW_MERCHANTS (5), with no wording that a 7th mover / 6th merchant was
 * dropped. The engine now returns the pre-cap counts and the page states the
 * cap ONLY when it bound (the O.19b abstention rule — an uncapped list renders
 * no cap line, engine-locked in trends.test.ts).
 *
 * The demo month's mover/new-merchant counts are not pinned anywhere, so this
 * spec seeds a THROWAWAY user in whose data both caps provably bind: seven
 * qualifying May movers (each a new-category swing ≥ $20) and six qualifying
 * June merchants — and asserts the two cap lines print exactly "6 of 7" and
 * "5 of 6", which fails if the fixture ever degrades below the caps.
 */
import Database from 'better-sqlite3';
import { expect, test, type Page } from './helpers/test';
import { E2E_DB_URL } from '../setup/test-db';

/** e2e server pins DEMO_TODAY=2026-06-10 → asOf June, movers describe May. */
const MAY = '2026-05-05';
const JUNE = '2026-06-05';

/** Seven categories spent in May only: baseline (Feb–Apr) is empty, so each is
 *  a "new" mover, surfaced at ≥ $20 — 7 qualify, MAX_MOVERS shows 6. */
const MAY_MOVERS: ReadonlyArray<readonly [string, number]> = [
  ['rent', 10000],
  ['groceries', 9000],
  ['dining', 8000],
  ['shopping', 7000],
  ['utilities', 6000],
  ['electricity', 5000],
  ['clothing', 4000], // the 7th — dropped by the cap, present only in the count
];

/** Six distinct June merchants (settled purchases, non-aggregate descriptors):
 *  6 qualify, MAX_NEW_MERCHANTS shows 5. */
const JUNE_MERCHANTS: ReadonlyArray<readonly [string, number]> = [
  ['ALPHA CAFE', 6000],
  ['BRAVO BISTRO', 5000],
  ['CHARLIE DELI', 4000],
  ['DELTA DINER', 3000],
  ['ECHO EATS', 2000],
  ['FOXTROT FOOD', 1000], // the 6th — dropped by the cap
];

async function signUpThrowaway(page: Page): Promise<string> {
  const email = `e2e-trends-caps-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  return email;
}

function seedTrendsData(email: string) {
  const file = E2E_DB_URL.replace(/^file:/, '');
  const db = new Database(file, { timeout: 15_000 });
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as
      | { id: string }
      | undefined;
    if (!user) throw new Error(`seedTrendsData: user ${email} not found`);
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    const checkingId = `e2e-chk-${stamp}`;
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, name, type, mask, currentBalanceCents, currency)
       VALUES (?, ?, 'manual', ?, 'Everyday Checking', 'CHECKING', '0977', 500000, 'USD')`,
    ).run(checkingId, user.id, `ref-chk-${stamp}`);

    const txn = db.prepare(
      `INSERT INTO "Transaction" (id, accountId, date, amountCents, rawDescriptor, categoryId, status, isTransfer, isSplitParent)
       VALUES (?, ?, ?, ?, ?, ?, 'POSTED', 0, 0)`,
    );
    MAY_MOVERS.forEach(([categoryId, cents], i) => {
      txn.run(`e2e-mv-${i}-${stamp}`, checkingId, MAY, -cents, `E2E ${categoryId}`, categoryId);
    });
    JUNE_MERCHANTS.forEach(([descriptor, cents], i) => {
      txn.run(`e2e-nm-${i}-${stamp}`, checkingId, JUNE, -cents, descriptor, 'dining');
    });
  } finally {
    db.close();
  }
}

test('trends: both capped lists state their binding caps with pre-cap counts', async ({ page }) => {
  const email = await signUpThrowaway(page);
  seedTrendsData(email);

  await page.goto('/trends');
  await expect(page.getByTestId('trends-movers')).toBeVisible();

  // "What changed": 7 qualified, 6 listed — the header's completeness claim is
  // repaired by the cap line, which names both numbers.
  await expect(page.getByTestId('trends-movers-cap')).toHaveText(
    'Showing the top 6 of 7 changed categories, by size of change.',
  );

  // "New this month": 6 qualified, 5 listed.
  await expect(page.getByTestId('trends-new-merchants')).toBeVisible();
  await expect(page.getByTestId('trends-new-merchants-cap')).toHaveText(
    'Showing the top 5 of 6 new merchants, by amount spent.',
  );
  // The cap line tells the truth about the rows: exactly 5 merchant rows render.
  await expect(page.getByTestId('trends-new-merchant-link')).toHaveCount(5);
});
