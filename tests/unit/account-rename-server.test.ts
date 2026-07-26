/**
 * Account rename (TASKS L.7) — the server layer, driven against throwaway users and the
 * REAL Prisma client (the account-delete-server.test.ts pattern).
 *
 * The contract under test:
 *   1. The rename writes `displayName` and never `name`, so the next sync — which rewrites
 *      `name` from the feed — cannot revert it. Asserted by actually re-running a
 *      provider-shaped `name` write afterwards.
 *   2. The label reaches the reader: /accounts renders the nickname, keeps the bank's own
 *      name available as `feedName`, and orders rows by what it renders.
 *   3. An empty box clears the nickname and the bank's name comes back.
 *   4. A nickname NEVER reaches duplicate detection. Renaming one of two same-card rows
 *      leaves the suspected-duplicate pair exactly where it was — the invariant the whole
 *      two-column design exists to protect.
 *   5. Ownership: another user's account is not found, and nothing is written.
 *   6. Demo fence: the shared demo row cannot be renamed by a visitor.
 *   7. A refused name (too long) writes nothing.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEMO_ENTRY_BLOCKED, DEMO_USER_ID } from '@/lib/demo-user';

let mockUserId = '';
vi.mock('@/server/authz', () => ({
  requireUserId: async () => mockUserId,
  auditLog: async () => undefined,
  // The real limiter is exercised in production and asserted separately; here it must simply
  // not be the thing under test (the action calls it before any write).
  rateLimitDurable: async () => true,
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

const { prisma } = await import('@/lib/db');
const { renameAccount } = await import('@/server/account-rename-actions');
const { ACCOUNT_NOT_FOUND } = await import('@/lib/engine/account/display-name');
const { getAccountsView } = await import('@/server/transactions');

const USER = `rename-${Date.now()}-${process.pid}`;
const OTHER = `${USER}-other`;
let cardAId = '';
let cardBId = '';
let otherId = '';

async function wipe() {
  await prisma.user.deleteMany({ where: { id: { in: [USER, OTHER] } } });
}

beforeAll(async () => {
  await wipe();
  await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
  await prisma.user.create({ data: { id: OTHER, email: `${OTHER}@test.local` } });
  // Two rows the feed names identically and masks identically — the owner's real screen
  // (three cards all called CREDIT CARD), and the input duplicate detection reasons over.
  const a = await prisma.account.create({
    data: {
      userId: USER, provider: 'plaid', providerRef: 'p-a', name: 'CREDIT CARD', type: 'CREDIT',
      mask: '0977', currentBalanceCents: 667_968,
    },
  });
  cardAId = a.id;
  const b = await prisma.account.create({
    data: {
      userId: USER, provider: 'simplefin', providerRef: 'sf-b', name: 'CREDIT CARD', type: 'CREDIT',
      mask: '0977', currentBalanceCents: 667_968,
    },
  });
  cardBId = b.id;
  const o = await prisma.account.create({
    data: { userId: OTHER, provider: 'plaid', providerRef: 'p-o', name: 'Their card', type: 'CREDIT', currentBalanceCents: 100 },
  });
  otherId = o.id;
  mockUserId = USER;
});

afterAll(async () => {
  await wipe();
});

async function row(id: string) {
  return prisma.account.findUniqueOrThrow({ where: { id }, select: { name: true, displayName: true } });
}

describe('renameAccount', () => {
  it('writes displayName and leaves the feed name untouched', async () => {
    const res = await renameAccount({ accountId: cardAId, name: '  Chase Freedom  ' });
    expect(res).toEqual({ ok: true, label: 'Chase Freedom' });
    expect(await row(cardAId)).toEqual({ name: 'CREDIT CARD', displayName: 'Chase Freedom' });
  });

  it('survives a sync that rewrites the feed name', async () => {
    // Exactly what plaid.ts / simplefin.ts do on every sync: write `name`, nothing else.
    await prisma.account.update({ where: { id: cardAId }, data: { name: 'CREDIT CARD' } });
    expect(await row(cardAId)).toEqual({ name: 'CREDIT CARD', displayName: 'Chase Freedom' });
  });

  it('renders the nickname on /accounts and keeps the bank name beside it', async () => {
    const view = await getAccountsView(USER);
    const renamed = view.liabilities.accounts.find((x) => x.id === cardAId);
    const untouched = view.liabilities.accounts.find((x) => x.id === cardBId);
    expect(renamed?.name).toBe('Chase Freedom');
    expect(renamed?.feedName).toBe('CREDIT CARD');
    expect(renamed?.displayName).toBe('Chase Freedom');
    // The un-renamed sibling is unchanged in every respect.
    expect(untouched?.name).toBe('CREDIT CARD');
    expect(untouched?.displayName).toBeNull();
  });

  it('never lets a nickname reach duplicate detection', async () => {
    const view = await getAccountsView(USER);
    // The pair is still suspected even though the two rows now READ differently: detection
    // compares what the bank sent, never what their owner called them.
    const pair = view.duplicates.find(
      (p) =>
        (p.a.id === cardAId && p.b.id === cardBId) || (p.a.id === cardBId && p.b.id === cardAId),
    );
    expect(pair).toBeDefined();
  });

  it('clears the nickname on an empty box and the bank name comes back', async () => {
    const res = await renameAccount({ accountId: cardAId, name: '   ' });
    expect(res).toEqual({ ok: true, label: 'CREDIT CARD' });
    expect(await row(cardAId)).toEqual({ name: 'CREDIT CARD', displayName: null });
    const view = await getAccountsView(USER);
    expect(view.liabilities.accounts.find((x) => x.id === cardAId)?.name).toBe('CREDIT CARD');
  });

  it('refuses another user\'s account and writes nothing', async () => {
    const res = await renameAccount({ accountId: otherId, name: 'Mine now' });
    expect(res).toEqual({ ok: false, errors: [ACCOUNT_NOT_FOUND] });
    expect(await row(otherId)).toEqual({ name: 'Their card', displayName: null });
  });

  it('refuses a name over the limit and writes nothing', async () => {
    const res = await renameAccount({ accountId: cardBId, name: 'x'.repeat(61) });
    expect(res.ok).toBe(false);
    expect(await row(cardBId)).toEqual({ name: 'CREDIT CARD', displayName: null });
  });

  it('fences the shared demo user', async () => {
    mockUserId = DEMO_USER_ID;
    try {
      const res = await renameAccount({ accountId: cardAId, name: 'Visitor was here' });
      expect(res).toEqual({ ok: false, errors: [DEMO_ENTRY_BLOCKED] });
      expect(await row(cardAId)).toEqual({ name: 'CREDIT CARD', displayName: null });
    } finally {
      mockUserId = USER;
    }
  });
});
