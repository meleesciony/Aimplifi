/**
 * TASKS L.15 — the SERVER WIRING half: the pair actually reaches the offline channels.
 *
 * The builders are locked in tests/unit/card-duplicate-channels.test.ts and the detector in
 * tests/unit/account-duplicates.test.ts. What neither covers is the join: `getCashNeeded` must
 * compute `cardDuplicates` at all (before L.15 only `getDashboardData` did), it must compute them
 * from the viewer's OWN pre-merge snapshot, and the value must survive into the email and the push
 * body the cron routes build. A green builder test proves nothing if the cron passes `[]`.
 *
 * FAIL-OLD: `getCashNeeded`'s return had no `cardDuplicates` field, so every assertion here fails to
 * compile against the pre-L.15 build.
 *
 * DB-backed, following tests/unit/cards-duplicate-disclosure.test.ts, and using the same fixture
 * shape: one real Chase card reaching Aimplifi through TWO live Plaid connections.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/db';
import { getCashNeeded } from '@/server/finance';
import { buildReminderEmail, selectPaymentReminders } from '@/lib/engine/reminders/select';
import { buildWeeklyDigest } from '@/lib/engine/digest/build';
import {
  CARD_DUPLICATE_TITLE,
  cardDuplicatePushNotes,
} from '@/lib/engine/account/card-duplicate-view';

const stamp = `${Date.now()}-${process.pid}`;
const ALL_IDS: string[] = [];

async function seedUser(slug: string): Promise<string> {
  const id = `l15-${slug}-${stamp}`;
  ALL_IDS.push(id);
  await prisma.user.create({ data: { id, email: `${id}@test.local`, name: slug } });
  return id;
}

async function seedItem(userId: string, itemId: string): Promise<void> {
  await prisma.plaidItem.create({
    data: { userId, itemId, accessToken: 'ct-test', institution: 'Chase' },
  });
}

async function seedCard(
  userId: string,
  name: string,
  mask: string | null,
  plaidItemId: string,
): Promise<string> {
  const a = await prisma.account.create({
    data: {
      userId,
      provider: 'plaid',
      plaidItemId,
      name,
      type: 'CREDIT',
      mask,
      currentBalanceCents: -667_968,
      currency: 'USD',
      dueDayOfMonth: 5,
      cycleCloseDayOfMonth: 8,
    },
  });
  return a.id;
}

/** today + n days, as a calendar date string. Derived from the engine's own `today` so the fixture
 *  never depends on which real day the suite runs (the first cut did, and asserted nothing). */
function plusDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * The issuer statement each card carries. WITHOUT one the engine estimates a $0 statement, every
 * obligation is filtered out by `selectPaymentReminders`' `cashRequiredCents <= 0` guard, and the
 * reminders list comes back EMPTY — which is exactly how the first cut of this file ended up
 * asserting nothing behind `if (email)` guards. The e2e fixture seeds statements for the same reason.
 */
async function seedStatement(accountId: string, today: string): Promise<void> {
  await prisma.statement.create({
    data: {
      accountId,
      cycleStart: plusDays(today, -35),
      cycleEnd: plusDays(today, -5),
      dueDate: plusDays(today, 20),
      statementBalanceCents: 667_968,
      minimumPaymentCents: 6_600,
      isEstimated: false,
    },
  });
}

