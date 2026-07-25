/**
 * TASKS L.10 layer 2, THE WIRING — `exchangePublicToken` is now allowed to refuse.
 *
 * The owner, verbatim (2026-07-24): *"Why in the heck are you allowed to make 2 of the same
 * accounts… when I try to link same account again, it just refreshes."* The pure decision
 * (`detectLinkCollision`) shipped in 4d262c4 with nothing calling it; this file locks what the
 * provider DOES with it, which is the half that can lose a user their bank.
 *
 * The asymmetry that shapes every test here: a MISSED collision leaves a duplicate the app
 * already discloses (#306) and can combine (#304), while a WRONG one hands a live connection
 * back to Plaid and cannot be undone. So the discard fires only when the new connection is
 * proven to carry nothing the user does not already have, and every ambiguity — an unresolved
 * institution, a failed fetch, another user's connection — links normally. Most of what
 * follows is a test that the app did NOT act.
 *
 * THE RULE TWO FRESH-CONTEXT CRITICS FORCED, and the reason half these tests exist: a
 * candidate connection is asked what it can reach RIGHT NOW, over the wire, before its
 * accounts are allowed to justify discarding anything. Both critics broke the first version
 * the same way — it authorised an irreversible `/item/remove` from Account rows in the
 * database, which keep describing a connection long after that connection has stopped being
 * able to reach them (an expired login, an account deselected in update mode, a row predating
 * the `plaidItemId` stamp).
 *
 * Runs the REAL PlaidProvider and the REAL database with `global.fetch` stubbed to a fake Plaid
 * server. The live socket remains UNVERIFIED against Plaid (no credentials in this environment).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { PlaidProvider } from '@/lib/providers/plaid';
import { encryptToken } from '@/lib/crypto';
import { prisma } from '@/lib/db';
import { mapPlaidAccountType, type PlaidAccount } from '@/lib/providers/plaid-map';

const KEY = Buffer.alloc(32, 7).toString('base64');

const ok = (json: unknown): Response => ({ ok: true, status: 200, json: async () => json }) as Response;
const fail = (status: number, body: unknown): Response =>
  ({ ok: false, status, json: async () => body, text: async () => JSON.stringify(body) }) as Response;

let newItemAccounts: PlaidAccount[];
let newItemInstitutionId: string | null;
/** What each EXISTING connection's token answers with — the live truth about that connection. */
let accountsByToken: Map<string, PlaidAccount[]>;
let accountsGetCalls: string[];
let removedTokens: string[];
let failAccountsGetFor: Set<string>;
let failRemove: boolean;

/** One account as Plaid describes it. Defaults to a credit card ending 4321. */
function acct(over: Partial<PlaidAccount> & { account_id: string }): PlaidAccount {
  return {
    name: 'Account',
    mask: '4321',
    type: 'credit',
    subtype: 'credit card',
    balances: { current: 100, available: null, limit: null, iso_currency_code: 'USD' },
    ...over,
  };
}

function mockServer() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: { body?: string }) => {
      const url = String(input);
      const body = JSON.parse(init?.body ?? '{}') as Record<string, string>;

      if (url.endsWith('/item/public_token/exchange')) {
        return ok({ access_token: `tok-${body.public_token}`, item_id: `item-${body.public_token}` });
      }
      if (url.endsWith('/item/get')) {
        return ok({ item: { item_id: 'x', institution_id: newItemInstitutionId } });
      }
      if (url.endsWith('/institutions/get_by_id')) {
        return ok({ institution: { institution_id: body.institution_id, name: 'Chase' } });
      }
      if (url.endsWith('/accounts/get')) {
        const token = body.access_token;
        accountsGetCalls.push(token);
        if (failAccountsGetFor.has(token)) {
          return fail(400, { error_code: 'ITEM_LOGIN_REQUIRED', error_type: 'ITEM_ERROR', request_id: 'r' });
        }
        return ok({ accounts: accountsByToken.get(token) ?? newItemAccounts });
      }
      if (url.endsWith('/item/remove')) {
        if (failRemove) {
          return fail(500, { error_code: 'INTERNAL_SERVER_ERROR', error_type: 'API_ERROR', request_id: 'r' });
        }
        removedTokens.push(body.access_token);
        return ok({ removed: true });
      }
      return fail(404, { error_code: 'NOT_MOCKED' });
    }),
  );
}

