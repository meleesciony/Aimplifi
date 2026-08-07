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
/** Which bank each token's item belongs to, when it differs from the new item's. */
let institutionByToken: Map<string, string | null>;
let accountsGetCalls: string[];
let itemGetCalls: string[];
let removedTokens: string[];
let failAccountsGetFor: Set<string>;
let failItemGetFor: Set<string>;
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
        const token = body.access_token;
        itemGetCalls.push(token);
        if (failItemGetFor.has(token)) {
          return fail(400, { error_code: 'ITEM_LOGIN_REQUIRED', error_type: 'ITEM_ERROR', request_id: 'r' });
        }
        const institutionId = institutionByToken.has(token)
          ? institutionByToken.get(token)!
          : newItemInstitutionId;
        return ok({ item: { item_id: 'x', institution_id: institutionId } });
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
    institutionByToken = new Map();
    accountsGetCalls = [];
    itemGetCalls = [];
    removedTokens = [];
    failAccountsGetFor = new Set();
    failItemGetFor = new Set();
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

  // ---- TASKS L.17: the two paths that still created a duplicate ----------------------------

  it('test_regression__a_connection_linked_before_the_institution_id_column_is_still_a_candidate', async () => {
    // L.17(a). Candidates were selected by `PlaidItem.institutionId`, which is NULL on every
    // connection linked before that column shipped — including every one the owner had when
    // layer 2 was built. So the door was a no-op at exactly those banks until an ordinary sync
    // happened to backfill them, and nothing said the protection was off. The bank is now asked
    // directly for any candidate that cannot name it.
    const userId = await makeUser('nullins');
    const kept = await existingConnection(userId, 'nullins', null, [acct({ account_id: 'have-1' })]);
    newItemAccounts = [acct({ account_id: 'new-1' })];

    const outcome = await new PlaidProvider().exchangePublicToken(userId, 'p-nullins');

    expect(outcome).toMatchObject({ kind: 'already-connected', existingItemId: kept });
    expect(await liveItems(userId)).toBe(1);
    expect(removedTokens).toEqual(['tok-p-nullins']);
    // The id it had to buy is written back, so the next link at this bank pays nothing for it.
    const row = await prisma.plaidItem.findUnique({ where: { itemId: kept } });
    expect(row?.institutionId).toBe('ins_chase');
  });

  it('a null-id connection at a DIFFERENT bank is no candidate, and its bank is remembered anyway', async () => {
    const userId = await makeUser('nullins-other');
    institutionByToken.set('tok-have-nullins-other', 'ins_boa');
    const other = await existingConnection(userId, 'nullins-other', null, [
      acct({ account_id: 'have-1' }),
    ]);
    newItemAccounts = [acct({ account_id: 'new-1' })];

    const outcome = await new PlaidProvider().exchangePublicToken(userId, 'p-nullins-other');

    expect(outcome).toMatchObject({ kind: 'linked' });
    expect(removedTokens).toEqual([]);
    expect(await liveItems(userId)).toBe(2);
    const row = await prisma.plaidItem.findUnique({ where: { itemId: other } });
    expect(row?.institutionId).toBe('ins_boa');
  });

  it('a null-id connection whose bank cannot be resolved proves nothing, and the new link is kept', async () => {
    const userId = await makeUser('nullins-fail');
    await existingConnection(userId, 'nullins-fail', null, [acct({ account_id: 'have-1' })]);
    failItemGetFor.add('tok-have-nullins-fail');
    newItemAccounts = [acct({ account_id: 'new-1' })];

    const outcome = await new PlaidProvider().exchangePublicToken(userId, 'p-nullins-fail');

    expect(outcome).toMatchObject({ kind: 'linked' });
    expect(removedTokens).toEqual([]);
    expect(await liveItems(userId)).toBe(2);
  });

  it('a candidate that already knows its bank is never re-bought — Plaid bills per request', async () => {
    const userId = await makeUser('noreBuy');
    await existingConnection(userId, 'noreBuy', 'ins_chase', [acct({ account_id: 'have-1', mask: '1111' })]);
    newItemAccounts = [acct({ account_id: 'new-1', mask: '2222' })];

    await new PlaidProvider().exchangePublicToken(userId, 'p-noreBuy');

    // Only the new item's own institution lookup. The candidate's id was already stored.
    expect(itemGetCalls).toEqual(['tok-p-noreBuy']);
  });

  it('test_regression__two_link_sessions_at_one_bank_at_once_do_not_both_persist', async () => {
    // L.17(b). The decision READ the user's connections at this bank and then wrote one, with
    // nothing between the read and the write: two tabs (or a double-tap) both saw zero
    // connections and both persisted, so invariant D1 held by sequence rather than by
    // construction. Two Link sessions at one bank mint DIFFERENT account_ids for the same
    // card, so the duplicate is two Items and two rows for one real account.
    const userId = await makeUser('race');
    accountsByToken.set('tok-race-a', [acct({ account_id: 'ra-1' })]);
    accountsByToken.set('tok-race-b', [acct({ account_id: 'rb-1' })]);

    const provider = new PlaidProvider();
    const outcomes = await Promise.all([
      provider.exchangePublicToken(userId, 'race-a'),
      provider.exchangePublicToken(userId, 'race-b'),
    ]);

    expect(await liveItems(userId)).toBe(1);
    expect(await prisma.account.count({ where: { userId } })).toBe(1);
    expect(outcomes.map((o) => o.kind).sort()).toEqual(['already-connected', 'linked']);
  });

  it('test_regression__an_abandoned_lease_never_walls_off_the_bank', async () => {
    // The lease is the only thing standing between a user and their bank on this path, so a
    // claim left behind by a request that died must be TAKEN OVER, not waited on. Told apart
    // from "waited, gave up, proceeded anyway" structurally: the stale row is gone afterwards,
    // which only a takeover can do (release only ever deletes the claim it created).
    const userId = await makeUser('stale-claim');
    await prisma.plaidLinkClaim.create({
      data: { userId, institutionId: 'ins_chase', expiresAt: new Date(Date.now() - 60_000) },
    });
    await existingConnection(userId, 'stale-claim', 'ins_chase', [acct({ account_id: 'have-1' })]);
    newItemAccounts = [acct({ account_id: 'new-1' })];

    const outcome = await new PlaidProvider().exchangePublicToken(userId, 'p-stale-claim');

    expect(outcome).toMatchObject({ kind: 'already-connected' });
    expect(await prisma.plaidLinkClaim.count({ where: { userId } })).toBe(0);
  });

  it('a lease held by a link still in flight is waited for, and the link still completes', async () => {
    const userId = await makeUser('held-claim');
    await prisma.plaidLinkClaim.create({
      data: { userId, institutionId: 'ins_chase', expiresAt: new Date(Date.now() + 250) },
    });
    newItemAccounts = [acct({ account_id: 'new-1' })];

    const outcome = await new PlaidProvider().exchangePublicToken(userId, 'p-held-claim');

    expect(outcome).toMatchObject({ kind: 'linked' });
    expect(await liveItems(userId)).toBe(1);
    expect(await prisma.plaidLinkClaim.count({ where: { userId } })).toBe(0);
  });

  it('test_regression__a_link_that_throws_still_releases_its_lease', async () => {
    // A leaked claim would make the next link at that bank wait out the whole window before
    // proceeding unprotected — the protection turning into the obstacle.
    const userId = await makeUser('throw-claim');
    failAccountsGetFor.add('tok-p-throw-claim');
    newItemAccounts = [acct({ account_id: 'new-1' })];

    await new PlaidProvider().exchangePublicToken(userId, 'p-throw-claim').catch(() => undefined);

    expect(await prisma.plaidLinkClaim.count({ where: { userId } })).toBe(0);
  });

  it('two links at DIFFERENT banks at once do not queue behind each other', async () => {
    const userId = await makeUser('two-banks');
    institutionByToken.set('tok-bank-a', 'ins_chase');
    institutionByToken.set('tok-bank-b', 'ins_boa');
    accountsByToken.set('tok-bank-a', [acct({ account_id: 'a-1', mask: '1111' })]);
    accountsByToken.set('tok-bank-b', [acct({ account_id: 'b-1', mask: '2222' })]);

    const provider = new PlaidProvider();
    const outcomes = await Promise.all([
      provider.exchangePublicToken(userId, 'bank-a'),
      provider.exchangePublicToken(userId, 'bank-b'),
    ]);

    expect(outcomes.map((o) => o.kind)).toEqual(['linked', 'linked']);
    expect(await liveItems(userId)).toBe(2);
  });

  it("a stranger's lease at the same bank can never delay or cost this user their link", async () => {
    const stranger = await makeUser('claim-stranger');
    await prisma.plaidLinkClaim.create({
      data: {
        userId: stranger,
        institutionId: 'ins_chase',
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const userId = await makeUser('claim-victim');
    newItemAccounts = [acct({ account_id: 'new-1' })];

    const outcome = await new PlaidProvider().exchangePublicToken(userId, 'p-claim-victim');

    expect(outcome).toMatchObject({ kind: 'linked' });
    expect(await prisma.plaidLinkClaim.count({ where: { userId: stranger } })).toBe(1);
  });

  it('an ordinary link pays for /accounts/get ONCE — the check reuses what it fetched', async () => {
    const userId = await makeUser('billing');
    newItemAccounts = [acct({ account_id: 'new-1' })];

    await new PlaidProvider().exchangePublicToken(userId, 'p-billing');

    expect(accountsGetCalls).toEqual(['tok-p-billing']);
  });

  // ---- H.6 / DECISIONS #424: the deliberate re-link for DEPTH ------------------------------
  //
  // Owner, 2026-08-07: "Unacceptable we don't have at least plaid maximal dates." Plaid freezes
  // an Item's transaction window when Transactions is added to it and names /item/remove plus a
  // fresh Link as the only way to widen it — so the connection carrying two years of history is
  // necessarily a SECOND connection returning the SAME accounts, which is exactly the shape the
  // tests above prove this door destroys. These lock the one exemption, and lock that it stays
  // one: everything not started from "get the full two years" must still be refused.

  it('a deepen-history link is KEPT even though it is wholly redundant — the 730-day window can arrive no other way', async () => {
    const userId = await makeUser('deepen');
    const shallow = await existingConnection(userId, 'deepen', 'ins_chase', [
      acct({ account_id: 'have-1' }),
    ]);
    newItemAccounts = [acct({ account_id: 'new-1' })];

    const outcome = await new PlaidProvider().exchangePublicToken(userId, 'p-deepen', {
      deepenHistory: true,
    });

    expect(outcome).toEqual({
      kind: 'linked-for-history',
      itemId: 'item-p-deepen',
      existingItemId: shallow,
      institutionName: 'Chase',
      matchedAccountCount: 1,
    });
    // The credential this link exists to obtain was NOT handed back to Plaid.
    expect(removedTokens).toEqual([]);
    // Both connections live: the shallow one still holds the history already stored, the deep
    // one is the source going forward, and the owner combines them from /accounts.
    expect(await liveItems(userId)).toBe(2);
    expect(await prisma.plaidItem.findUnique({ where: { itemId: 'item-p-deepen' } })).not.toBeNull();
    // A second Account row is the POINT, not a defect: it is the row the deeper history lands
    // on, and it is what the combine step folds the old one into.
    expect(await prisma.account.count({ where: { userId } })).toBe(2);
  });

  it('test_regression__the_deepen_exemption_is_the_flag_and_not_the_new_branch', async () => {
    // The whole risk of #424 is that the exemption leaks into the ordinary front door and
    // quietly repeals L.10 for everyone. Same fixture as the test above, flag explicitly OFF:
    // the discard must still fire, or the owner's original complaint is back.
    const userId = await makeUser('deepen-off');
    const kept = await existingConnection(userId, 'deepen-off', 'ins_chase', [
      acct({ account_id: 'have-1' }),
    ]);
    newItemAccounts = [acct({ account_id: 'new-1' })];

    const outcome = await new PlaidProvider().exchangePublicToken(userId, 'p-deepen-off', {
      deepenHistory: false,
    });

    expect(outcome).toMatchObject({ kind: 'already-connected', existingItemId: kept });
    expect(removedTokens).toEqual(['tok-p-deepen-off']);
    expect(await liveItems(userId)).toBe(1);
  });

  it('a deepen link that reaches something new is still reported as an OVERLAP, not as a history link', async () => {
    // `linked-for-history` claims "same accounts, deeper history, go and combine them" — and
    // combining is offered only when dropping a side strands nothing. A login that reaches an
    // account the old one cannot is precisely the case where that promise would be false, so
    // the flag must not be allowed to relabel it.
    const userId = await makeUser('deepen-partial');
    const kept = await existingConnection(userId, 'deepen-partial', 'ins_chase', [
      acct({ account_id: 'have-1', mask: '1111' }),
    ]);
    newItemAccounts = [
      acct({ account_id: 'new-1', mask: '1111' }),
      acct({ account_id: 'new-2', mask: '2222' }),
    ];

    const outcome = await new PlaidProvider().exchangePublicToken(userId, 'p-deepen-partial', {
      deepenHistory: true,
    });

    expect(outcome).toMatchObject({
      kind: 'linked-with-overlap',
      existingItemId: kept,
      matchedAccountCount: 1,
      newAccountCount: 1,
    });
    expect(removedTokens).toEqual([]);
  });

  it('a deepen link at a bank the user does NOT have is an ordinary link — the flag adds no state of its own', async () => {
    const userId = await makeUser('deepen-fresh');
    newItemAccounts = [acct({ account_id: 'new-1' })];

    const outcome = await new PlaidProvider().exchangePublicToken(userId, 'p-deepen-fresh', {
      deepenHistory: true,
    });

    expect(outcome).toMatchObject({ kind: 'linked' });
    expect(await liveItems(userId)).toBe(1);
  });
});
