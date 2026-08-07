/**
 * Link update mode — TASKS L.10 slice 2 / layer 1 (docs/ACCOUNT_IDENTITY_ARCHITECTURE.md §4).
 *
 * The app had exactly one door: connect a bank. So the only way to add an account you
 * hadn't shared — or to repair a login that had expired — was to run Link again on a bank
 * you already had, which mints a second Item, whose `account_id`s are new, which makes the
 * same real card arrive as a brand-new row. The duplicate was created by construction and
 * could only be detected afterwards. Update mode reopens the connection that exists, so
 * every already-linked account returns with its existing id and refreshes in place.
 *
 * What is locked here is the part that is provable without a bank: the request Plaid is
 * sent, who is allowed to mint one, and the marker that stops an update-mode round-trip
 * from being handled as a new connection. The interactive Link step is Plaid-hosted and
 * cannot be browser-e2e'd (the standing note in plaid-actions.test.ts), and no live Plaid
 * connection exists in this environment, so the flow END-TO-END is UNVERIFIED against
 * Plaid; every fact about the request shape below was read from plaid.com/docs/link/update-mode
 * and plaid.com/docs/api/link on 2026-07-24.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'plaid-update-test-user' } })) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { PlaidProvider, linkTokenParams } from '@/lib/providers/plaid';
import {
  OAUTH_LINK_TOKEN_KEY,
  clearStoredLinkToken,
  readStoredDeepenHistory,
  readStoredLinkToken,
  readStoredUpdateItemId,
  storeLinkToken,
} from '@/lib/plaid-oauth';
import { encryptToken } from '@/lib/crypto';
import { prisma } from '@/lib/db';

const KEY = Buffer.alloc(32, 7).toString('base64');

describe('linkTokenParams — update mode (reopen an existing connection)', () => {
  it('sends the access token and turns on account selection', () => {
    const body = linkTokenParams('user-1', undefined, { accessToken: 'access-abc' });
    expect(body.access_token).toBe('access-abc');
    expect(body.update).toEqual({ account_selection_enabled: true });
  });

  it('OMITS products entirely — Plaid rejects them alongside an access_token', () => {
    // The one requirement that turns a working control into a broken one. Plaid documents
    // that no products and no product-specific parameters may be sent on a link token
    // carrying an access_token (outside the credit-product exception, which is not this).
    const body = linkTokenParams('user-1', undefined, { accessToken: 'access-abc' });
    expect(body.products).toBeUndefined();
    expect(body.required_if_supported_products).toBeUndefined();
    expect('products' in body).toBe(false);
    expect('required_if_supported_products' in body).toBe(false);
  });

  it('keeps the identity and OAuth halves of the normal contract', () => {
    const body = linkTokenParams('user-42', 'https://www.aimplifi.app/plaid-oauth', {
      accessToken: 'access-abc',
    });
    expect(body.user).toEqual({ client_user_id: 'user-42' });
    expect(body.client_name).toBe('Aimplifi');
    expect(body.country_codes).toEqual(['US']);
    expect(body.language).toBe('en');
    // Update mode reaches the same OAuth banks the front door does, so the redirect URI
    // must be registered here too — without it those banks cannot hand the browser back.
    expect(body.redirect_uri).toBe('https://www.aimplifi.app/plaid-oauth');
  });

  it('leaves the NEW-connection request exactly as it was', () => {
    // Adding a mode must not quietly alter the one that already worked.
    const body = linkTokenParams('user-1', 'https://www.aimplifi.app/plaid-oauth');
    expect(body.products).toEqual(['transactions']);
    expect(body.required_if_supported_products).toEqual(['liabilities', 'investments']);
    expect(body.access_token).toBeUndefined();
    expect(body.update).toBeUndefined();
    expect(body.redirect_uri).toBe('https://www.aimplifi.app/plaid-oauth');
  });
});

describe('PlaidProvider.createUpdateLinkToken (real provider, mocked Plaid server)', () => {
  const USER = `plaid-update-${Date.now()}-${process.pid}`;
  const OTHER = `${USER}-other`;
  const ITEM = `${USER}-item`;
  let posted: { url: string; body: Record<string, unknown> }[];

  async function wipe() {
    for (const id of [USER, OTHER]) {
      await prisma.plaidItem.deleteMany({ where: { userId: id } });
      await prisma.user.deleteMany({ where: { id } });
    }
  }

  beforeEach(async () => {
    vi.stubEnv('DATA_ENCRYPTION_KEY', KEY);
    vi.stubEnv('PLAID_CLIENT_ID', 'test-id');
    vi.stubEnv('PLAID_SECRET', 'test-secret');
    vi.stubEnv('PLAID_ENV', 'sandbox');
    await wipe();
    await prisma.user.create({ data: { id: USER, email: `${USER}@aimplifi.test` } });
    await prisma.user.create({ data: { id: OTHER, email: `${OTHER}@aimplifi.test` } });
    await prisma.plaidItem.create({
      data: {
        userId: USER,
        itemId: ITEM,
        accessToken: encryptToken('the-real-access-token', Buffer.from(KEY, 'base64')),
      },
    });
    posted = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown, init?: { body?: string }) => {
        posted.push({ url: String(input), body: JSON.parse(init?.body ?? '{}') });
        return { ok: true, status: 200, json: async () => ({ link_token: 'link-update-1' }) } as Response;
      }),
    );
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    await wipe();
  });

  it('mints a token against the item’s own decrypted access token', async () => {
    const token = await new PlaidProvider().createUpdateLinkToken(USER, ITEM);

    expect(token).toBe('link-update-1');
    expect(posted).toHaveLength(1);
    expect(posted[0].url).toContain('/link/token/create');
    expect(posted[0].body.access_token).toBe('the-real-access-token');
    expect(posted[0].body.update).toEqual({ account_selection_enabled: true });
    expect(posted[0].body.products).toBeUndefined();
  });

  it('refuses another user’s item — and spends no Plaid call doing it', async () => {
    // A link token minted on someone else's access token would hand the caller a session
    // against a stranger's bank. The ownership check is the same {userId, itemId} lookup
    // every other per-item Plaid path uses, and it runs BEFORE the network.
    await expect(new PlaidProvider().createUpdateLinkToken(OTHER, ITEM)).rejects.toThrow();
    expect(posted).toEqual([]);
  });

  it('refuses an item id that does not exist', async () => {
    await expect(new PlaidProvider().createUpdateLinkToken(USER, 'no-such-item')).rejects.toThrow();
    expect(posted).toEqual([]);
  });
});

describe('createPlaidUpdateLinkToken action — boundary refusals', () => {
  const saved = {
    id: process.env.PLAID_CLIENT_ID,
    secret: process.env.PLAID_SECRET,
    key: process.env.DATA_ENCRYPTION_KEY,
  };
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      const name = { id: 'PLAID_CLIENT_ID', secret: 'PLAID_SECRET', key: 'DATA_ENCRYPTION_KEY' }[
        k
      ] as string;
      if (v === undefined) delete process.env[name];
      else process.env[name] = v;
    }
  });

  it('returns not-ok, with no network call, when Plaid is unconfigured', async () => {
    delete process.env.PLAID_CLIENT_ID;
    delete process.env.PLAID_SECRET;
    delete process.env.DATA_ENCRYPTION_KEY;
    const { createPlaidUpdateLinkToken } = await import('@/server/plaid-actions');
    const r = await createPlaidUpdateLinkToken('any-item');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/configured/i);
    expect(r.linkToken).toBeUndefined();
  });

  it('refuses a non-string or blank item id before it can reach a Prisma where clause', async () => {
    process.env.PLAID_CLIENT_ID = 'test-id';
    process.env.PLAID_SECRET = 'test-secret';
    process.env.DATA_ENCRYPTION_KEY = KEY;
    const { createPlaidUpdateLinkToken } = await import('@/server/plaid-actions');
    // TypeScript's `string` is erased at a server-action boundary, so a crafted POST can
    // send anything; an object reaching `where` matched rows it was never meant to (#279).
    for (const bad of [undefined, null, '', '   ', 42, { not: 'a string' }, ['x']]) {
      const r = await createPlaidUpdateLinkToken(bad as unknown as string);
      expect(r.ok).toBe(false);
      expect(r.error).toBe('That bank isn’t connected.');
    }
  });
});

describe('OAuth round-trip record — an update must not be handled as a new connection', () => {
  // The unit suite runs under `environment: 'node'`, so `window` is stubbed here; the
  // storage helpers reference it only inside function bodies, which is what makes that
  // possible (and is why they are unit-testable at all).
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('records the token and the item it reopened together', () => {
    storeLinkToken('link-tok', 'item-abc');
    expect(readStoredLinkToken()).toBe('link-tok');
    expect(readStoredUpdateItemId()).toBe('item-abc');
  });

  it('is ONE key, so a token can never be stored without its own discriminator', () => {
    // The first version used two keys, and a fresh-context critic broke it: two writers
    // on one page (this control and the connect front door) meant a record could end up
    // describing a session that was not the one running — in the worst ordering, a
    // COMPLETED new-bank link took the update branch, was never exchanged, and the user
    // was redirected as though it had worked. A single atomic record makes the token and
    // its meaning inseparable; the remaining half of that fix is stamping at open() time.
    storeLinkToken('link-tok', 'item-abc');
    expect([...store.keys()]).toEqual([OAUTH_LINK_TOKEN_KEY]);
  });

  it('a NEW connection overwrites an abandoned update session, marker and all', () => {
    storeLinkToken('link-old', 'item-stale');
    storeLinkToken('link-new');
    expect(readStoredLinkToken()).toBe('link-new');
    expect(readStoredUpdateItemId()).toBeNull();
  });

  it('an UPDATE session overwrites a stale new-connection record', () => {
    storeLinkToken('link-old');
    storeLinkToken('link-new', 'item-xyz');
    expect(readStoredLinkToken()).toBe('link-new');
    expect(readStoredUpdateItemId()).toBe('item-xyz');
  });

  // ---- H.6 / DECISIONS #424: the deepen intent rides the same one record ------------------

  it('carries the deepen-history intent across the OAuth round-trip', () => {
    // The banks the owner needs deepened (Chase ×3, Capital One ×2, U.S. Bank) are exactly the
    // ones that navigate the browser away and come back through /plaid-oauth, so an intent that
    // does not survive this hop is an intent that fails at precisely the banks it is for.
    storeLinkToken('link-tok', undefined, true);
    expect(readStoredLinkToken()).toBe('link-tok');
    expect(readStoredDeepenHistory()).toBe(true);
    expect(readStoredUpdateItemId()).toBeNull();
  });

  it('an ordinary new-connection session carries no deepen intent', () => {
    storeLinkToken('link-tok');
    expect(readStoredDeepenHistory()).toBe(false);
  });

  it('an UPDATE session is never a deepen session — update mode cannot widen a frozen window', () => {
    // Mutually exclusive by construction: update mode reopens the EXISTING Item, whose history
    // window Plaid has already fixed, so there is no depth down that path and nothing to exempt.
    // Were both ever written, the update marker must win: its branch is the one that must NOT
    // exchange the public token, and that is the more expensive mistake.
    storeLinkToken('link-tok', 'item-abc', true);
    expect(readStoredUpdateItemId()).toBe('item-abc');
    expect(readStoredDeepenHistory()).toBe(false);
  });

  it('a stale record from another build never reads as an intent to keep a duplicate', () => {
    // Only the literal `true` this module writes counts. The failure direction is deliberate:
    // a missing intent costs the owner one repeated attempt, a fabricated one keeps a
    // connection they never asked for.
    store.set(OAUTH_LINK_TOKEN_KEY, JSON.stringify({ token: 'link-tok', deepenHistory: 'yes' }));
    expect(readStoredLinkToken()).toBe('link-tok');
    expect(readStoredDeepenHistory()).toBe(false);
  });

  it('a deepen session is forgotten with the rest of the record', () => {
    storeLinkToken('link-tok', undefined, true);
    clearStoredLinkToken();
    expect(readStoredDeepenHistory()).toBe(false);
  });

  it('clearing removes both halves at once', () => {
    storeLinkToken('link-tok', 'item-abc');
    clearStoredLinkToken();
    expect(readStoredLinkToken()).toBeNull();
    expect(readStoredUpdateItemId()).toBeNull();
  });

  it('reads a bare token stored by the build BEFORE update mode existed', () => {
    // A user mid-OAuth across the deploy. The old format can only have been a NEW
    // connection, so the absent marker is not a guess — it is the only possibility.
    store.set(OAUTH_LINK_TOKEN_KEY, 'legacy-raw-token');
    expect(readStoredLinkToken()).toBe('legacy-raw-token');
    expect(readStoredUpdateItemId()).toBeNull();
  });

  it('treats junk, an empty record and a blank item id as nothing', () => {
    store.set(OAUTH_LINK_TOKEN_KEY, '{"token":""}');
    expect(readStoredLinkToken()).toBeNull();
    store.set(OAUTH_LINK_TOKEN_KEY, '{"token":"t","updateItemId":"   "}');
    expect(readStoredLinkToken()).toBe('t');
    expect(readStoredUpdateItemId()).toBeNull();
    store.set(OAUTH_LINK_TOKEN_KEY, '   ');
    expect(readStoredLinkToken()).toBeNull();
  });
});