async function makeUser(tag: string): Promise<string> {
  const user = await prisma.user.create({
    data: { email: `plaid-collide-${tag}-${Date.now()}-${Math.random()}@aimplifi.test` },
  });
  return user.id;
}

interface ExistingOpts {
  /** Marks the connection broken: its last sync failed AND its login no longer answers. */
  readonly dead?: boolean;
  /** What the connection can ACTUALLY reach now, when that differs from its stored rows. */
  readonly liveAccounts?: PlaidAccount[];
  /** Leave the Account rows unstamped, as every row predating #256 is. */
  readonly unstamped?: boolean;
}

/** An EXISTING connection: its stored rows AND what its login answers with. */
async function existingConnection(
  userId: string,
  tag: string,
  institutionId: string | null,
  accounts: readonly PlaidAccount[],
  opts: ExistingOpts = {},
): Promise<string> {
  const itemId = `have-${tag}-${Date.now()}-${Math.random()}`;
  const token = `tok-have-${tag}`;
  await prisma.plaidItem.create({
    data: {
      userId,
      itemId,
      accessToken: encryptToken(token),
      institution: 'Chase',
      institutionId,
      ...(opts.dead ? { lastSyncError: 'reauth-required' } : {}),
    },
  });
  for (const [i, a] of accounts.entries()) {
    await prisma.account.create({
      data: {
        userId,
        provider: 'plaid',
        providerRef: `${itemId}-acct-${i}`,
        ...(opts.unstamped ? {} : { plaidItemId: itemId }),
        name: `Existing ${i}`,
        type: mapPlaidAccountType(a.type, a.subtype),
        mask: a.mask,
        subtype: a.subtype,
        currency: a.balances.iso_currency_code ?? 'USD',
        persistentAccountId: a.persistent_account_id ?? null,
        currentBalanceCents: 10_000,
      },
    });
  }
  if (opts.dead) failAccountsGetFor.add(token);
  else accountsByToken.set(token, [...(opts.liveAccounts ?? accounts)]);
  return itemId;
}

const liveItems = (userId: string) => prisma.plaidItem.count({ where: { userId } });

