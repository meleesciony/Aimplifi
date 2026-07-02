/**
 * test_regression__guard_sites_bypass_serializableTx (cycle-3 P1 gate gap).
 *
 * Cycle-3's checker EMPIRICALLY proved the isolation fix had no lock: stripping
 * serializableTx from every guard site (back to plain prisma.$transaction) left
 * the whole suite green. This file pins the WIRING two ways:
 *
 * 1. Spy: '@/lib/db' is partially mocked so serializableTx is a passthrough spy —
 *    each triage action scenario must actually route through it. Stripping a
 *    site back to prisma.$transaction fails the call assertion.
 * 2. Source pin (providers): the two sync files must contain their serializable
 *    call sites and NO interactive `prisma.$transaction(async` check-then-act.
 *    Blunt but exactly the regression vector demonstrated: a textual revert of
 *    the wiring goes red here even though SQLite semantics hide the race.
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db')>();
  return { ...actual, serializableTx: vi.fn(actual.serializableTx) };
});

import { auth } from '@/auth';
import { prisma, serializableTx } from '@/lib/db';
import {
  applyCategory,
  fileMerchantGroup,
  makeRuleFromCorrection,
  recategorize,
} from '@/server/triage-actions';

describe('serializableTx wiring (cycle-3 gate lock)', () => {
  const USER = `wire-${Date.now()}-${process.pid}`;
  let MERCH = '';

  async function wipe() {
    await prisma.correction.deleteMany({ where: { userId: USER } });
    await prisma.categorizationRule.deleteMany({ where: { userId: USER } });
    await prisma.categoryPrediction.deleteMany({ where: { userId: USER } });
    await prisma.account.deleteMany({ where: { userId: USER } });
    await prisma.merchant.deleteMany({ where: { canonical: 'Wiring Test Bakery' } });
    await prisma.user.deleteMany({ where: { id: USER } });
  }

  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    MERCH = (
      await prisma.merchant.upsert({
        where: { canonical: 'Wiring Test Bakery' },
        create: { id: `wire-merch-${process.pid}`, canonical: 'Wiring Test Bakery' },
        update: {},
      })
    ).id;
  });
  afterAll(wipe);

  beforeEach(async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: USER } } as never);
    vi.mocked(serializableTx).mockClear();
    await prisma.correction.deleteMany({ where: { userId: USER } });
    await prisma.categorizationRule.deleteMany({ where: { userId: USER } });
    await prisma.account.deleteMany({ where: { userId: USER } });
    const acct = await prisma.account.create({
      data: { userId: USER, provider: 'simplefin', providerRef: 'wire-chk', name: 'Checking', type: 'CHECKING', currentBalanceCents: 100_000, currency: 'USD' },
    });
    await prisma.transaction.createMany({
      data: [
        { id: `wire-1-${process.pid}`, accountId: acct.id, date: '2026-06-09', amountCents: -1000, rawDescriptor: 'WIRING TEST BAKERY', merchantId: MERCH, categoryId: 'uncategorized', confidenceBps: 5000, needsReview: true },
        { id: `wire-2-${process.pid}`, accountId: acct.id, date: '2026-06-08', amountCents: -2000, rawDescriptor: 'WIRING TEST BAKERY', merchantId: MERCH, categoryId: 'uncategorized', confidenceBps: 5000, needsReview: true },
      ],
    });
  });

  it('applyCategory routes through serializableTx (the sixth writer — cycle-3 P1)', async () => {
    await applyCategory({ transactionId: `wire-1-${process.pid}`, categoryId: 'coffee', always: true });
    expect(vi.mocked(serializableTx)).toHaveBeenCalled();
  });

  it('fileMerchantGroup routes through serializableTx', async () => {
    await fileMerchantGroup({ anchorTransactionId: `wire-1-${process.pid}`, categoryId: 'coffee' });
    expect(vi.mocked(serializableTx)).toHaveBeenCalled();
  });

  it('recategorize (merchant-wide) routes through serializableTx', async () => {
    await recategorize({ transactionId: `wire-1-${process.pid}`, categoryId: 'coffee', scope: 'merchant' });
    expect(vi.mocked(serializableTx)).toHaveBeenCalled();
  });

  it('makeRuleFromCorrection routes through serializableTx', async () => {
    const res = await applyCategory({ transactionId: `wire-1-${process.pid}`, categoryId: 'coffee' });
    vi.mocked(serializableTx).mockClear();
    await makeRuleFromCorrection(res.correctionIds[0]);
    expect(vi.mocked(serializableTx)).toHaveBeenCalled();
  });

  it('provider guard sites are wired (source pin: ≥3 serializable sites each, zero interactive prisma.$transaction)', () => {
    for (const f of ['src/lib/providers/plaid.ts', 'src/lib/providers/simplefin.ts']) {
      const src = readFileSync(f, 'utf8');
      const sites = (src.match(/serializableTx\(/g) ?? []).length;
      expect(sites, `${f}: serializableTx call sites`).toBeGreaterThanOrEqual(3);
      expect(src, `${f}: interactive check-then-act must use serializableTx`).not.toMatch(
        /prisma\.\$transaction\(\s*async/,
      );
    }
  });
});
