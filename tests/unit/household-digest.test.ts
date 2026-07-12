/**
 * Joint household digest — TASKS 4.2 slice 7 (HOUSEHOLD_ARCHITECTURE §5.7,
 * DECISIONS #201(2) / #220). Three layers:
 *
 *  1. `summarizeSharedMovement` (pure): window bounds, transfer exclusion, signs.
 *  2. `getHouseholdDigestContext` (server read): the shared-account set is
 *     symmetric (mine + partners'), currency-guarded, and NEVER includes an
 *     unshared row (T1) or a departed partner's rows (T2/T4).
 *  3. The REAL cron route end to end: a member with a live partner gets ONE
 *     household-scope email — partner's SHARED card due present, partner's
 *     PRIVATE card absent, own private card still reminded (the reason #220
 *     composes per recipient), the week dedup key unchanged; a solo user's
 *     digest stays byte-identical to the personal one (T6).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/cron/digest/route';
import { prisma } from '@/lib/db';
import { addDays, dayOfWeek, isoDate, type ISODate } from '@/lib/dates';
import { cents } from '@/lib/money';
import { getProvider } from '@/lib/providers/demo';
import { summarizeSharedMovement } from '@/lib/engine/household/digest';
import { getHouseholdDigestContext } from '@/server/household-digest';
import { resolveViewer } from '@/server/household-authz';

// ── 1. Pure summarizer ──────────────────────────────────────────────────────

describe('summarizeSharedMovement (pure)', () => {
  const since = isoDate('2026-06-04');
  const today = isoDate('2026-06-10');
  const row = (
    date: string,
    amountCents: number,
    over: Partial<{ isTransfer: boolean; status: string; isSplitParent: boolean }> = {},
  ) => ({
    date: isoDate(date),
    amountCents,
    isTransfer: false,
    status: 'POSTED',
    isSplitParent: false,
    ...over,
  });

  it('counts non-transfer rows inside the INCLUSIVE window, splitting the two signs', () => {
    const summary = summarizeSharedMovement({
      rows: [
        row('2026-06-04', -1_000), // on the `since` boundary — counted
        row('2026-06-07', -24_055),
        row('2026-06-10', 50_000), // on the `today` boundary — counted, inflow
      ],
      accountCount: 2,
      since,
      today,
    });
    expect(summary).toEqual({
      accountCount: 2,
      transactionCount: 3,
      outflowCents: cents(25_055),
      inflowCents: cents(50_000),
    });
  });

  it('excludes out-of-window rows, transfers, split parents and PENDING (the money-surface exclusion set)', () => {
    const summary = summarizeSharedMovement({
      rows: [
        row('2026-06-03', -99_999), // one day before the window
        row('2026-06-11', -99_999), // one day after
        row('2026-06-07', -80_000, { isTransfer: true }), // in-window, but a transfer
        row('2026-06-07', -70_000, { isSplitParent: true }), // container: children carry the money
        row('2026-06-07', -60_000, { status: 'PENDING' }), // not money that moved yet
        row('2026-06-07', -2_500),
      ],
      accountCount: 1,
      since,
      today,
    });
    expect(summary.transactionCount).toBe(1);
    expect(summary.outflowCents).toBe(cents(2_500));
    expect(summary.inflowCents).toBe(cents(0));
  });

  it('an empty household week is zeroed, not undefined', () => {
    expect(summarizeSharedMovement({ rows: [], accountCount: 0, since, today })).toEqual({
      accountCount: 0,
      transactionCount: 0,
      outflowCents: cents(0),
      inflowCents: cents(0),
    });
  });
});

// ── 2 + 3. Server read and the real cron route ──────────────────────────────

const stamp = `${Date.now()}-${process.pid}`;
const uid = (slug: string) => `hd-${slug}-${stamp}`;

describe('joint household digest — server read + cron route', () => {
  const A = uid('recipient'); // the member whose inbox we inspect
  const B = uid('partner');
  const SOLO = uid('solo');
  const ALL = [A, B, SOLO];

  const today: ISODate = getProvider().today();
  const since: ISODate = addDays(today, -6);
  const weekKey = `weekly_digest:${addDays(today, -((dayOfWeek(today) + 6) % 7))}`;

  let householdId = '';
  let aSharedCheckingId = '';
  let bSharedCardId = '';

  async function wipe() {
    const memberships = await prisma.householdMember.findMany({
      where: { userId: { in: ALL } },
      select: { householdId: true },
    });
    await prisma.household.deleteMany({
      where: { id: { in: memberships.map((m) => m.householdId) } },
    });
    await prisma.user.deleteMany({ where: { id: { in: ALL } } });
  }

  /** A card whose statement is due inside the 7-day digest window. */
  async function cardDueIn(userId: string, name: string, days: number, shared: boolean) {
    const card = await prisma.account.create({
      data: {
        userId,
        provider: 'manual',
        name,
        type: 'CREDIT',
        currentBalanceCents: 60_000,
        sharedToHousehold: shared,
      },
    });
    await prisma.statement.create({
      data: {
        accountId: card.id,
        cycleStart: addDays(today, -35),
        cycleEnd: addDays(today, -5),
        dueDate: addDays(today, days),
        statementBalanceCents: 60_000,
        minimumPaymentCents: 3_000,
      },
    });
    return card.id;
  }

  beforeAll(async () => {
    await wipe();
    for (const id of ALL) {
      await prisma.user.create({ data: { id, email: `${id}@test.local`, name: id } });
    }

    const household = await prisma.household.create({
      data: {
        name: 'The Testers',
        members: {
          create: [
            { userId: A, role: 'owner' },
            { userId: B, role: 'partner' },
          ],
        },
      },
    });
    householdId = household.id;

    // A: a checking account (funds cash-needed) SHARED into the household, plus
    // a PRIVATE card of their own due in 2 days.
    const aChecking = await prisma.account.create({
      data: {
        userId: A,
        provider: 'manual',
        name: 'A Checking',
        type: 'CHECKING',
        currentBalanceCents: 900_000,
        sharedToHousehold: true,
      },
    });
    aSharedCheckingId = aChecking.id;
    await cardDueIn(A, 'A Private Card', 2, false);

    // B: one SHARED card (due in 5 days → must reach A) and one PRIVATE card
    // (due in 4 days → must NEVER reach A: T1).
    bSharedCardId = await cardDueIn(B, 'B Shared Card', 5, true);
    await cardDueIn(B, 'B Private Card', 4, false);
    // B needs a checking account of their own or getCashNeeded cannot resolve a
    // funding account for B's own sweep row.
    const bChecking = await prisma.account.create({
      data: {
        userId: B,
        provider: 'manual',
        name: 'B Checking',
        type: 'CHECKING',
        currentBalanceCents: 400_000,
        sharedToHousehold: false,
      },
    });

    // Movement: 2 in-window spends + 1 in-window inflow on SHARED accounts. The
    // transfer, the split parent, the PENDING row, the out-of-window row and the
    // row on B's PRIVATE checking must all be excluded.
    await prisma.transaction.createMany({
      data: [
        { accountId: aSharedCheckingId, date: addDays(today, -3), amountCents: -12_500, rawDescriptor: 'GROCER' },
        { accountId: bSharedCardId, date: addDays(today, -1), amountCents: -8_000, rawDescriptor: 'FUEL' },
        { accountId: aSharedCheckingId, date: today, amountCents: 250_000, rawDescriptor: 'PAYROLL' },
        { accountId: aSharedCheckingId, date: addDays(today, -2), amountCents: -70_000, rawDescriptor: 'XFER', isTransfer: true },
        { accountId: aSharedCheckingId, date: addDays(today, -2), amountCents: -55_000, rawDescriptor: 'SPLIT PARENT', isSplitParent: true },
        { accountId: bSharedCardId, date: addDays(today, -1), amountCents: -66_000, rawDescriptor: 'PENDING', status: 'PENDING' },
        { accountId: aSharedCheckingId, date: addDays(today, -20), amountCents: -33_000, rawDescriptor: 'OLD' },
        { accountId: bChecking.id, date: addDays(today, -2), amountCents: -44_000, rawDescriptor: 'PRIVATE' },
      ],
    });

    // SOLO: no household at all — the T6 control.
    await prisma.account.create({
      data: { userId: SOLO, provider: 'manual', name: 'Solo Checking', type: 'CHECKING', currentBalanceCents: 300_000 },
    });
    await cardDueIn(SOLO, 'Solo Card', 3, false);
  });

  afterAll(wipe);
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('labels PARTNER-owned shared accounts only — never the viewer\'s own (critic F1)', async () => {
    const ctx = await getHouseholdDigestContext(await resolveViewer(A), since, today);
    // B's shared card is labeled with B's name; A's own shared checking is NOT in
    // the map (A's own dues must keep the personal second-person line).
    expect(ctx!.partnerAccountLabels[bSharedCardId]).toBe(B);
    expect(ctx!.partnerAccountLabels[aSharedCheckingId]).toBeUndefined();
    expect(ctx!.withheldAccountCount).toBe(0);

    // Mirror image from B's side: A's shared checking is labeled, B's own card isn't.
    const forB = await getHouseholdDigestContext(await resolveViewer(B), since, today);
    expect(forB!.partnerAccountLabels[aSharedCheckingId]).toBe(A);
    expect(forB!.partnerAccountLabels[bSharedCardId]).toBeUndefined();
  });

  it('getHouseholdDigestContext: symmetric shared set, private rows never counted (T1)', async () => {
    const ctx = await getHouseholdDigestContext(await resolveViewer(A), since, today);
    expect(ctx).not.toBeNull();
    expect(ctx!.name).toBe('The Testers');
    // A's shared checking + B's shared card. B's private card/checking and A's
    // private card are all absent.
    expect(ctx!.movement.accountCount).toBe(2);
    // 3 countable in-window rows on those two accounts; the transfer, the split
    // parent, the PENDING row, the 20-days-ago row and B's private-account row
    // are all excluded.
    expect(ctx!.movement.transactionCount).toBe(3);
    expect(ctx!.movement.outflowCents).toBe(cents(20_500));
    expect(ctx!.movement.inflowCents).toBe(cents(250_000));
  });

  it('both partners see the SAME shared-movement figures (the symmetric section)', async () => {
    const forA = await getHouseholdDigestContext(await resolveViewer(A), since, today);
    const forB = await getHouseholdDigestContext(await resolveViewer(B), since, today);
    expect(forB!.movement).toEqual(forA!.movement);
  });

  it('T6: a user with no household gets no household context at all', async () => {
    expect(await getHouseholdDigestContext(await resolveViewer(SOLO), since, today)).toBeNull();
  });

  it('T2/T4: a departed partner drops out of the shared set on the next sweep', async () => {
    await prisma.householdMember.deleteMany({ where: { householdId, userId: B } });
    try {
      // A is now a household of one → no joint digest, and B's shared card is
      // gone from the shared set even though its flag is still true.
      expect(await getHouseholdDigestContext(await resolveViewer(A), since, today)).toBeNull();
    } finally {
      await prisma.householdMember.create({ data: { householdId, userId: B, role: 'partner' } });
    }
  });

  it('the cron sends ONE joint email per member: partner shared dues in, private dues out (T1)', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    vi.stubEnv('RESEND_API_KEY', 'test-key');
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchSpy);

    const body = await (
      await GET(new NextRequest('http://localhost/api/cron/digest', { headers: { authorization: 'Bearer test-secret' } }))
    ).json();

    const rowA = body.results.find((r: { userId: string }) => r.userId === A);
    const rowSolo = body.results.find((r: { userId: string }) => r.userId === SOLO);
    expect(rowA).toMatchObject({ sent: true, joint: true });
    expect(rowSolo).toMatchObject({ sent: true, joint: false });

    const emailFor = (user: string) => {
      const call = fetchSpy.mock.calls.find((c) => {
        const init = c[1] as { body?: unknown } | undefined;
        return typeof init?.body === 'string' && init.body.includes(`${user}@test.local`);
      });
      expect(call, `no email composed for ${user}`).toBeDefined();
      return String((call![1] as { body: string }).body);
    };

    const toA = emailFor(A);
    expect(toA).toContain("Your household's week with Aimplifi");
    expect(toA).toContain('Coming up in the next 7 days across your household:');
    // The partner's SHARED card is in A's dues; the partner's PRIVATE card is not.
    expect(toA).toContain('B Shared Card');
    expect(toA).not.toContain('B Private Card');

    // …and that partner card is OWNER-ATTRIBUTED on the wire, never billed to A
    // (critic F1: "you'll pay $600.00 yourself" about someone else's card would
    // invite a double payment). A's OWN card keeps the second-person line, so the
    // banned phrasings are asserted on the partner's LINE, not the whole email.
    const partnerLine = toA.split('\\n').find((l) => l.includes('B Shared Card'))!;
    expect(partnerLine).toContain(`(${B}'s)`);
    expect(partnerLine).toContain("Aimplifi doesn't decide who pays");
    expect(partnerLine).not.toContain("you'll pay");
    expect(partnerLine).not.toContain('yourself');
    // A's own private card still carries the personal, second-person instruction.
    const ownLine = toA.split('\\n').find((l) => l.includes('A Private Card'))!;
    expect(ownLine).toContain("you'll pay");
    // A's OWN private card is still reminded — the joint digest REPLACES the
    // personal one, so dropping it would drop a real payment reminder (#220).
    expect(toA).toContain('A Private Card');
    // The symmetric movement block + the §4.4 assumptions, inline.
    expect(toA).toContain('Shared in The Testers:');
    expect(toA).toContain('3 transactions on 2 shared accounts in the last 7 days');
    expect(toA).toContain("Anything not shared isn't counted.");

    // The solo user's digest is untouched by any of this (T6).
    const toSolo = emailFor(SOLO);
    expect(toSolo).toContain('Your week with Aimplifi');
    expect(toSolo).toContain('Coming up in the next 7 days:');
    expect(toSolo).not.toContain('Shared in');

    // One digest per recipient per week, on the UNCHANGED key — so a household
    // transition mid-week can never produce a second email.
    expect(await prisma.notificationSent.count({ where: { userId: A, key: weekKey } })).toBe(1);
    expect(await prisma.notificationSent.count({ where: { userId: B, key: weekKey } })).toBe(1);

    const second = await (
      await GET(new NextRequest('http://localhost/api/cron/digest', { headers: { authorization: 'Bearer test-secret' } }))
    ).json();
    expect(second.results.find((r: { userId: string }) => r.userId === A)).toMatchObject({
      sent: false,
      reason: 'already-sent-this-week',
    });
  });
});
