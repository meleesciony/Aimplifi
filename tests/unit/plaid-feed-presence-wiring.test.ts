/**
 * TASKS L.14 — THE WIRING: what the Plaid provider does when a bank stops sharing an account.
 *
 * Plaid Link's update mode ships with `account_selection_enabled`, so a user can untick an
 * account. `upsertPlaidAccounts` only ever creates or updates, so nothing noticed: the row kept
 * its last balance, kept counting toward net worth and cash-needed, and kept reading as freshly
 * synced, because a Plaid row's freshness is graded from its BANK's last sync (#293) and the bank
 * was still syncing. This file locks the half that can go wrong at scale.
 *
 * THE ASYMMETRY that shapes every test here. A MISSED drop leaves the row exactly as the app has
 * always left it — stale and still counted, the pre-existing bug. A FALSE drop marks a live
 * account frozen and unlocks its Delete on the strength of one bad HTTP response. So absence is
 * evidence ONLY from a complete, wholly-readable `/accounts/get` census, and most of what follows
 * is a test that the app did NOT act.
 *
 * The single biggest hazard has its own test at the bottom: `/transactions/sync` echoes only the
 * accounts with transaction activity, so reading absence from THAT payload would mark every quiet
 * loan, card and brokerage as unshared on the first ordinary sync. `syncTransactions` calls both
 * endpoints in one pass, so the test drives the real thing rather than asserting the intent.
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
const ISO = /^\d{4}-\d{2}-\d{2}$/;

const ok = (json: unknown): Response => ({ ok: true, status: 200, json: async () => json }) as Response;
const fail = (status: number, body: unknown): Response =>
  ({ ok: false, status, json: async () => body, text: async () => JSON.stringify(body) }) as Response;

/** What `/accounts/get` answers with for a token — `undefined` means "return the raw value below". */
let accountsByToken: Map<string, PlaidAccount[]>;
/** A deliberately malformed `/accounts/get` body, keyed by token (a 200 with no usable list). */
let rawAccountsByToken: Map<string, unknown>;
/** What `/transactions/sync` echoes in its `accounts` array — the PARTIAL list. */
let syncEchoByToken: Map<string, PlaidAccount[]>;

function acct(over: Partial<PlaidAccount> & { account_id: string }): PlaidAccount {
  return {
    name: 'Account',
    mask: '4321',
    type: 'depository',
    subtype: 'checking',
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
      if (url.endsWith('/accounts/get')) {
        const token = body.access_token;
        if (rawAccountsByToken.has(token)) return ok(rawAccountsByToken.get(token));
        return ok({ accounts: accountsByToken.get(token) ?? [] });
      }
      if (url.endsWith('/transactions/sync')) {
        const token = body.access_token;
        return ok({
          accounts: syncEchoByToken.get(token) ?? [],
          added: [],
          modified: [],
          removed: [],
          next_cursor: 'cursor-1',
          has_more: false,
        });
      }
      if (url.endsWith('/item/get')) return ok({ item: { item_id: 'x', institution_id: 'ins_56' } });
      if (url.endsWith('/institutions/get_by_id')) {
        return ok({ institution: { institution_id: body.institution_id, name: 'Chase' } });
      }
      if (url.endsWith('/liabilities/get')) return ok({ accounts: [], liabilities: {} });
      if (url.endsWith('/investments/holdings/get')) return ok({ accounts: [], holdings: [], securities: [] });
      return fail(404, { error_code: 'NOT_MOCKED' });
    }),
  );
}

async function makeUser(tag: string): Promise<string> {
  const user = await prisma.user.create({
    data: { email: `feed-presence-${tag}-${Date.now()}-${Math.random()}@aimplifi.test` },
  });
  return user.id;
}

/** A connection plus one stored Account row per account, stamped with its item (post-#256). */
async function connection(
  userId: string,
  tag: string,
  accounts: readonly PlaidAccount[],
  opts: { unstamped?: boolean; droppedAt?: string } = {},
): Promise<{ itemId: string; token: string }> {
  const itemId = `item-${tag}-${Date.now()}-${Math.random()}`;
  const token = `tok-${itemId}`;
  await prisma.plaidItem.create({
    data: { userId, itemId, accessToken: encryptToken(token), institution: 'Chase', institutionId: 'ins_56' },
  });
  for (const a of accounts) {
    await prisma.account.create({
      data: {
        userId,
        provider: 'plaid',
        providerRef: a.account_id,
        ...(opts.unstamped ? {} : { plaidItemId: itemId }),
        ...(opts.droppedAt ? { feedDroppedAt: opts.droppedAt } : {}),
        name: a.name,
        type: mapPlaidAccountType(a.type, a.subtype),
        mask: a.mask,
        subtype: a.subtype,
        currency: 'USD',
        currentBalanceCents: 10_000,
      },
    });
  }
  return { itemId, token };
}

