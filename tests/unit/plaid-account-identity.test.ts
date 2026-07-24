/**
 * Account identity capture — TASKS L.10 slice 1 (docs/ACCOUNT_IDENTITY_ARCHITECTURE.md §6).
 *
 * The app could not tell "one real account pulled twice" from "two accounts that look
 * alike" because it stored nothing that survives a re-link: a Plaid row is keyed on
 * `account_id`, which a second Link session at the same bank re-mints, and there was no
 * `subtype` at all — so a Roth IRA and a Traditional IRA were both just `INVESTMENT`
 * (TASKS L.9, where that gap proposed merging one into the other).
 *
 * This slice only CAPTURES the three identifiers. Nothing reads them yet, and no figure,
 * route or piece of copy changes — the ladder that consumes them is slice 3. What is
 * locked here is that they arrive, that they arrive on accounts linked BEFORE the columns
 * existed (the owner's, on their next ordinary sync — no re-link, no migration), and that
 * a fetch which merely omits one can never erase one already stored.
 *
 * Runs the REAL PlaidProvider against a throwaway user with `global.fetch` stubbed to a
 * fake Plaid server. The live socket stays UNVERIFIED against Plaid.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { mapPlaidAccount, type PlaidAccount } from '@/lib/providers/plaid-map';
import { PlaidProvider } from '@/lib/providers/plaid';
import { encryptToken } from '@/lib/crypto';
import { prisma } from '@/lib/db';

const KEY = Buffer.alloc(32, 7).toString('base64');
const ITEM_ID = 'item-identity-1';

const ok = (json: unknown): Response =>
  ({ ok: true, status: 200, json: async () => json }) as Response;
const fail = (status: number, body: unknown): Response =>
  ({ ok: false, status, json: async () => body, text: async () => JSON.stringify(body) }) as Response;

const acct = (
  over: Partial<PlaidAccount> & Pick<PlaidAccount, 'account_id' | 'type'>,
): PlaidAccount => ({
  name: over.account_id,
  mask: null,
  subtype: null,
  balances: { current: 0, available: null, limit: null },
  ...over,
});

describe('mapPlaidAccount — identity fields (pure)', () => {
  it('carries subtype and persistent_account_id through verbatim', () => {
    const m = mapPlaidAccount(
      acct({
        account_id: 'acc-1',
        type: 'credit',
        subtype: 'credit card',
        persistent_account_id: 'PAI-abc123',
      }),
    );
    expect(m.subtype).toBe('credit card');
    expect(m.persistentAccountId).toBe('PAI-abc123');
    // The app's own closed-set `type` is what every engine reads, and it is derived exactly
    // as before — capturing the raw subtype changes no classification.
    expect(m.type).toBe('CREDIT');
  });

  it('preserves the provider’s own casing and wording — this is evidence, not vocabulary', () => {
    // A Roth vs a Traditional IRA is the distinction this column exists for (L.9). Mapping
    // it onto some tidier internal set here would be the app inventing a fact it was given.
    const roth = mapPlaidAccount(
      acct({ account_id: 'ira-1', type: 'investment', subtype: 'Roth IRA' }),
    );
    expect(roth.subtype).toBe('Roth IRA');
    expect(mapPlaidAccount(acct({ account_id: 'ira-2', type: 'investment', subtype: 'traditional' })).subtype).toBe(
      'traditional',
    );
  });

  it('treats absent, null and blank as null — a blank string is not an identifier', () => {
    const absent = mapPlaidAccount(acct({ account_id: 'acc-2', type: 'depository' }));
    expect(absent.subtype).toBeNull();
    expect(absent.persistentAccountId).toBeNull();

    const blank = mapPlaidAccount(
      acct({ account_id: 'acc-3', type: 'depository', subtype: '  ', persistent_account_id: '' }),
    );
    expect(blank.subtype).toBeNull();
    expect(blank.persistentAccountId).toBeNull();
  });

  it('trims surrounding whitespace so an id never differs from itself by a space', () => {
    const m = mapPlaidAccount(
      acct({
        account_id: 'acc-4',
        type: 'depository',
        subtype: ' checking ',
        persistent_account_id: ' PAI-xyz ',
      }),
    );
    expect(m.subtype).toBe('checking');
    expect(m.persistentAccountId).toBe('PAI-xyz');
  });
});

describe('Plaid account upsert — identity capture (real provider, mocked Plaid server)', () => {
  const USER = `plaid-identity-${Date.now()}-${process.pid}`;
  let accountsGetResponse: () => Response;

  async function wipe() {
    await prisma.account.deleteMany({ where: { userId: USER } });
    await prisma.plaidItem.deleteMany({ where: { userId: USER } });
    await prisma.auditLog.deleteMany({ where: { userId: USER } });
    await prisma.user.deleteMany({ where: { id: USER } });
  }

  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: USER, email: `${USER}@aimplifi.test` } });
  });
  afterAll(wipe);

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv('DATA_ENCRYPTION_KEY', KEY);
    vi.stubEnv('PLAID_CLIENT_ID', 'test-id');
    vi.stubEnv('PLAID_SECRET', 'test-secret');
    vi.stubEnv('PLAID_ENV', 'sandbox');
    await prisma.account.deleteMany({ where: { userId: USER } });
    await prisma.plaidItem.deleteMany({ where: { userId: USER } });
    await prisma.plaidItem.create({
      data: {
        userId: USER,
        itemId: ITEM_ID,
        accessToken: encryptToken('access-tok', Buffer.from(KEY, 'base64')),
      },
    });
    accountsGetResponse = () => ok({ accounts: [] });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.endsWith('/accounts/get')) return accountsGetResponse();
        // removeItem revokes the token after stamping; the revocation itself is not what
        // these tests are about, but it must succeed for the stamping path to complete.
        if (url.endsWith('/item/remove')) return ok({ request_id: 'req-remove' });
        return fail(404, { error_code: 'NOT_MOCKED' });
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('stores subtype and persistentAccountId on a newly created account row', async () => {
    accountsGetResponse = () =>
      ok({
        accounts: [
          acct({
            account_id: 'new-1',
            name: 'CREDIT CARD',
            mask: '0977',
            type: 'credit',
            subtype: 'credit card',
            persistent_account_id: 'PAI-new-1',
          }),
        ],
      });

    await new PlaidProvider().syncAccountsForItem(USER, ITEM_ID);

    const row = await prisma.account.findFirstOrThrow({
      where: { userId: USER, providerRef: 'new-1' },
    });
    expect(row.subtype).toBe('credit card');
    expect(row.persistentAccountId).toBe('PAI-new-1');
    expect(row.type).toBe('CREDIT'); // unchanged classification
    expect(row.mask).toBe('0977');
  });

  it('BACKFILLS an account linked before these columns existed, on its next ordinary sync', async () => {
    // Exactly the owner's rows: created by an earlier build, so both identity columns are
    // null. No re-link and no data migration may be required to populate them.
    await prisma.account.create({
      data: {
        userId: USER,
        provider: 'plaid',
        providerRef: 'old-1',
        name: 'Roth IRA Brokerage',
        type: 'INVESTMENT',
        currentBalanceCents: 12345,
      },
    });
    accountsGetResponse = () =>
      ok({
        accounts: [
          acct({
            account_id: 'old-1',
            name: 'Roth IRA Brokerage',
            type: 'investment',
            subtype: 'roth',
            persistent_account_id: 'PAI-old-1',
            balances: { current: 123.45, available: null, limit: null },
          }),
        ],
      });

    await new PlaidProvider().syncAccountsForItem(USER, ITEM_ID);

    const rows = await prisma.account.findMany({ where: { userId: USER, providerRef: 'old-1' } });
    expect(rows).toHaveLength(1); // updated in place — never a second row
    expect(rows[0].subtype).toBe('roth');
    expect(rows[0].persistentAccountId).toBe('PAI-old-1');
  });

  it('PRESERVES persistentAccountId when a later fetch simply does not carry one', async () => {
    // Plaid supplies persistent_account_id only for Tokenized-Account-Number institutions,
    // and a response can omit it for reasons that say nothing about the account. Writing
    // null here would erase the one identifier that survives a re-link — the whole point of
    // storing it. Same rule as PlaidItem.institution (preserve-on-null, DECISIONS #130).
    accountsGetResponse = () =>
      ok({
        accounts: [
          acct({
            account_id: 'keep-1',
            type: 'depository',
            subtype: 'checking',
            persistent_account_id: 'PAI-keep-1',
          }),
        ],
      });
    await new PlaidProvider().syncAccountsForItem(USER, ITEM_ID);

    // Second sync: same account, no identifier present.
    accountsGetResponse = () => ok({ accounts: [acct({ account_id: 'keep-1', type: 'depository' })] });
    await new PlaidProvider().syncAccountsForItem(USER, ITEM_ID);

    const row = await prisma.account.findFirstOrThrow({
      where: { userId: USER, providerRef: 'keep-1' },
    });
    expect(row.persistentAccountId).toBe('PAI-keep-1');
  });

  it('keeps `type` and `subtype` consistent — they are one fact, not two', async () => {
    // `type` is DERIVED from the wire subtype and is rewritten every sync. When subtype was
    // preserve-on-null the pair could settle at `type: LOAN, subtype: 'mortgage'` — a row
    // whose two stored facts contradict each other, which the identity ladder then compares
    // as a unit (§5 tier A requires BOTH equal; tier V vetoes on either differing). A
    // fresh-context critic executed exactly this. So subtype follows `type`.
    accountsGetResponse = () =>
      ok({ accounts: [acct({ account_id: 'pair-1', type: 'loan', subtype: 'mortgage' })] });
    await new PlaidProvider().syncAccountsForItem(USER, ITEM_ID);
    const first = await prisma.account.findFirstOrThrow({
      where: { userId: USER, providerRef: 'pair-1' },
    });
    expect([first.type, first.subtype]).toEqual(['MORTGAGE', 'mortgage']);

    // A later response omits subtype: `type` degrades to LOAN, and subtype must follow it
    // down rather than keeping a value that now describes a different classification.
    accountsGetResponse = () => ok({ accounts: [acct({ account_id: 'pair-1', type: 'loan' })] });
    await new PlaidProvider().syncAccountsForItem(USER, ITEM_ID);
    const second = await prisma.account.findFirstOrThrow({
      where: { userId: USER, providerRef: 'pair-1' },
    });
    expect([second.type, second.subtype]).toEqual(['LOAN', null]);
  });

  it('captures identity at DISCONNECT — the last moment these rows are ever reachable', async () => {
    // Disconnect deletes the PlaidItem and KEEPS the accounts, and every sync path
    // iterates PlaidItem — so a disconnected row is never revisited by anything. It is
    // also exactly the population the reconciliation flow works on, because the app's own
    // advice for a duplicate is "disconnect one side, then combine". removeItem already
    // calls /accounts/get to stamp item linkage; that response carries identity too, and
    // used to be thrown away (fresh-context critic, executed).
    await prisma.account.create({
      data: {
        userId: USER,
        provider: 'plaid',
        providerRef: 'bye-1',
        name: 'CREDIT CARD',
        type: 'CREDIT',
        currentBalanceCents: 847531,
      },
    });
    accountsGetResponse = () =>
      ok({
        accounts: [
          acct({
            account_id: 'bye-1',
            type: 'credit',
            subtype: 'credit card',
            persistent_account_id: 'PAI-bye-1',
          }),
        ],
      });

    await new PlaidProvider().removeItem(USER, ITEM_ID);

    const row = await prisma.account.findFirstOrThrow({
      where: { userId: USER, providerRef: 'bye-1' },
    });
    expect(row.subtype).toBe('credit card');
    expect(row.persistentAccountId).toBe('PAI-bye-1');
    expect(row.plaidItemId).toBe(ITEM_ID); // the pre-existing stamping still happens
    expect(await prisma.plaidItem.count({ where: { userId: USER } })).toBe(0);
  });

  it('still overwrites a stored subtype when the provider sends a different one', async () => {
    // Preserve-on-null must not harden into never-update: a real change still lands.
    accountsGetResponse = () =>
      ok({ accounts: [acct({ account_id: 'chg-1', type: 'depository', subtype: 'checking' })] });
    await new PlaidProvider().syncAccountsForItem(USER, ITEM_ID);

    accountsGetResponse = () =>
      ok({ accounts: [acct({ account_id: 'chg-1', type: 'depository', subtype: 'savings' })] });
    await new PlaidProvider().syncAccountsForItem(USER, ITEM_ID);

    const row = await prisma.account.findFirstOrThrow({
      where: { userId: USER, providerRef: 'chg-1' },
    });
    expect(row.subtype).toBe('savings');
  });

  it('never touches a manual row (D8): identity capture is scoped to this provider’s own rows', async () => {
    const manual = await prisma.account.create({
      data: {
        userId: USER,
        provider: 'manual',
        providerRef: 'same-ref',
        name: 'Manually added card',
        type: 'CREDIT',
        currentBalanceCents: 5000,
      },
    });
    accountsGetResponse = () =>
      ok({
        accounts: [
          acct({
            account_id: 'same-ref',
            type: 'credit',
            subtype: 'credit card',
            persistent_account_id: 'PAI-same',
          }),
        ],
      });

    await new PlaidProvider().syncAccountsForItem(USER, ITEM_ID);

    const untouched = await prisma.account.findUniqueOrThrow({ where: { id: manual.id } });
    expect(untouched.subtype).toBeNull();
    expect(untouched.persistentAccountId).toBeNull();
    expect(untouched.provider).toBe('manual');
  });
});
