/**
 * test_regression__read_committed_guard_class (cycle-2 checker P1, DECISIONS #146).
 *
 * The check-then-act transactions (both sync guards, the pending→posted
 * transplant, fileMerchantGroup, recategorize) were "atomic" only because SQLite
 * serializes write transactions — production Postgres runs READ COMMITTED, where
 * a concurrent commit between an in-tx read and its write silently clobbered a
 * user decision, recorded stale-fromCategoryId corrections, or minted duplicate
 * rules. serializableTx runs them at SERIALIZABLE with a bounded P2034 retry.
 *
 * The race itself is unreproducible on the single-writer SQLite test env (see
 * STATUS honesty note) — what IS lockable deterministically is the helper's
 * contract: the isolation level is actually requested, P2034 (and ONLY P2034)
 * retries, the attempt cap holds, and other errors fail loudly on attempt 1.
 */
import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@/generated/prisma/client';
import { isUniqueViolation, serializableTx } from '@/lib/db';

const conflict = () =>
  new Prisma.PrismaClientKnownRequestError('write conflict', { code: 'P2034', clientVersion: 'test' });

describe('serializableTx (cycle-2 P1 guard class)', () => {
  it('requests SERIALIZABLE isolation and returns the fn result', async () => {
    const $transaction = vi.fn(
      async (fn: (tx: unknown) => Promise<unknown>) => fn('TX'),
    );
    const out = await serializableTx(async (tx) => `${String(tx)}-ok`, {
      client: { $transaction } as never,
    });
    expect(out).toBe('TX-ok');
    expect($transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });

  it('retries a P2034 conflict and succeeds when the retry wins', async () => {
    const $transaction = vi
      .fn()
      .mockRejectedValueOnce(conflict())
      .mockResolvedValueOnce('won');
    await expect(
      serializableTx(async () => 'unused', { client: { $transaction } as never }),
    ).resolves.toBe('won');
    expect($transaction).toHaveBeenCalledTimes(2);
  });

  it('gives up after the attempt cap and rethrows the conflict', async () => {
    const $transaction = vi.fn().mockRejectedValue(conflict());
    await expect(
      serializableTx(async () => 'unused', { client: { $transaction } as never, attempts: 3 }),
    ).rejects.toMatchObject({ code: 'P2034' });
    expect($transaction).toHaveBeenCalledTimes(3);
  });

  it('non-conflict errors fail loudly on the FIRST attempt — no retry masking', async () => {
    const boom = new Error('constraint violation');
    const $transaction = vi.fn().mockRejectedValue(boom);
    await expect(
      serializableTx(async () => 'unused', { client: { $transaction } as never }),
    ).rejects.toBe(boom);
    expect($transaction).toHaveBeenCalledTimes(1);
  });

  it('isUniqueViolation: P2002 only', () => {
    expect(
      isUniqueViolation(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' }),
      ),
    ).toBe(true);
    expect(isUniqueViolation(conflict())).toBe(false);
    expect(isUniqueViolation(new Error('anything'))).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });
});