describe('exchangePublicToken — the door that refuses to create the duplicate (TASKS L.10 layer 2)', () => {
  beforeEach(() => {
    vi.stubEnv('DATA_ENCRYPTION_KEY', KEY);
    vi.stubEnv('PLAID_CLIENT_ID', 'test-id');
    vi.stubEnv('PLAID_SECRET', 'test-secret');
    vi.stubEnv('PLAID_ENV', 'sandbox');
    newItemAccounts = [];
    newItemInstitutionId = 'ins_chase';
    accountsByToken = new Map();
    accountsGetCalls = [];
    removedTokens = [];
    failAccountsGetFor = new Set();
    failRemove = false;
    mockServer();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('THE reported case: re-linking the same card writes no second connection and hands it back to Plaid', async () => {
    const userId = await makeUser('same');
    const kept = await existingConnection(userId, 'same', 'ins_chase', [acct({ account_id: 'have-1' })]);
    newItemAccounts = [acct({ account_id: 'new-1' })];

    const outcome = await new PlaidProvider().exchangePublicToken(userId, 'p-same');

    expect(outcome).toEqual({
      kind: 'already-connected',
      existingItemId: kept,
      institutionName: 'Chase',
      matchedAccountCount: 1,
    });
    // Nothing was persisted: one connection before, one after — and it is the ORIGINAL.
    expect(await liveItems(userId)).toBe(1);
    expect(await prisma.plaidItem.findUnique({ where: { itemId: 'item-p-same' } })).toBeNull();
    expect(await prisma.account.count({ where: { userId } })).toBe(1);
    // And the redundant Item was actually released at Plaid, not merely dropped on the floor.
    expect(removedTokens).toEqual(['tok-p-same']);
  });

  it('records the discard in the audit log — a connection thrown away is never invisible', async () => {
    const userId = await makeUser('audit');
    await existingConnection(userId, 'audit', 'ins_chase', [acct({ account_id: 'have-1' })]);
    newItemAccounts = [acct({ account_id: 'new-1' })];

    await new PlaidProvider().exchangePublicToken(userId, 'p-audit');

    const audits = await prisma.auditLog.findMany({
      where: { userId, action: 'plaid.item.link.redundant' },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.meta).toContain('item-p-audit');
    // The ordinary "you linked a bank" audit must NOT claim a link that did not happen.
    expect(await prisma.auditLog.count({ where: { userId, action: 'plaid.item.link' } })).toBe(0);
  });

  // ---- The refusals that must NOT happen. These are the tests that protect a real bank. ----

  it('test_regression__a_dead_connection_never_eats_the_relink_that_repairs_it', async () => {
    // Found by BOTH fresh-context critics, independently, as the P0. A bank stops updating —
    // the commonest reason anyone re-runs Link — and the user reconnects it. The stored rows
    // of the expired connection still match perfectly, so the first version discarded the
    // freshly re-authenticated credential, kept the broken one, and told the user it had
    // "refreshed that connection". The candidate is now asked over the wire and cannot answer.
    const userId = await makeUser('dead');
    await existingConnection(userId, 'dead', 'ins_chase', [acct({ account_id: 'have-1' })], {
      dead: true,
    });
    newItemAccounts = [acct({ account_id: 'new-1' })];

    const outcome = await new PlaidProvider().exchangePublicToken(userId, 'p-dead');

    expect(outcome).toMatchObject({ kind: 'linked', itemId: 'item-p-dead' });
    expect(removedTokens).toEqual([]);
    expect(await liveItems(userId)).toBe(2);
    // The working connection is the one that survived, and it holds the card.
    expect(await prisma.account.count({ where: { userId, providerRef: 'new-1' } })).toBe(1);
  });

  it('test_regression__a_stale_row_the_bank_no_longer_returns_cannot_justify_a_discard', async () => {
    // TASKS L.14: nothing prunes an Account row whose feed stops returning it (deselected in
    // update mode, or closed at the bank), so it keeps its balance and keeps counting. The
    // first version let that frozen row prove a match — converting a known staleness bug into
    // an irreversible one by revoking the only connection that could still reach the account.
    const userId = await makeUser('stale');
    await existingConnection(
      userId,
      'stale',
      'ins_chase',
      [acct({ account_id: 'have-1' }), acct({ account_id: 'have-2', mask: '8888' })],
      { liveAccounts: [acct({ account_id: 'have-1' })] }, // ····8888 is no longer shared
    );
    newItemAccounts = [acct({ account_id: 'new-1' }), acct({ account_id: 'new-2', mask: '8888' })];

    const outcome = await new PlaidProvider().exchangePublicToken(userId, 'p-stale');

    expect(outcome).toMatchObject({ kind: 'linked-with-overlap', newAccountCount: 1 });
    expect(removedTokens).toEqual([]);
    expect(await liveItems(userId)).toBe(2);
  });

  it("a SPOUSE'S login sharing one joint account keeps BOTH connections — it reaches a card the other cannot", async () => {
    const userId = await makeUser('spouse');
    await existingConnection(userId, 'spouse', 'ins_chase', [
      acct({ account_id: 'joint', mask: '1111', type: 'depository', subtype: 'checking' }),
      acct({ account_id: 'his', mask: '9999' }),
    ]);
    newItemAccounts = [
      acct({ account_id: 'joint-b', mask: '1111', type: 'depository', subtype: 'checking' }),
      acct({ account_id: 'hers', mask: '5555' }),
    ];

    const outcome = await new PlaidProvider().exchangePublicToken(userId, 'p-spouse');

    expect(outcome).toMatchObject({
      kind: 'linked-with-overlap',
      itemId: 'item-p-spouse',
      matchedAccountCount: 1,
      newAccountCount: 1,
    });
    expect(removedTokens).toEqual([]);
    expect(await liveItems(userId)).toBe(2);
    // Her card was actually written — the whole reason this link was kept.
    expect(await prisma.account.count({ where: { userId, mask: '5555' } })).toBe(1);
  });

  it('a different last-4 at the same bank is never a collision', async () => {
    const userId = await makeUser('mask');
    await existingConnection(userId, 'mask', 'ins_chase', [acct({ account_id: 'have-1', mask: '1111' })]);
    newItemAccounts = [acct({ account_id: 'new-1', mask: '2222' })];

    const outcome = await new PlaidProvider().exchangePublicToken(userId, 'p-mask');

    expect(outcome).toMatchObject({ kind: 'linked' });
    expect(removedTokens).toEqual([]);
    expect(await liveItems(userId)).toBe(2);
  });

  it('an unresolved institution abstains rather than comparing banks by name', async () => {
    const userId = await makeUser('noins');
    await existingConnection(userId, 'noins', 'ins_chase', [acct({ account_id: 'have-1' })]);
    newItemInstitutionId = null;
    newItemAccounts = [acct({ account_id: 'new-1' })];

    const outcome = await new PlaidProvider().exchangePublicToken(userId, 'p-noins');

    expect(outcome).toMatchObject({ kind: 'linked' });
    expect(removedTokens).toEqual([]);
    expect(await liveItems(userId)).toBe(2);
  });

  it("another user's connection at the same bank can never cost this user their link", async () => {
    const stranger = await makeUser('stranger');
    await existingConnection(stranger, 'stranger', 'ins_chase', [acct({ account_id: 'have-1' })]);
    const userId = await makeUser('victim');
    newItemAccounts = [acct({ account_id: 'new-1' })];

    const outcome = await new PlaidProvider().exchangePublicToken(userId, 'p-victim');

    expect(outcome).toMatchObject({ kind: 'linked' });
    expect(removedTokens).toEqual([]);
    expect(await liveItems(userId)).toBe(1);
  });

  it('the first link at a bank is an ordinary link, and its accounts are written', async () => {
    const userId = await makeUser('first');
    newItemAccounts = [acct({ account_id: 'new-1' })];

    const outcome = await new PlaidProvider().exchangePublicToken(userId, 'p-first');

    expect(outcome).toEqual({ kind: 'linked', itemId: 'item-p-first' });
    expect(await prisma.account.count({ where: { userId, providerRef: 'new-1' } })).toBe(1);
  });

  it('a failed accounts fetch on the NEW item still links the bank', async () => {
    const userId = await makeUser('fetchfail');
    await existingConnection(userId, 'fetchfail', 'ins_chase', [acct({ account_id: 'have-1' })]);
    failAccountsGetFor.add('tok-p-fetchfail');
    newItemAccounts = [acct({ account_id: 'new-1' })];

    await new PlaidProvider().exchangePublicToken(userId, 'p-fetchfail').catch(() => undefined);

    expect(removedTokens).toEqual([]);
    expect(await prisma.plaidItem.findUnique({ where: { itemId: 'item-p-fetchfail' } })).not.toBeNull();
  });

  it('test_regression__a_failed_revoke_keeps_the_item_instead_of_orphaning_a_billed_connection', async () => {
    // Critic finding: `/item/remove` throwing left a LIVE Plaid Item whose access token the app
    // had never stored — unremovable, invisible, and minted again on every retry, while the
    // user was told "linking failed". A visible duplicate they can combine is the lesser evil.
    const userId = await makeUser('removefail');
    await existingConnection(userId, 'removefail', 'ins_chase', [acct({ account_id: 'have-1' })]);
    newItemAccounts = [acct({ account_id: 'new-1' })];
    failRemove = true;

    const outcome = await new PlaidProvider().exchangePublicToken(userId, 'p-removefail');

    expect(outcome).toMatchObject({ kind: 'linked-with-overlap' });
    expect(await prisma.plaidItem.findUnique({ where: { itemId: 'item-p-removefail' } })).not.toBeNull();
    expect(await liveItems(userId)).toBe(2);
  });

  it('test_regression__an_unmappable_account_does_not_manufacture_a_duplicate', async () => {
    // Critic finding: an account whose type the mapper rejects (Plaid's `other`) never becomes
    // a row, so counting it as something this login "reaches" kept a second Item — duplicating
    // every visible account — to preserve access to something the user cannot see, under a
    // notice claiming the opposite. It is excluded from both counts.
    const userId = await makeUser('unmappable');
    await existingConnection(userId, 'unmappable', 'ins_chase', [acct({ account_id: 'have-1' })]);
    newItemAccounts = [
      acct({ account_id: 'new-1' }),
      acct({ account_id: 'odd', type: 'other', subtype: 'other', mask: '7777' }),
    ];

    const outcome = await new PlaidProvider().exchangePublicToken(userId, 'p-unmappable');

    expect(outcome).toMatchObject({ kind: 'already-connected', matchedAccountCount: 1 });
    expect(await liveItems(userId)).toBe(1);
    expect(await prisma.account.count({ where: { userId } })).toBe(1);
  });

  it('test_regression__an_account_reached_by_a_SIBLING_connection_is_not_counted_as_new', async () => {
    // Critic finding: the collision names ONE existing connection, so with three connections at
    // one bank the winner's "unmatched" set includes accounts a sibling already carries. Using
    // it told the user this login reached something new while a third copy was being created.
    const userId = await makeUser('sibling');
    await existingConnection(userId, 'sibling-a', 'ins_chase', [acct({ account_id: 'a1', mask: '1111' })]);
    await existingConnection(userId, 'sibling-b', 'ins_chase', [acct({ account_id: 'b1', mask: '2222' })]);
    newItemAccounts = [
      acct({ account_id: 'n1', mask: '1111' }),
      acct({ account_id: 'n2', mask: '2222' }),
    ];

    const outcome = await new PlaidProvider().exchangePublicToken(userId, 'p-sibling');

    // Every account is reachable already — through two different connections, but reachable.
    expect(outcome).toMatchObject({ kind: 'already-connected' });
    expect(await liveItems(userId)).toBe(2);
  });

  it('test_regression__an_unstamped_row_is_still_compared_because_the_bank_is_asked_directly', async () => {
    // Critic finding: rows predating the `plaidItemId` stamp (#256) were invisible to a
    // DB-driven comparison, so the app created the duplicate it exists to prevent. Asking the
    // connection what it reaches makes the stamp irrelevant.
    const userId = await makeUser('unstamped');
    await existingConnection(userId, 'unstamped', 'ins_chase', [acct({ account_id: 'have-1' })], {
      unstamped: true,
    });
    newItemAccounts = [acct({ account_id: 'new-1' })];

    const outcome = await new PlaidProvider().exchangePublicToken(userId, 'p-unstamped');

    expect(outcome).toMatchObject({ kind: 'already-connected' });
    expect(removedTokens).toEqual(['tok-p-unstamped']);
    expect(await liveItems(userId)).toBe(1);
  });

  it('an ordinary link pays for /accounts/get ONCE — the check reuses what it fetched', async () => {
    const userId = await makeUser('billing');
    newItemAccounts = [acct({ account_id: 'new-1' })];

    await new PlaidProvider().exchangePublicToken(userId, 'p-billing');

    expect(accountsGetCalls).toEqual(['tok-p-billing']);
  });
});