const droppedAtOf = async (userId: string, providerRef: string): Promise<string | null> =>
  (await prisma.account.findFirstOrThrow({ where: { userId, providerRef } })).feedDroppedAt;

describe('syncAccountsForItem — stamping the accounts a bank has stopped sharing (TASKS L.14)', () => {
  beforeEach(() => {
    vi.stubEnv('DATA_ENCRYPTION_KEY', KEY);
    vi.stubEnv('PLAID_CLIENT_ID', 'test-id');
    vi.stubEnv('PLAID_SECRET', 'test-secret');
    vi.stubEnv('PLAID_ENV', 'sandbox');
    accountsByToken = new Map();
    rawAccountsByToken = new Map();
    syncEchoByToken = new Map();
    mockServer();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('stamps the account the connection stopped returning, and leaves its sibling alone', async () => {
    const userId = await makeUser('drop');
    const kept = acct({ account_id: 'a-kept', name: 'Checking' });
    const gone = acct({ account_id: 'a-gone', name: 'Savings', subtype: 'savings' });
    const { itemId, token } = await connection(userId, 'drop', [kept, gone]);
    accountsByToken.set(token, [kept]); // the user unticked Savings

    await new PlaidProvider().syncAccountsForItem(userId, itemId);

    expect(await droppedAtOf(userId, 'a-gone')).toMatch(ISO);
    expect(await droppedAtOf(userId, 'a-kept')).toBeNull();
  });

  it('adjusts NO figure when it stamps — the balance is left exactly where it froze', async () => {
    // The whole design rests on this: the row keeps counting, and the app says so out loud. A
    // future change that starts zeroing dropped balances would make every disclosure this slice
    // ships ("still counted wherever Aimplifi adds up your accounts") a false statement.
    const userId = await makeUser('nofig');
    const kept = acct({ account_id: 'b-kept' });
    const gone = acct({ account_id: 'b-gone' });
    const { itemId, token } = await connection(userId, 'nofig', [kept, gone]);
    accountsByToken.set(token, [kept]);

    await new PlaidProvider().syncAccountsForItem(userId, itemId);

    const row = await prisma.account.findFirstOrThrow({ where: { userId, providerRef: 'b-gone' } });
    expect(row.currentBalanceCents).toBe(10_000);
  });

  it('does NOT move the date on a later sync — the first observation is the truthful one', async () => {
    const userId = await makeUser('idem');
    const kept = acct({ account_id: 'c-kept' });
    const gone = acct({ account_id: 'c-gone' });
    const { itemId, token } = await connection(userId, 'idem', [kept, gone]);
    accountsByToken.set(token, [kept]);
    await prisma.account.updateMany({
      where: { userId, providerRef: 'c-gone' },
      data: { feedDroppedAt: '2026-01-05' },
    });

    await new PlaidProvider().syncAccountsForItem(userId, itemId);

    expect(await droppedAtOf(userId, 'c-gone')).toBe('2026-01-05');
  });

  it('clears the stamp when the account comes back (the re-tick)', async () => {
    const userId = await makeUser('back');
    const back = acct({ account_id: 'd-back' });
    const { itemId, token } = await connection(userId, 'back', [back], { droppedAt: '2026-01-05' });
    accountsByToken.set(token, [back]);

    await new PlaidProvider().syncAccountsForItem(userId, itemId);

    expect(await droppedAtOf(userId, 'd-back')).toBeNull();
  });
});

describe('syncAccountsForItem — refusing to act on a payload it cannot trust', () => {
  beforeEach(() => {
    vi.stubEnv('DATA_ENCRYPTION_KEY', KEY);
    vi.stubEnv('PLAID_CLIENT_ID', 'test-id');
    vi.stubEnv('PLAID_SECRET', 'test-secret');
    vi.stubEnv('PLAID_ENV', 'sandbox');
    accountsByToken = new Map();
    rawAccountsByToken = new Map();
    syncEchoByToken = new Map();
    mockServer();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('an EMPTY account list drops nothing — it is an error state, not a mass unshare', async () => {
    const userId = await makeUser('empty');
    const a = acct({ account_id: 'e-1' });
    const b = acct({ account_id: 'e-2' });
    const { itemId, token } = await connection(userId, 'empty', [a, b]);
    accountsByToken.set(token, []);

    await new PlaidProvider().syncAccountsForItem(userId, itemId);

    expect(await droppedAtOf(userId, 'e-1')).toBeNull();
    expect(await droppedAtOf(userId, 'e-2')).toBeNull();
  });

  it('a 200 carrying no account array at all drops nothing (the #290 truncated-body class)', async () => {
    const userId = await makeUser('garbled');
    const a = acct({ account_id: 'f-1' });
    const b = acct({ account_id: 'f-2' });
    const { itemId, token } = await connection(userId, 'garbled', [a, b]);
    rawAccountsByToken.set(token, { item: { item_id: 'x' } }); // no `accounts` key

    await new PlaidProvider().syncAccountsForItem(userId, itemId);

    expect(await droppedAtOf(userId, 'f-1')).toBeNull();
    expect(await droppedAtOf(userId, 'f-2')).toBeNull();
  });

  it('one unreadable entry spares its readable neighbours', async () => {
    const userId = await makeUser('holey');
    const a = acct({ account_id: 'g-1' });
    const b = acct({ account_id: 'g-2' });
    const { itemId, token } = await connection(userId, 'holey', [a, b]);
    // A list with a hole in it is not a census, so g-2's absence proves nothing.
    rawAccountsByToken.set(token, { accounts: [{ ...a, account_id: null }] });

    await new PlaidProvider().syncAccountsForItem(userId, itemId);

    expect(await droppedAtOf(userId, 'g-1')).toBeNull();
    expect(await droppedAtOf(userId, 'g-2')).toBeNull();
  });

  it('never touches another connection’s rows at the same bank', async () => {
    const userId = await makeUser('sibling');
    const mine = acct({ account_id: 'h-mine' });
    const theirs = acct({ account_id: 'h-other' });
    const { itemId, token } = await connection(userId, 'sib-a', [mine]);
    await connection(userId, 'sib-b', [theirs]);
    accountsByToken.set(token, [mine]);

    await new PlaidProvider().syncAccountsForItem(userId, itemId);

    expect(await droppedAtOf(userId, 'h-other')).toBeNull();
  });

  it('never touches a row it cannot prove belongs to this connection (unstamped, pre-#256)', async () => {
    // The failure direction is a MISS, chosen deliberately: a null plaidItemId means "never
    // asked", and guessing could freeze an account belonging to a different bank entirely.
    const userId = await makeUser('unstamped');
    const seen = acct({ account_id: 'i-seen' });
    const orphan = acct({ account_id: 'i-orphan' });
    const { itemId, token } = await connection(userId, 'unstamped-a', [seen]);
    await connection(userId, 'unstamped-b', [orphan], { unstamped: true });
    accountsByToken.set(token, [seen]);

    await new PlaidProvider().syncAccountsForItem(userId, itemId);

    expect(await droppedAtOf(userId, 'i-orphan')).toBeNull();
  });

  it('never touches another USER’s row carrying the same provider ref', async () => {
    const mineUser = await makeUser('mine');
    const otherUser = await makeUser('other');
    const shared = acct({ account_id: 'j-shared' });
    const kept = acct({ account_id: 'j-kept' });
    const { itemId, token } = await connection(mineUser, 'mine', [kept, shared]);
    await connection(otherUser, 'other', [shared]);
    accountsByToken.set(token, [kept]);

    await new PlaidProvider().syncAccountsForItem(mineUser, itemId);

    expect(await droppedAtOf(mineUser, 'j-shared')).toMatch(ISO);
    expect(await droppedAtOf(otherUser, 'j-shared')).toBeNull();
  });
});

describe('critic F-2 — a dropped brokerage keeps its holdings, so the disclosure stays true', () => {
  beforeEach(() => {
    vi.stubEnv('DATA_ENCRYPTION_KEY', KEY);
    vi.stubEnv('PLAID_CLIENT_ID', 'test-id');
    vi.stubEnv('PLAID_SECRET', 'test-secret');
    vi.stubEnv('PLAID_ENV', 'sandbox');
    accountsByToken = new Map();
    rawAccountsByToken = new Map();
    syncEchoByToken = new Map();
    mockServer();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('does not prune positions for an account the feed no longer carries', async () => {
    // Executed by the critic: the holdings sweep filters the payload by the account's providerRef,
    // so an unticked brokerage yields zero rows with `skipped === 0` — read as "sold everything"
    // — and every plaid-sourced position was DELETED. /investments then showed a portfolio
    // $50,000 smaller (or the "No investment holdings yet" empty state) while net worth still
    // counted the balance and the dashboard told the reader it was counted everywhere. That made
    // the shipped sentence false, which is why the fix is here and not in the copy: absence of
    // holdings for an unshared account is not a sale, the same argument this module already makes
    // for a truncated securities list (#290), one level up.
    const userId = await makeUser('holdings');
    const brokerage = acct({
      account_id: 'n-brk',
      name: 'Brokerage',
      type: 'investment',
      subtype: 'brokerage',
    });
    const { itemId, token } = await connection(userId, 'holdings', [brokerage]);
    const row = await prisma.account.findFirstOrThrow({ where: { userId, providerRef: 'n-brk' } });
    await prisma.holding.create({
      data: {
        accountId: row.id,
        source: 'plaid',
        symbol: 'VTI',
        quantity: 100,
        costBasisCents: 2_000_000,
        priceCents: 50_000,
        marketValueCents: 5_000_000,
      },
    });
    // The account is unticked: the census stops carrying it, and so does the holdings payload.
    accountsByToken.set(token, []);
    await prisma.account.updateMany({
      where: { id: row.id },
      data: { feedDroppedAt: '2026-07-19' },
    });

    await new PlaidProvider().syncHoldings(userId, { itemId });

    expect(await prisma.holding.count({ where: { accountId: row.id } })).toBe(1);
  });
});

describe('syncTransactions — the partial account echo must never be read as a drop', () => {
  beforeEach(() => {
    vi.stubEnv('DATA_ENCRYPTION_KEY', KEY);
    vi.stubEnv('PLAID_CLIENT_ID', 'test-id');
    vi.stubEnv('PLAID_SECRET', 'test-secret');
    vi.stubEnv('PLAID_ENV', 'sandbox');
    accountsByToken = new Map();
    rawAccountsByToken = new Map();
    syncEchoByToken = new Map();
    mockServer();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('a quiet loan absent from the /transactions/sync echo is NOT marked unshared', async () => {
    // THE hazard this whole design is scoped around. `/transactions/sync` echoes only accounts
    // with transaction activity, so a mortgage, a paid-off card and a brokerage are routinely
    // missing from it. Reading absence there would freeze exactly the accounts whose balances
    // matter most, on the first ordinary sync after deploy, for every Plaid user at once.
    const userId = await makeUser('echo');
    const busy = acct({ account_id: 'k-busy', name: 'Checking' });
    const quiet = acct({ account_id: 'k-quiet', name: 'Mortgage', type: 'loan', subtype: 'mortgage' });
    const { itemId, token } = await connection(userId, 'echo', [busy, quiet]);
    accountsByToken.set(token, [busy, quiet]); // the CENSUS still has both…
    syncEchoByToken.set(token, [busy]); // …but only Checking had activity

    await new PlaidProvider().syncTransactions(userId, { itemId });

    expect(await droppedAtOf(userId, 'k-quiet')).toBeNull();
    expect(await droppedAtOf(userId, 'k-busy')).toBeNull();
  });

  it('an ordinary sync still stamps a genuinely unticked account', async () => {
    // The mirror of the test above: the guard must not have been bought by disabling detection.
    const userId = await makeUser('echo-drop');
    const busy = acct({ account_id: 'm-busy' });
    const unticked = acct({ account_id: 'm-unticked' });
    const { itemId, token } = await connection(userId, 'echo-drop', [busy, unticked]);
    accountsByToken.set(token, [busy]);
    syncEchoByToken.set(token, [busy]);

    await new PlaidProvider().syncTransactions(userId, { itemId });

    expect(await droppedAtOf(userId, 'm-unticked')).toMatch(ISO);
  });
});
