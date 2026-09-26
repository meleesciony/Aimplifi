/**
 * O.11d — the tag write path against the real DB (the account-payment-merchant
 * idiom): the shared action itself, not a re-implementation of its effect.
 *
 * What is under test is the FOLD and the FENCE — the two things a re-implementation
 * would fake:
 *  - adding " Work  TRIP " to a row that already can take "work trip" APPLIES the
 *    existing tag (the schema's byte-wise unique keeps both spellings legal, so
 *    only the writer can keep the vocabulary from forking);
 *  - the shared demo row refuses before any lookup or write;
 *  - a foreign tagId cannot delete one of my joins, and a foreign row cannot be
 *    tagged at all — the refusals read exactly like "not yours", never like a hint
 *    about what exists.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEMO_ENTRY_BLOCKED, DEMO_USER_ID } from '@/lib/demo-user';

let mockUserId = '';
vi.mock('@/server/authz', () => ({
  requireUserId: async () => mockUserId,
  auditLog: async () => undefined,
  rateLimitDurable: async () => true,
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

const { prisma } = await import('@/lib/db');
const { addTransactionTag, removeTransactionTag } = await import('@/server/transaction-tag-actions');

const STAMP = `${Date.now()}-${process.pid}`;
const USER = `tags-${STAMP}`;
const OTHER = `tags-other-${STAMP}`;

async function mkUser(id: string) {
  await prisma.user.create({ data: { id, email: `${id}@test.local` } });
}
async function mkAccount(userId: string, id: string) {
  await prisma.account.create({
    data: { userId, provider: 'demo', name: 'Everyday Checking', type: 'CHECKING', currentBalanceCents: 100_000, currency: 'USD', id },
  });
}
async function mkTxn(id: string, accountId: string) {
  await prisma.transaction.create({
    data: {
      id,
      accountId,
      date: '2026-06-05',
      amountCents: -4000,
      rawDescriptor: 'WHOLEFDS AM 10305',
      categoryId: 'groceries',
      confidenceBps: 9000,
      needsReview: false,
    },
  });
}

describe('addTransactionTag / removeTransactionTag', () => {
  beforeAll(async () => {
    await mkUser(USER);
    await mkUser(OTHER);
    await mkAccount(USER, `acct-${USER}`);
    await mkAccount(OTHER, `acct-${OTHER}`);
    await mkTxn(`txn-${USER}`, `acct-${USER}`);
    await mkTxn(`txn-${OTHER}`, `acct-${OTHER}`);
  });

  afterAll(async () => {
    for (const id of [USER, OTHER]) {
      await prisma.transaction.deleteMany({ where: { account: { userId: id } } });
      await prisma.tag.deleteMany({ where: { userId: id } });
      await prisma.account.deleteMany({ where: { userId: id } });
      await prisma.user.deleteMany({ where: { id } });
    }
  });

  it('adds a tag to a row (the Tag + join rows land)', async () => {
    mockUserId = USER;
    const res = await addTransactionTag({ transactionId: `txn-${USER}`, tagName: 'work trip' });
    expect(res).toEqual({ ok: true });
    const tag = await prisma.tag.findFirst({ where: { userId: USER, name: 'work trip' } });
    expect(tag).not.toBeNull();
    const join = await prisma.transactionTag.findFirst({ where: { transactionId: `txn-${USER}`, tagId: tag!.id } });
    expect(join).not.toBeNull();
  });

  it('the case fold APPLIES the existing tag — " Work  TRIP " never mints a twin', async () => {
    mockUserId = USER;
    const before = await prisma.tag.findMany({ where: { userId: USER } });
    expect(before).toHaveLength(1);

    const res = await addTransactionTag({ transactionId: `txn-${USER}`, tagName: '  Work   TRIP ' });
    expect(res).toEqual({ ok: true });

    const tags = await prisma.tag.findMany({ where: { userId: USER } });
    expect(tags).toHaveLength(1); // the fold reused the row — one spelling, one chip
    expect(tags[0]!.name).toBe('work trip');
    const joins = await prisma.transactionTag.findMany({ where: { transactionId: `txn-${USER}` } });
    expect(joins).toHaveLength(1); // adding it again is still one join row
  });

  it('an empty or over-long name refuses with the engine sentence and writes nothing', async () => {
    mockUserId = USER;
    expect(await addTransactionTag({ transactionId: `txn-${USER}`, tagName: '   ' })).toEqual({
      error: 'Give the tag a name.',
      ok: false,
    });
    expect(
      await addTransactionTag({ transactionId: `txn-${USER}`, tagName: 'x'.repeat(41) }),
    ).toEqual({ error: 'Keep the name to 40 characters.', ok: false });
    expect(await prisma.tag.count({ where: { userId: USER } })).toBe(1);
  });

  it("another user's row is not found, not described", async () => {
    mockUserId = USER;
    const res = await addTransactionTag({ transactionId: `txn-${OTHER}`, tagName: 'snooped' });
    expect(res).toEqual({ ok: false, error: 'That transaction is no longer available — nothing was changed.' });
    expect(await prisma.tag.findFirst({ where: { name: 'snooped' } })).toBeNull();
  });

  it("a foreign tagId cannot remove one of my joins, and removing it again is still ok", async () => {
    mockUserId = USER;
    const mine = await prisma.tag.findFirst({ where: { userId: USER } });
    const theirs = await prisma.tag.create({ data: { userId: OTHER, name: 'work trip' } }); // same NAME, other owner

    const res = await removeTransactionTag({ transactionId: `txn-${USER}`, tagId: theirs.id });
    expect(res).toEqual({ ok: true }); // the requested STATE holds — nothing matched to remove
    expect(
      await prisma.transactionTag.findFirst({ where: { transactionId: `txn-${USER}`, tagId: mine!.id } }),
    ).not.toBeNull(); // my join survives, untouched

    // And my own removal works, then stays ok when repeated.
    expect(await removeTransactionTag({ transactionId: `txn-${USER}`, tagId: mine!.id })).toEqual({ ok: true });
    expect(await removeTransactionTag({ transactionId: `txn-${USER}`, tagId: mine!.id })).toEqual({ ok: true });
    expect(await prisma.transactionTag.findMany({ where: { transactionId: `txn-${USER}` } })).toHaveLength(0);
  });

  it('the shared demo fences both verbs before any lookup or write', async () => {
    mockUserId = DEMO_USER_ID;
    expect(await addTransactionTag({ transactionId: `txn-${USER}`, tagName: 'demo tag' })).toEqual({
      ok: false,
      error: DEMO_ENTRY_BLOCKED,
    });
    expect(await removeTransactionTag({ transactionId: `txn-${USER}`, tagId: 'whatever' })).toEqual({
      ok: false,
      error: DEMO_ENTRY_BLOCKED,
    });
    expect(await prisma.tag.findFirst({ where: { userId: DEMO_USER_ID, name: 'demo tag' } })).toBeNull();
  });
});
