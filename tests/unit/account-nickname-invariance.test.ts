/**
 * test_regression__nickname_never_decides (TASKS L.7, hostile-critic cycle 1).
 *
 * The load-bearing claim of the two-column design is that a name the USER typed can change what
 * a screen SAYS and never what the app DECIDES. Cycle 1 broke it: `buildCombineInputs` was
 * handing the planner `accountLabel(a)`, the planner sorts its rows by name, and its direction
 * is order-dependent through the `claimed` set — so a cosmetic rename inverted which Plaid
 * connection the card recommends disconnecting, and confirming that revokes a Plaid item.
 *
 * The lock is the shape the critic proposed: run the real planner twice over identical data
 * differing ONLY in `displayName`, and require byte-equal output. Written so it fails on any
 * future re-introduction anywhere in the mapper, not just on the line that caused it.
 *
 * Also locked here: no ingest path may write `displayName` (the rename survives a sync because
 * nothing overwrites it — an assertion the server test could only make about code it re-wrote
 * by hand), and the audit row records that a rename happened without recording the name.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type CombineItemRow, buildCombineInputs } from '@/server/combine-connections';
import { explainUncombinableConnections, planCombinableConnections } from '@/lib/engine/account/combine-connections';

let mockUserId = '';
// `@/server/authz` cannot be partially mocked here — importing the real module pulls in
// next-auth, which needs a request context. `auditLog`'s body is reproduced faithfully (it is
// three lines: one `auditLog.create` with `JSON.stringify(meta)`), because the claim under test
// is what the ACTION passes as `meta`, not how authz serializes it.
vi.mock('@/server/authz', () => ({
  requireUserId: async () => mockUserId,
  auditLog: async (userId: string, action: string, meta: Record<string, unknown> = {}) => {
    const { prisma: db } = await import('@/lib/db');
    await db.auditLog.create({ data: { userId, action, meta: JSON.stringify(meta) } });
  },
  rateLimitDurable: async () => true,
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

const { prisma } = await import('@/lib/db');
const { renameAccount } = await import('@/server/account-rename-actions');

/** Two Chase connections whose accounts collide the way the owner's real ones do. */
const ITEMS: CombineItemRow[] = [
  { itemId: 'item-keep', institution: 'Chase', institutionId: 'ins_56', lastSyncedAt: '2026-07-20', lastSyncError: null, createdAt: new Date('2026-01-01') },
  { itemId: 'item-drop', institution: 'Chase', institutionId: 'ins_56', lastSyncedAt: '2026-07-20', lastSyncError: null, createdAt: new Date('2026-02-01') },
];

function accountRows(alphaName: string) {
  const base = {
    provider: 'plaid',
    type: 'CREDIT',
    currency: 'USD',
    subtype: 'credit card',
    institutionId: 'ins_56',
    institutionName: 'Chase',
  };
  return [
    { ...base, id: 'k1', name: alphaName, mask: '0977', plaidItemId: 'item-keep', persistentAccountId: null },
    { ...base, id: 'k2', name: 'Beta Card', mask: '0977', plaidItemId: 'item-keep', persistentAccountId: 'pa-2' },
    { ...base, id: 'd1', name: alphaName, mask: '0977', plaidItemId: 'item-drop', persistentAccountId: null },
    { ...base, id: 'd2', name: 'Beta Card', mask: '0977', plaidItemId: 'item-drop', persistentAccountId: 'pa-2' },
  ];
}

/** Everything this pair of connections produces for the reader: the offer, and — when there is
 *  no offer — the stated reason there isn't one, which names accounts too. */
function decide(rows: ReturnType<typeof accountRows>) {
  const { engineItems, engineAccounts } = buildCombineInputs(ITEMS, rows);
  return {
    offers: planCombinableConnections(engineItems, engineAccounts),
    blocked: explainUncombinableConnections(engineItems, engineAccounts),
  };
}

describe('a nickname never decides which accounts are combined', () => {
  it('the planner decides identically with and without a nickname', () => {
    // The SAME rows, renamed by the user to something that sorts the other way. Nothing else
    // differs: same ids, masks, types, subtypes, persistent ids, connections.
    const renamed = accountRows('Alpha Card').map((a) =>
      a.name === 'Alpha Card' ? { ...a, displayName: 'Zulu Card' } : a,
    );
    expect(decide(renamed)).toEqual(decide(accountRows('Alpha Card')));
  });

  it("but the planner IS sensitive to the feed's own name — so the test above is not vacuous", () => {
    // Renaming the row AT THE FEED, on this same fixture, changes which account the app names
    // in its user-facing explanation ("Alpha Card" → "Beta Card"). That is exactly the
    // sensitivity the assertion above has to survive; if this ever stops differing, that
    // assertion is comparing a planner that ignores names entirely and proves nothing.
    expect(decide(accountRows('Zulu Card'))).not.toEqual(decide(accountRows('Alpha Card')));
  });

  it('the mapper does not carry a nickname into the engine at all', () => {
    const renamed = accountRows('Alpha Card').map((a) => ({ ...a, displayName: 'Whatever' }));
    const { engineAccounts } = buildCombineInputs(ITEMS, renamed);
    expect(engineAccounts.map((a) => a.name)).toEqual(['Alpha Card', 'Beta Card', 'Alpha Card', 'Beta Card']);
  });
});

describe('no ingest path writes displayName', () => {
  // The rename survives a sync only because nothing overwrites the column. A test that
  // hand-writes `prisma.account.update({ data: { name } })` asserts that about code it wrote
  // itself; this asserts it about the real ingest modules.
  it.each(['src/lib/providers/plaid.ts', 'src/lib/providers/simplefin.ts', 'src/lib/providers/demo.ts'])(
    '%s never mentions displayName',
    (file) => {
      expect(readFileSync(join(process.cwd(), file), 'utf8')).not.toMatch(/displayName/);
    },
  );
});

describe('the rename audit row', () => {
  const USER = `rename-audit-${Date.now()}-${process.pid}`;
  let accountId = '';

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { id: USER } });
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    const a = await prisma.account.create({
      data: { userId: USER, provider: 'plaid', name: 'CREDIT CARD', type: 'CREDIT', currentBalanceCents: 1000 },
    });
    accountId = a.id;
    mockUserId = USER;
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: USER } });
  });

  it('records that he renamed it, and does not record what he called it', async () => {
    const secret = 'Divorce lawyer card';
    expect(await renameAccount({ accountId, name: secret })).toEqual({ ok: true, label: secret });

    const rows = await prisma.auditLog.findMany({ where: { userId: USER, action: 'account.rename' } });
    expect(rows).toHaveLength(1);
    // The claim in the action's comment, asserted against the row that was actually written.
    expect(rows[0].meta).not.toContain(secret);
    expect(JSON.parse(rows[0].meta as string)).toEqual({ id: accountId, cleared: false, length: secret.length });
  });

  it('refuses a non-string name instead of throwing, and writes nothing', async () => {
    const before = await prisma.account.findUniqueOrThrow({ where: { id: accountId }, select: { displayName: true } });
    // A `'use server'` endpoint is directly POST-able, so this is a reachable input.
    const res = await renameAccount({ accountId, name: 12345 as unknown as string });
    expect(res.ok).toBe(false);
    expect(await prisma.account.findUniqueOrThrow({ where: { id: accountId }, select: { displayName: true } })).toEqual(before);
  });
});
