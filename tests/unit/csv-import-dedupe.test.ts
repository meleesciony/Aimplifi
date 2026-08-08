/**
 * TASKS H.2 — the import action's overlap dedupe + "history now reaches" depth
 * confirmation, against the real seeded database. Covers the two shipping cases
 * (re-importing the same file; bank-export statement text matching
 * provider-synced rows whose rawDescriptor differs), account scoping (identical
 * rows on ANOTHER account are not duplicates), split parents in the match set,
 * and the post-import depth fact.
 *
 * The reconciliation-disowned case is NOT rebuilt here: the server applies the
 * R1 keep with one `.filter` over the already-tested shared predicate
 * (getReconciliationTxnKeep — constant-true without active links), and the
 * engine contract test pins the hidden-row semantics (a hidden row must not
 * suppress a visible re-add).
 *
 * ANTHROPIC_API_KEY is deleted so categorizeSuggestFor returns null and rows
 * stay untouched — deterministic, no egress (the demo fence test proves the
 * keyed path separately).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { auth } = await import('@/auth');
const { prisma } = await import('@/lib/db');
const { importTransactionsCsv } = await import('@/server/transaction-actions');

const USER = 'csv-dedupe-user';

function actAs(userId: string) {
  vi.mocked(auth).mockResolvedValue({ user: { id: userId } } as never);
}

function csv(text: string, accountId: string) {
  const fd = new FormData();
  fd.set('accountId', accountId);
  fd.set('csv', text);
  return fd;
}

/** Bank-statement text on purpose: "GOOSE POND BAR GRILLE" ≠ Plaid's "SQ *GOOSE POND". */
const FIVE_ROWS = [
  'date,description,amount',
  '2026-06-01,GOOSE POND BAR GRILLE,-84.20',
  '2026-06-02,COFFEE BEAN,-5.75',
  '2026-06-03,ACME PAYROLL,2500.00',
  '2026-06-04,PHARMACY,-23.10',
  '2026-06-05,GAS STATION,-45.00',
].join('\n');

/** A brand-new account with no seeded rows, so the depth floor is deterministic. */
async function freshAccount(): Promise<string> {
  const a = await prisma.account.create({
    data: { userId: USER, provider: 'manual', name: 'Dedupe Checking', type: 'CHECKING', currentBalanceCents: 0, currency: 'USD' },
  });
  return a.id;
}

const savedKey = process.env.ANTHROPIC_API_KEY;

beforeEach(async () => {
  delete process.env.ANTHROPIC_API_KEY; // no LLM assist → rows unchanged (deterministic)
  actAs(USER);
  await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } }).catch(() => {});
});
afterEach(() => {
  if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedKey;
  vi.restoreAllMocks();
});

