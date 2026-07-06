/**
 * flash.ts (#167) — the one-shot sessionStorage message that carries a
 * success caption across the reliable-mutation recipe's confirming reload
 * (accounts "Statement saved", backfill "Auto-filed N"). Critic P2: a key typo
 * or a storage throw would ship green without these.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setFlash, takeFlash } from '@/components/finance/flash';

function stubStorage() {
  const store = new Map<string, string>();
  const storage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  vi.stubGlobal('sessionStorage', storage);
  return store;
}

afterEach(() => vi.unstubAllGlobals());

describe('flash', () => {
  it('set → take returns the message exactly once, then null', () => {
    stubStorage();
    setFlash('accounts', 'Statement saved.');
    expect(takeFlash('accounts')).toBe('Statement saved.');
    expect(takeFlash('accounts')).toBeNull(); // one-shot: consumed on read
  });

  it('keys are namespaced — a backfill flash never leaks into accounts', () => {
    stubStorage();
    setFlash('backfill', 'Auto-filed 3 transactions.');
    expect(takeFlash('accounts')).toBeNull();
    expect(takeFlash('backfill')).toBe('Auto-filed 3 transactions.');
  });

  it('take with nothing set returns null', () => {
    stubStorage();
    expect(takeFlash('accounts')).toBeNull();
  });

  it('a throwing storage degrades to no message, never a crash', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('quota');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('quota');
      },
    });
    expect(() => setFlash('accounts', 'x')).not.toThrow();
    expect(takeFlash('accounts')).toBeNull();
  });

  it('no sessionStorage at all (SSR) degrades to no message, never a crash', () => {
    // Node has no sessionStorage; the bare identifier throws ReferenceError,
    // which the helper's try/catch must eat.
    expect(() => setFlash('accounts', 'x')).not.toThrow();
    expect(takeFlash('accounts')).toBeNull();
  });
});