describe('L.15 wiring — the duplicated card reaches the offline channels', () => {
  let userId = '';

  beforeAll(async () => {
    userId = await seedUser('owner');
    for (const item of ['l15-chk', 'l15-a', 'l15-b']) await seedItem(userId, item);
    await prisma.account.create({
      data: {
        userId,
        provider: 'plaid',
        plaidItemId: 'l15-chk',
        name: 'Everyday Checking',
        type: 'CHECKING',
        mask: '4411',
        currentBalanceCents: 500_000,
        currency: 'USD',
      },
    });
    // The reported shape: same name, same last-4, two DIFFERENT live Plaid items.
    const a = await seedCard(userId, 'CREDIT CARD', '0977', 'l15-a');
    const b = await seedCard(userId, 'CREDIT CARD', '0977', 'l15-b');
    const { today } = await getCashNeeded(userId, 'PAY_IN_FULL');
    await seedStatement(a, today);
    await seedStatement(b, today);
  });

  afterAll(async () => {
    for (const id of ALL_IDS) await prisma.user.deleteMany({ where: { id } });
  });

  it('getCashNeeded detects the pair at all — the field the crons read', async () => {
    const { cardDuplicates } = await getCashNeeded(userId, 'PAY_IN_FULL');
    expect(cardDuplicates.length).toBeGreaterThan(0);
    const [p] = cardDuplicates;
    expect(p.aId).not.toBe(p.bId);
    expect(p.reasons.join(' ')).toContain('0977');
  });

  /**
   * A WIDE window on purpose. The seeded cards are dated from `dueDayOfMonth`, so how many days out
   * they fall depends on the real calendar day this test runs — and a first cut of this file used
   * the default window, got an EMPTY reminders list, and quietly asserted nothing behind an
   * `if (email)` guard. A test that only locks its claim on some days of the month is not locking it.
   */
  const WIDE_DAYS = 60;

  it('the reminder email built the way the cron builds it carries the disclosure', async () => {
    const { today, result, loanObligations, cardDuplicates } = await getCashNeeded(
      userId,
      'PAY_IN_FULL',
    );
    const reminders = selectPaymentReminders({
      obligations: result.cards,
      loanObligations,
      today,
      withinDays: WIDE_DAYS,
    });
    expect(reminders.length).toBe(2); // both copies really are asking to be paid
    const email = buildReminderEmail(reminders, today, cardDuplicates)!;
    expect(email).not.toBeNull();
    expect(email.text).toContain(CARD_DUPLICATE_TITLE);
    expect(email.text).toContain('in this email');
    // Disclose, never adjust: both bullets are still there.
    expect(email.text.match(/CREDIT CARD/g)?.length).toBeGreaterThanOrEqual(2);
    // And the email says NOTHING about a position or a screen the reader is not looking at.
    expect(email.text).not.toMatch(/the total above/);
  });

  it('the weekly digest built the way the cron builds it carries the disclosure', async () => {
    const { today, result, loanObligations, cardDuplicates } = await getCashNeeded(
      userId,
      'PAY_IN_FULL',
    );
    const reminders = selectPaymentReminders({
      obligations: result.cards,
      loanObligations,
      today,
      withinDays: WIDE_DAYS,
    });
    expect(reminders.length).toBe(2);
    const digest = buildWeeklyDigest({ frozenCards: [], review: null, reminders, today, cardDuplicates })!;
    expect(digest).not.toBeNull();
    expect(digest.text).toContain(CARD_DUPLICATE_TITLE);
    expect(digest.text).toContain('in this email');
  });

  it('the pair is keyed by the REAL account ids, so a push body can find its own note', async () => {
    // The "both notifications carry the note" claim is locked over hand-built reminders in
    // tests/unit/card-duplicate-channels.test.ts, because whether a seeded card falls inside
    // NOTIFY_DUE_WINDOW_DAYS depends on the real calendar day. What is checked HERE is the wiring
    // property that test cannot see: that the ids `getCashNeeded` emits are the ids the reminders
    // carry, so the per-notification lookup resolves at all.
    const { today, result, loanObligations, cardDuplicates } = await getCashNeeded(
      userId,
      'PAY_IN_FULL',
    );
    const reminders = selectPaymentReminders({
      obligations: result.cards,
      loanObligations,
      today,
      withinDays: WIDE_DAYS,
    });
    const notes = cardDuplicatePushNotes(
      cardDuplicates,
      reminders.map((r) => ({ cardId: r.accountId, label: r.accountName })),
    );
    expect(notes.size).toBe(2);
    for (const r of reminders) expect(notes.get(r.accountId)).toContain('duplicate');
  });

  it('a household read still pairs only the viewer’s OWN cards', async () => {
    // The viewer has no partners, so 'household' degrades to 'mine' — but the important property is
    // that the value is computed from the personal snapshot on BOTH branches, which is what makes a
    // partner's card unpairable by construction. This locks that the household branch returns the
    // field at all; the scoping itself is structural (the detector is module-private).
    const { cardDuplicates } = await getCashNeeded(userId, 'PAY_IN_FULL', 'household');
    expect(cardDuplicates.length).toBeGreaterThan(0);
  });

  it('a user with no duplicate gets an empty array and no disclosure anywhere', async () => {
    const cleanId = await seedUser('clean');
    await seedItem(cleanId, 'l15-clean');
    await prisma.account.create({
      data: {
        userId: cleanId,
        provider: 'plaid',
        plaidItemId: 'l15-clean',
        name: 'Everyday Checking',
        type: 'CHECKING',
        currentBalanceCents: 500_000,
        currency: 'USD',
      },
    });
    const only = await seedCard(cleanId, 'CREDIT CARD', '0977', 'l15-clean');
    await seedStatement(only, (await getCashNeeded(cleanId, 'PAY_IN_FULL')).today);

    const { today, result, loanObligations, cardDuplicates } = await getCashNeeded(
      cleanId,
      'PAY_IN_FULL',
    );
    expect(cardDuplicates).toEqual([]);
    const reminders = selectPaymentReminders({
      obligations: result.cards,
      loanObligations,
      today,
      withinDays: 60,
    });
    expect(reminders.length).toBe(1);
    const email = buildReminderEmail(reminders, today, cardDuplicates)!;
    expect(email.text).not.toContain(CARD_DUPLICATE_TITLE);
  });
});