describe('importTransactionsCsv dedupe (H.2)', () => {
  it('re-importing the same file adds nothing and reports every row as a duplicate', async () => {
    const accountId = await freshAccount();

    const first = await importTransactionsCsv(null, csv(FIVE_ROWS, accountId));
    expect(first.ok).toBe(true);
    expect(first.imported).toBe(5);
    expect(first.duplicates).toBe(0);
    // Fresh account: the floor is the file's own earliest row — the depth fact.
    expect(first.historyReachesDate).toBe('2026-06-01');

    const second = await importTransactionsCsv(null, csv(FIVE_ROWS, accountId));
    expect(second.ok).toBe(true); // a no-op re-import is a SUCCESS, not an error
    expect(second.imported).toBe(0);
    expect(second.duplicates).toBe(5);
    expect(second.historyReachesDate).toBeNull(); // nothing was added → no depth claim

    const total = await prisma.transaction.count({ where: { accountId } });
    expect(total).toBe(5);
  });

  it('drops rows the provider already synced even though the descriptors differ', async () => {
    const accountId = await freshAccount();
    // A Plaid-style synced row: SQ * descriptor, same date + signed amount as the
    // file's statement-text row for the same charge.
    await prisma.transaction.create({
      data: {
        accountId,
        date: '2026-06-02',
        amountCents: -575,
        rawDescriptor: 'SQ *COFFEE BEAN',
        categoryId: 'coffee',
        confidenceBps: 9950,
        status: 'POSTED',
        needsReview: false,
        isTransfer: false,
      },
    });

    const r = await importTransactionsCsv(null, csv(FIVE_ROWS, accountId));
    expect(r.imported).toBe(4);
    expect(r.duplicates).toBe(1);
    const total = await prisma.transaction.count({ where: { accountId } });
    expect(total).toBe(5); // 1 synced + 4 imported — the charge exists ONCE
  });

  it('keeps identical rows that live on a DIFFERENT account', async () => {
    const a = await freshAccount();
    const b = await freshAccount();
    // Same (date, signed amount) on account b — account a has none of it.
    await prisma.transaction.create({
      data: {
        accountId: b,
        date: '2026-06-01',
        amountCents: -8420,
        rawDescriptor: 'GOOSE POND BAR GRILLE',
        categoryId: 'dining',
        confidenceBps: 9950,
        status: 'POSTED',
        needsReview: false,
        isTransfer: false,
      },
    });
    const r = await importTransactionsCsv(null, csv('date,description,amount\n2026-06-01,GOOSE POND BAR GRILLE,-84.20\n', a));
    expect(r.imported).toBe(1);
    expect(r.duplicates).toBe(0);
  });

  it('drops a whole-charge row whose split parent already represents it', async () => {
    const accountId = await freshAccount();
    // The user split the $100 charge into pieces; the parent carries (date, -10000).
    await prisma.transaction.create({
      data: {
        accountId,
        date: '2026-06-04',
        amountCents: -10000,
        rawDescriptor: 'TRADER JOE',
        categoryId: 'groceries',
        confidenceBps: 9950,
        status: 'POSTED',
        needsReview: false,
        isTransfer: false,
        isSplitParent: true,
      },
    });
    const r = await importTransactionsCsv(
      null,
      csv('date,description,amount\n2026-06-04,TRADER JOE,-100.00\n2026-06-05,GAS STATION,-45.00\n', accountId),
    );
    expect(r.imported).toBe(1);
    expect(r.duplicates).toBe(1);
  });

  it('surfaces file-internal repeated keys as repeatedRows, then clears the warning on re-import (critic P1-1)', async () => {
    const accountId = await freshAccount();
    // Two overlapping exports pasted together: the shared chunk (2026-06-02
    // COFFEE BEAN) appears twice, the account holds none of it. Both rows are
    // imported (multiset semantics untouched) but the count is returned.
    const file = [
      'date,description,amount',
      '2026-06-02,COFFEE BEAN,-5.75',
      '2026-06-02,COFFEE BEAN,-5.75',
      '2026-06-03,ACME PAYROLL,2500.00',
    ].join('\n');

    const first = await importTransactionsCsv(null, csv(file, accountId));
    expect(first.ok).toBe(true);
    expect(first.imported).toBe(3);
    expect(first.duplicates).toBe(0);
    expect(first.repeatedRows).toBe(2);

    const second = await importTransactionsCsv(null, csv(file, accountId));
    expect(second.imported).toBe(0);
    expect(second.duplicates).toBe(3);
    expect(second.repeatedRows).toBe(0); // nothing kept → nothing to warn

    // The audit row carries the warning count (the truth server-side tests
    // rely on — same channel the G.1 severing investigation read). The local
    // adapter stores `meta` as a JSON string; Postgres reads it as JSONB.
    const logs = await prisma.auditLog.findMany({
      where: { action: 'transaction.import.csv' },
      select: { meta: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    const metaOf = (row: { meta: unknown }) =>
      typeof row.meta === 'string' ? (JSON.parse(row.meta) as Record<string, unknown>) : (row.meta as Record<string, unknown>);
    expect(metaOf(logs[0]!)).toMatchObject({ accountId, imported: 0, duplicates: 3, repeatedRows: 0 });
    expect(metaOf(logs[1]!)).toMatchObject({ accountId, imported: 3, duplicates: 0, repeatedRows: 2 });
  });

  it('refuses a non-register account target (critic P2-2 residual)', async () => {
    // The picker only offers spending accounts, but crafted FormData could name
    // any account — the action must refuse on the same register basis.
    const a = await prisma.account.create({
      data: { userId: USER, provider: 'manual', name: 'Dedupe Brokerage', type: 'INVESTMENT', currentBalanceCents: 0, currency: 'USD' },
    });
    const r = await importTransactionsCsv(
      null,
      csv('date,description,amount\n2026-06-01,GOOSE POND BAR GRILLE,-84.20\n', a.id),
    );
    expect(r.ok).toBe(false);
    expect(r.imported).toBe(0);
    expect(r.errors[0]).toMatch(/register/i);
    expect(await prisma.transaction.count({ where: { accountId: a.id } })).toBe(0);
  });

  it('reports the depth fact on the register basis — the accounts depth line agrees', async () => {
    const accountId = await freshAccount();
    // A register row older than anything in the file (e.g. pre-existing synced
    // history) — the depth fact must come from the account's EARLIEST row, not
    // the file's.
    await prisma.transaction.create({
      data: {
        accountId,
        date: '2024-11-03',
        amountCents: -150000,
        rawDescriptor: 'RENT DEPOSIT',
        categoryId: 'rent',
        confidenceBps: 9950,
        status: 'POSTED',
        needsReview: false,
        isTransfer: false,
      },
    });
    const r = await importTransactionsCsv(null, csv(FIVE_ROWS, accountId));
    expect(r.ok).toBe(true);
    expect(r.historyReachesDate).toBe('2024-11-03'); // the register floor, not 2026-06-01
  });
});
