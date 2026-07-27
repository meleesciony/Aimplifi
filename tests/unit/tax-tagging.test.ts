/**
 * The persistence half of the tax slice, end to end against the real database:
 * `setTransactionTax` (the only thing that writes `Transaction.note` /
 * `Transaction.taxClass`) and the `/api/export?format=tax-year-csv` route that
 * reads them back.
 *
 * The engine's arithmetic is locked in tax-export.test.ts / tax-csv.test.ts. What
 * these tests exist for is everything the engine cannot see: that the write refuses
 * a row belonging to someone else, that a bad tag never reaches the column, that the
 * route will not guess a year, and that the file the reader downloads contains their
 * rows and only their rows.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { GET } from '@/app/api/export/route';
import { prisma } from '@/lib/db';
import { setTransactionTax } from '@/server/tax-actions';
import { getTaxYears } from '@/server/tax';
import { TXN_NOTE_MAX_CHARS } from '@/lib/engine/tax/note';

const stamp = `${Date.now()}-${process.pid}`;
const OWNER = `tax-owner-${stamp}`;
const STRANGER = `tax-stranger-${stamp}`;

let ownTxnId = '';
let strangerTxnId = '';
let splitParentId = '';
let pendingTxnId = '';

const asUser = (id: string) => vi.mocked(auth).mockResolvedValue({ user: { id } } as never);
const clearLimit = () =>
  prisma.rateLimit.deleteMany({ where: { key: { in: [`export:${OWNER}`, `export:${STRANGER}`] } } });

async function wipe() {
  await prisma.user.deleteMany({ where: { id: { in: [OWNER, STRANGER] } } });
  await clearLimit();
}

beforeAll(async () => {
  await wipe().catch(() => {});
  for (const id of [OWNER, STRANGER]) {
    await prisma.user.create({ data: { id, email: `${id}@test.local` } });
  }
  const ownAcct = await prisma.account.create({
    data: {
      userId: OWNER, provider: 'simplefin', name: 'Tax Checking',
      type: 'CHECKING', currentBalanceCents: 10_000, currency: 'USD',
    },
  });
  const strangerAcct = await prisma.account.create({
    data: {
      userId: STRANGER, provider: 'simplefin', name: 'Stranger Checking',
      type: 'CHECKING', currentBalanceCents: 10_000, currency: 'USD',
    },
  });
  const mk = (accountId: string, over: Record<string, unknown> = {}) =>
    prisma.transaction.create({
      data: {
        accountId, date: '2025-03-04', amountCents: -12_345,
        rawDescriptor: 'TAX FIXTURE PHARMACY', status: 'POSTED',
        isTransfer: false, isSplitParent: false, ...over,
      },
    });
  ownTxnId = (await mk(ownAcct.id)).id;
  strangerTxnId = (await mk(strangerAcct.id, { rawDescriptor: 'STRANGER SECRET CLINIC' })).id;
  splitParentId = (await mk(ownAcct.id, { isSplitParent: true, rawDescriptor: 'TAX FIXTURE SPLIT' })).id;
  pendingTxnId = (await mk(ownAcct.id, { status: 'PENDING', date: '2024-11-11', rawDescriptor: 'TAX FIXTURE PENDING' })).id;
});
afterAll(wipe);
beforeEach(async () => {
  vi.clearAllMocks();
  await clearLimit();
});

describe('setTransactionTax — the only path that fills these columns', () => {
  it('writes the tag and the note together, and reading back gives exactly what was typed', async () => {
    asUser(OWNER);
    expect(await setTransactionTax({ transactionId: ownTxnId, taxClass: 'medical', note: "  mum's prescription  " })).toEqual({ ok: true });
    const t = await prisma.transaction.findUnique({ where: { id: ownTxnId } });
    expect(t?.taxClass).toBe('medical');
    expect(t?.note).toBe("mum's prescription"); // trimmed at the ends, verbatim inside
  });

  it('clears to NULL rather than empty string, so "cleared" and "never wrote one" are one state', async () => {
    asUser(OWNER);
    await setTransactionTax({ transactionId: ownTxnId, taxClass: 'medical', note: 'temporary' });
    expect(await setTransactionTax({ transactionId: ownTxnId, taxClass: null, note: '   ' })).toEqual({ ok: true });
    const t = await prisma.transaction.findUnique({ where: { id: ownTxnId } });
    expect(t?.taxClass).toBeNull();
    expect(t?.note).toBeNull();
  });

  it('refuses a class it does not know, and writes NOTHING when it does', async () => {
    asUser(OWNER);
    await setTransactionTax({ transactionId: ownTxnId, taxClass: 'medical', note: 'keep me' });
    const res = await setTransactionTax({ transactionId: ownTxnId, taxClass: 'crypto-losses', note: 'new note' });
    expect(res).toEqual({ ok: false, error: expect.stringContaining('not a tax category') });
    // The refusal is total: the note must not land while the tag bounces, or the
    // reader ends up with half of what they pressed Save on.
    const t = await prisma.transaction.findUnique({ where: { id: ownTxnId } });
    expect(t?.taxClass).toBe('medical');
    expect(t?.note).toBe('keep me');
  });

  it('refuses a note over the cap instead of truncating it', async () => {
    asUser(OWNER);
    const res = await setTransactionTax({
      transactionId: ownTxnId,
      taxClass: 'medical',
      note: 'x'.repeat(TXN_NOTE_MAX_CHARS + 1),
    });
    expect(res.ok).toBe(false);
    const t = await prisma.transaction.findUnique({ where: { id: ownTxnId } });
    expect(t?.note).not.toContain('xxx');
  });

  it("will not tag someone else's transaction", async () => {
    asUser(OWNER);
    const res = await setTransactionTax({ transactionId: strangerTxnId, taxClass: 'medical', note: 'mine now' });
    expect(res).toEqual({ ok: false, error: expect.stringContaining('no longer available') });
    const t = await prisma.transaction.findUnique({ where: { id: strangerTxnId } });
    expect(t?.taxClass).toBeNull();
    expect(t?.note).toBeNull();
  });

  it('never records the note TEXT in the audit log — only that a write happened', async () => {
    asUser(OWNER);
    await setTransactionTax({ transactionId: ownTxnId, taxClass: 'medical', note: 'therapy for my son' });
    const logs = await prisma.auditLog.findMany({ where: { userId: OWNER, action: 'transaction.tax.set' } });
    expect(logs.length).toBeGreaterThan(0);
    for (const l of logs) expect(l.meta ?? '').not.toContain('therapy');
    expect(logs.at(-1)?.meta ?? '').toContain('noteChars');
  });
});

describe('getTaxYears — what the settings card offers', () => {
  it('offers only years with a countable tagged row', async () => {
    asUser(OWNER);
    // A pending 2024 row and a split container: neither can produce a group.
    await setTransactionTax({ transactionId: pendingTxnId, taxClass: 'medical', note: null });
    await setTransactionTax({ transactionId: splitParentId, taxClass: 'medical', note: null });
    await setTransactionTax({ transactionId: ownTxnId, taxClass: 'medical', note: null });
    expect(await getTaxYears(OWNER)).toEqual([2025]);
  });

  it('offers nothing to a reader who has tagged nothing', async () => {
    expect(await getTaxYears(STRANGER)).toEqual([]);
  });
});

describe('GET /api/export?format=tax-year-csv', () => {
  const url = (qs: string) => new NextRequest(`http://localhost/api/export?format=tax-year-csv&${qs}`);

  it('rejects an unauthenticated request with 401', async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    expect((await GET(url('year=2025'))).status).toBe(401);
  });

  it('will not guess a year — a missing or malformed one is a 400, never a default', async () => {
    asUser(OWNER);
    expect((await GET(new NextRequest('http://localhost/api/export?format=tax-year-csv'))).status).toBe(400);
    await clearLimit();
    expect((await GET(url('year=last'))).status).toBe(400);
    await clearLimit();
    expect((await GET(url('year=25'))).status).toBe(400);
    await clearLimit();
    expect((await GET(url('year=99999'))).status).toBe(400);
  });

  it('serves the tagged year as a named CSV attachment', async () => {
    asUser(OWNER);
    await setTransactionTax({ transactionId: ownTxnId, taxClass: 'medical', note: 'annual check-up' });
    await clearLimit();
    const res = await GET(url('year=2025'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    expect(res.headers.get('Content-Disposition')).toContain('aimplifi-tax-2025.csv');
    const csv = await res.text();
    expect(csv).toContain('Aimplifi tax-year export,2025');
    expect(csv).toContain('Medical & dental');
    expect(csv).toContain('annual check-up');
    expect(csv).toContain('123.45'); // the fixture's $123.45, net paid
    // The claim it refuses to make, in the file itself.
    expect(csv).toContain('not tax advice');
  });

  it("contains the exporter's rows and only theirs", async () => {
    asUser(STRANGER);
    await setTransactionTax({ transactionId: strangerTxnId, taxClass: 'medical', note: 'private' });
    await clearLimit();
    asUser(OWNER);
    const csv = await (await GET(url('year=2025'))).text();
    expect(csv).toContain('Tax Fixture Pharmacy');
    expect(csv).not.toContain('Stranger Secret Clinic');
    expect(csv).not.toContain('private');
  });

  it('excludes a tagged split container and says so, so the split cannot double-count', async () => {
    asUser(OWNER);
    await setTransactionTax({ transactionId: ownTxnId, taxClass: 'medical', note: null });
    await setTransactionTax({ transactionId: splitParentId, taxClass: 'medical', note: null });
    await clearLimit();
    const csv = await (await GET(url('year=2025'))).text();
    expect(csv).toContain('split into parts');
    // $123.45 once, not twice: the child-side row is the only line, and the grand
    // total matches it rather than doubling.
    expect(csv).toContain('All groups,123.45,0.00');
  });
});
