/**
 * test_regression__plaid_items_get_a_human_institution_name
 *
 * Owner-reported 2026-07-23: two banks linked through Plaid both showed
 * "Plaid: Connected bank" on /accounts, indistinguishable — because nothing ever
 * WROTE PlaidItem.institution, even though the schema field, the server select
 * (getAccountsView) and the UI (`plaid-connections.tsx`) had always supported it.
 *
 * The fix resolves the name from Plaid (/item/get → institution_id, then
 * /institutions/get_by_id → name) at link time, and backfills existing items via
 * syncInstitutions — idempotently (only null-name items are looked up), with per-item
 * fault isolation. Runs the REAL PlaidProvider with global.fetch stubbed to a fake
 * Plaid server; the live socket stays UNVERIFIED against Plaid.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { PlaidProvider } from '@/lib/providers/plaid';
import { encryptToken } from '@/lib/crypto';
import { prisma } from '@/lib/db';

const KEY = Buffer.alloc(32, 7).toString('base64');

const ok = (json: unknown): Response => ({ ok: true, status: 200, json: async () => json }) as Response;
const fail = (status: number, body: unknown): Response =>
  ({ ok: false, status, json: async () => body, text: async () => JSON.stringify(body) }) as Response;

// Fake-Plaid controls, reset per test.
let itemGetCalls: string[]; // decrypted access_token per /item/get
let institutionsGetCalls: string[]; // institution_id per /institutions/get_by_id
let institutionIdByToken: Map<string, string | null>; // token → institution_id ('' key never used)
let nameByInstitutionId: Map<string, string | null>; // institution_id → name
let rejectItemGet: Set<string>; // tokens whose /item/get fails
let rejectInstitutionsGet: Set<string>; // institution_ids whose /institutions/get_by_id fails

function mockServer() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: { body?: string }) => {
      const url = String(input);
      const body = JSON.parse(init?.body ?? '{}') as Record<string, string>;

      if (url.endsWith('/item/public_token/exchange')) {
        // item_id derived from the public token so each test's link is a distinct row
        // (itemId is @unique — a constant would let one test's upsert hijack another's).
        return ok({ access_token: 'exch-token', item_id: `exch-item-${body.public_token}` });
      }
      if (url.endsWith('/accounts/get')) {
        // exchangePublicToken pulls accounts after the upsert; none needed here.
        return ok({ accounts: [] });
      }
      if (url.endsWith('/item/get')) {
        const token = body.access_token;
        itemGetCalls.push(token);
        if (rejectItemGet.has(token)) {
          return fail(400, { error_code: 'ITEM_LOGIN_REQUIRED', error_type: 'ITEM_ERROR', request_id: 'req' });
        }
        const institutionId = institutionIdByToken.has(token)
          ? institutionIdByToken.get(token)!
          : 'ins_default';
        return ok({ item: { item_id: 'x', institution_id: institutionId } });
      }
      if (url.endsWith('/institutions/get_by_id')) {
        const institutionId = body.institution_id;
        institutionsGetCalls.push(institutionId);
        if (rejectInstitutionsGet.has(institutionId)) {
          return fail(400, { error_code: 'INVALID_INSTITUTION', error_type: 'INVALID_INPUT', request_id: 'req' });
        }
        const name = nameByInstitutionId.has(institutionId)
          ? nameByInstitutionId.get(institutionId)!
          : 'Test Bank';
        return ok({ institution: { institution_id: institutionId, name } });
      }
      return fail(404, { error_code: 'NOT_MOCKED' });
    }),
  );
}

async function makeUser(tag: string): Promise<string> {
  const user = await prisma.user.create({
    data: { email: `plaid-inst-${tag}-${Date.now()}-${Math.random()}@aimplifi.test` },
  });
  return user.id;
}

async function addItem(
  userId: string,
  tag: string,
  token: string,
  institution: string | null,
): Promise<string> {
  const itemId = `item-inst-${tag}-${Date.now()}-${Math.random()}`;
  await prisma.plaidItem.create({
    data: { userId, itemId, accessToken: encryptToken(token), institution },
  });
  return itemId;
}

describe('PlaidProvider.syncInstitutions (backfill)', () => {
  beforeEach(() => {
    vi.stubEnv('DATA_ENCRYPTION_KEY', KEY);
    vi.stubEnv('PLAID_CLIENT_ID', 'test-id');
    vi.stubEnv('PLAID_SECRET', 'test-secret');
    vi.stubEnv('PLAID_ENV', 'sandbox');
    itemGetCalls = [];
    institutionsGetCalls = [];
    institutionIdByToken = new Map();
    nameByInstitutionId = new Map();
    rejectItemGet = new Set();
    rejectInstitutionsGet = new Set();
    mockServer();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('resolves and stores the institution name on an item that has none', async () => {
    const userId = await makeUser('none');
    institutionIdByToken.set('tok-none', 'ins_chase');
    nameByInstitutionId.set('ins_chase', 'Chase');
    const itemId = await addItem(userId, 'none', 'tok-none', null);

    const r = await new PlaidProvider().syncInstitutions(userId);

    expect(r).toEqual({ attempted: 1, updated: 1, failed: 0 });
    expect((await prisma.plaidItem.findUnique({ where: { itemId } }))?.institution).toBe('Chase');
  });

  it('skips an item that already has a name (no billed lookup)', async () => {
    const userId = await makeUser('already');
    await addItem(userId, 'already', 'tok-already', 'Capital One');

    const r = await new PlaidProvider().syncInstitutions(userId);

    expect(r).toEqual({ attempted: 0, updated: 0, failed: 0 });
    expect(itemGetCalls).toEqual([]);
    expect(institutionsGetCalls).toEqual([]);
  });

  it('leaves an item with no resolvable institution null, without counting a failure', async () => {
    const userId = await makeUser('noinst');
    institutionIdByToken.set('tok-noinst', null); // /item/get returns no institution_id
    const itemId = await addItem(userId, 'noinst', 'tok-noinst', null);

    const r = await new PlaidProvider().syncInstitutions(userId);

    expect(r).toEqual({ attempted: 1, updated: 0, failed: 0 });
    // No second call — a null institution_id short-circuits before /institutions/get_by_id.
    expect(institutionsGetCalls).toEqual([]);
    expect((await prisma.plaidItem.findUnique({ where: { itemId } }))?.institution).toBeNull();
  });

  it('isolates a per-item failure: one bank failing does not block the others, and audits it', async () => {
    const userId = await makeUser('iso');
    institutionIdByToken.set('tok-good', 'ins_good');
    nameByInstitutionId.set('ins_good', 'Good Bank');
    rejectItemGet.add('tok-bad');
    const badItem = await addItem(userId, 'bad', 'tok-bad', null);
    const goodItem = await addItem(userId, 'good', 'tok-good', null);

    const r = await new PlaidProvider().syncInstitutions(userId);

    expect(r).toEqual({ attempted: 2, updated: 1, failed: 1 });
    expect((await prisma.plaidItem.findUnique({ where: { itemId: goodItem } }))?.institution).toBe('Good Bank');
    expect((await prisma.plaidItem.findUnique({ where: { itemId: badItem } }))?.institution).toBeNull();
    const audit = await prisma.auditLog.findFirst({
      where: { userId, action: 'plaid.institution.resolve.failed' },
    });
    expect(audit).not.toBeNull();
  });

  it('scopes to one bank when itemId is given', async () => {
    const userId = await makeUser('scope');
    institutionIdByToken.set('tok-a', 'ins_a');
    institutionIdByToken.set('tok-b', 'ins_b');
    nameByInstitutionId.set('ins_a', 'Bank A');
    nameByInstitutionId.set('ins_b', 'Bank B');
    const a = await addItem(userId, 'a', 'tok-a', null);
    const b = await addItem(userId, 'b', 'tok-b', null);

    const r = await new PlaidProvider().syncInstitutions(userId, { itemId: a });

    expect(r).toEqual({ attempted: 1, updated: 1, failed: 0 });
    expect((await prisma.plaidItem.findUnique({ where: { itemId: a } }))?.institution).toBe('Bank A');
    // The other bank is untouched (still awaiting its own backfill).
    expect((await prisma.plaidItem.findUnique({ where: { itemId: b } }))?.institution).toBeNull();
  });

  it('is user-scoped: another user’s itemId matches nothing', async () => {
    const mine = await makeUser('mine');
    const theirs = await makeUser('theirs');
    const strangerItem = await addItem(theirs, 'stranger', 'tok-stranger', null);

    const r = await new PlaidProvider().syncInstitutions(mine, { itemId: strangerItem });

    expect(r).toEqual({ attempted: 0, updated: 0, failed: 0 });
    expect((await prisma.plaidItem.findUnique({ where: { itemId: strangerItem } }))?.institution).toBeNull();
  });
});

describe('PlaidProvider.exchangePublicToken (link-time capture)', () => {
  beforeEach(() => {
    vi.stubEnv('DATA_ENCRYPTION_KEY', KEY);
    vi.stubEnv('PLAID_CLIENT_ID', 'test-id');
    vi.stubEnv('PLAID_SECRET', 'test-secret');
    vi.stubEnv('PLAID_ENV', 'sandbox');
    itemGetCalls = [];
    institutionsGetCalls = [];
    institutionIdByToken = new Map();
    nameByInstitutionId = new Map();
    rejectItemGet = new Set();
    rejectInstitutionsGet = new Set();
    mockServer();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('stores the institution name on a freshly linked item', async () => {
    const userId = await makeUser('exch');
    // The mock's exchange returns access_token 'exch-token'; map it to a named bank.
    institutionIdByToken.set('exch-token', 'ins_chase');
    nameByInstitutionId.set('ins_chase', 'Chase');

    await new PlaidProvider().exchangePublicToken(userId, 'public-abc');

    const item = await prisma.plaidItem.findUnique({ where: { itemId: 'exch-item-public-abc' } });
    expect(item?.institution).toBe('Chase');
  });

  it('links successfully even when the institution lookup fails (cosmetic, non-fatal)', async () => {
    const userId = await makeUser('exchfail');
    rejectItemGet.add('exch-token'); // /item/get throws → name unresolved

    // Must NOT throw — a failed name lookup can never fail a real link.
    await new PlaidProvider().exchangePublicToken(userId, 'public-xyz');

    const item = await prisma.plaidItem.findUnique({ where: { itemId: 'exch-item-public-xyz' } });
    expect(item).not.toBeNull(); // the item is still linked
    expect(item?.institution).toBeNull(); // just unnamed until syncInstitutions backfills it
  });
});
