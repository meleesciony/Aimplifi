/**
 * linkPlaidAccount best-effort contract (P1, found by the Link-UI adversarial
 * audit). Once exchangePublicToken resolves, the Plaid item is LINKED — accounts
 * are persisted. The follow-on transaction + liability pulls are best-effort:
 * a depository-only institution returns no liabilities (PRODUCTS_NOT_SUPPORTED,
 * now expected because liabilities is required_if_supported, not required), and
 * the sandbox lags on transactions. Neither may flip a real, successful link into
 * {ok:false} or skip the cache revalidation that surfaces the new accounts. A
 * failed EXCHANGE, by contrast, is a genuine failure. The provider is mocked, so
 * this locks the action's orchestration without any network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  exchange: vi.fn(),
  syncTx: vi.fn(),
  syncLiab: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'besteffort-user' } })) }));
vi.mock('next/cache', () => ({ revalidatePath: h.revalidate }));
// A plain class whose methods delegate to the hoisted spies — unambiguous under
// `new PlaidProvider()` (a vi.fn-as-constructor returning an object does not bind
// reliably here).
vi.mock('@/lib/providers/plaid', () => ({
  PlaidProvider: class {
    createLinkToken(userId: string) {
      return Promise.resolve('link-tok-' + userId);
    }
    exchangePublicToken(userId: string, publicToken: string) {
      return h.exchange(userId, publicToken);
    }
    syncTransactions(userId: string) {
      return h.syncTx(userId);
    }
    syncLiabilities(userId: string) {
      return h.syncLiab(userId);
    }
  },
}));

import { linkPlaidAccount } from '@/server/plaid-actions';

describe('linkPlaidAccount — best-effort post-exchange syncs (a real link must not report failure)', () => {
  const saved = {
    id: process.env.PLAID_CLIENT_ID,
    secret: process.env.PLAID_SECRET,
    key: process.env.DATA_ENCRYPTION_KEY,
  };

  beforeEach(() => {
    process.env.PLAID_CLIENT_ID = 'test-id';
    process.env.PLAID_SECRET = 'test-secret';
    process.env.DATA_ENCRYPTION_KEY = 'test-key';
    // The exchange now REPORTS what it did (TASKS L.10 layer 2 — it is allowed to refuse a
    // redundant link), so the ordinary outcome is an explicit "a connection was created".
    h.exchange.mockReset().mockResolvedValue({ kind: 'linked', itemId: 'item-1' });
    h.syncTx.mockReset().mockResolvedValue({ added: 5, modified: 0, removed: 0, nextCursor: null });
    h.syncLiab.mockReset().mockResolvedValue(undefined);
    h.revalidate.mockReset();
  });

  afterEach(() => {
    if (saved.id === undefined) delete process.env.PLAID_CLIENT_ID;
    else process.env.PLAID_CLIENT_ID = saved.id;
    if (saved.secret === undefined) delete process.env.PLAID_SECRET;
    else process.env.PLAID_SECRET = saved.secret;
    if (saved.key === undefined) delete process.env.DATA_ENCRYPTION_KEY;
    else process.env.DATA_ENCRYPTION_KEY = saved.key;
  });

  it('happy path: returns ok:true with the transaction count and revalidates /accounts', async () => {
    const r = await linkPlaidAccount('public-good');
    expect(r).toEqual({ ok: true, added: 5 });
    expect(h.revalidate).toHaveBeenCalledWith('/accounts');
  });

  it('depository-only bank (syncLiabilities throws PRODUCTS_NOT_SUPPORTED) STILL links ok and revalidates', async () => {
    h.syncLiab.mockRejectedValue(new Error('Plaid /liabilities/get failed: 400 PRODUCTS_NOT_SUPPORTED'));
    const r = await linkPlaidAccount('public-good');
    expect(r.ok).toBe(true);
    expect(r.added).toBe(5);
    expect(h.revalidate).toHaveBeenCalledWith('/accounts');
  });

  it('lagging sandbox (syncTransactions throws) still links ok with added:0, and liabilities is still attempted', async () => {
    h.syncTx.mockRejectedValue(new Error('transient'));
    const r = await linkPlaidAccount('public-good');
    expect(r.ok).toBe(true);
    expect(r.added).toBe(0);
    expect(h.syncLiab).toHaveBeenCalled();
  });

  it('a REFUSED link (already connected) is a success with news, and still refreshes the bank they kept', async () => {
    h.exchange.mockResolvedValue({
      kind: 'already-connected',
      existingItemId: 'item-kept',
      institutionName: 'Chase',
      matchedAccountCount: 2,
    });
    const r = await linkPlaidAccount('public-good');

    expect(r.ok).toBe(true);
    // The sentence the user reads must say what happened AND that nothing was lost — the
    // reader's actual fear is that the accounts they just ticked went nowhere.
    expect(r.notice).toContain('Chase');
    expect(r.notice).toMatch(/refreshed that connection/i);
    expect(r.notice).toMatch(/nothing was added and nothing was lost/i);
    // "It just refreshes" is only true if something actually refreshed: the user-wide sync
    // runs on the connection they kept, and /accounts is revalidated to show it.
    expect(h.syncTx).toHaveBeenCalled();
    expect(h.revalidate).toHaveBeenCalledWith('/accounts');
  });

  it('an OVERLAPPING link is kept and disclosed — never reported as a refusal', async () => {
    h.exchange.mockResolvedValue({
      kind: 'linked-with-overlap',
      itemId: 'item-new',
      existingItemId: 'item-kept',
      institutionName: 'Chase',
      matchedAccountCount: 1,
      newAccountCount: 2,
    });
    const r = await linkPlaidAccount('public-good');

    expect(r.ok).toBe(true);
    expect(r.notice).toMatch(/Both Chase connections were kept/i);
  });

  it('an ordinary link says nothing extra — no notice to explain a thing that did not happen', async () => {
    const r = await linkPlaidAccount('public-good');
    expect(r.notice).toBeUndefined();
  });

  it('a FAILED exchange is a real failure: ok:false, no sync, no revalidate', async () => {
    h.exchange.mockRejectedValue(new Error('INVALID_PUBLIC_TOKEN'));
    const r = await linkPlaidAccount('public-bad');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/INVALID_PUBLIC_TOKEN/);
    expect(h.syncTx).not.toHaveBeenCalled();
    expect(h.revalidate).not.toHaveBeenCalled();
  });
});
