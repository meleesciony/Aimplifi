/**
 * First-run CSV import had a required empty account <select>. Onboarding
 * "Import a CSV from your bank" sent a household with no connection into a
 * form that could not submit.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { csvImportGuidesIntro } from '@/lib/copy/csv-import-copy';
import { parseCsvImportNewAccount } from '@/lib/engine/transactions/csv-import';
import { GENERIC_CSV_GUIDE } from '@/lib/engine/transactions/csv-export-guide';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { auth } = await import('@/auth');
const { prisma } = await import('@/lib/db');
const { importTransactionsCsv } = await import('@/server/transaction-actions');

const USER = `csv-newacct-${Date.now()}-${process.pid}`;

function actAs(userId: string) {
  vi.mocked(auth).mockResolvedValue({ user: { id: userId } } as never);
}

const ONE_ROW = 'date,description,amount\n2026-06-01,Coffee shop,-4.50\n';

describe('parseCsvImportNewAccount (DECISIONS #547)', () => {
  it('test_regression__csv_first_run_names_a_spending_account', () => {
    expect(parseCsvImportNewAccount('Checking', 'CHECKING')).toEqual({
      ok: true,
      name: 'Checking',
      type: 'CHECKING',
    });
    expect(parseCsvImportNewAccount('  Visa  ', 'CREDIT')).toEqual({
      ok: true,
      name: 'Visa',
      type: 'CREDIT',
    });
    expect(parseCsvImportNewAccount('', 'CHECKING').ok).toBe(false);
    expect(parseCsvImportNewAccount('Checking', 'INVESTMENT').ok).toBe(false);
    expect(parseCsvImportNewAccount('Checking', 'LOAN').ok).toBe(false);
  });
});

describe('CSV guides do not pretend we saw a bank (DECISIONS #547)', () => {
  it('test_regression__csv_guides_intro_is_any_bank_when_none_connected', () => {
    expect(csvImportGuidesIntro(0)).toMatch(/any bank/i);
    expect(csvImportGuidesIntro(0)).not.toMatch(/we see on your accounts/i);
    expect(csvImportGuidesIntro(1)).toMatch(/we see on your accounts/i);
    expect(GENERIC_CSV_GUIDE.steps.join(' ')).toMatch(/Debit\/Credit/);
    expect(GENERIC_CSV_GUIDE.steps.join(' ')).not.toMatch(/columns should say date, description, and amount/);

    const form = readFileSync(resolve('src/components/finance/import-csv-form.tsx'), 'utf8');
    expect(form).toContain('import-new-account');
    expect(form).toContain('newAccountName');
    expect(form).toContain('newAccountType');

    const guides = readFileSync(resolve('src/components/finance/csv-import-guides.tsx'), 'utf8');
    expect(guides).toContain('csvImportGuidesIntro');
  });
});

describe('importTransactionsCsv first-run creates the account (DECISIONS #547)', () => {
  const savedKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(async () => {
    delete process.env.ANTHROPIC_API_KEY;
    actAs(USER);
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } }).catch(() => {});
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = savedKey;
    vi.restoreAllMocks();
  });

  it('test_regression__csv_import_creates_checking_when_none_exist', async () => {
    const before = await prisma.account.count({ where: { userId: USER } });
    expect(before).toBe(0);

    const fd = new FormData();
    fd.set('newAccountName', 'Everyday checking');
    fd.set('newAccountType', 'CHECKING');
    fd.set('csv', ONE_ROW);
    const r = await importTransactionsCsv(null, fd);
    expect(r.ok).toBe(true);
    expect(r.imported).toBe(1);
    expect(r.errors).toEqual([]);

    const accts = await prisma.account.findMany({ where: { userId: USER } });
    expect(accts).toHaveLength(1);
    expect(accts[0]).toMatchObject({
      name: 'Everyday checking',
      type: 'CHECKING',
      provider: 'manual',
      currentBalanceCents: 0,
    });
    const txns = await prisma.transaction.findMany({ where: { accountId: accts[0].id } });
    expect(txns).toHaveLength(1);
    expect(txns[0].amountCents).toBe(-450);
  });

  it('still refuses a crafted unknown accountId', async () => {
    const fd = new FormData();
    fd.set('accountId', 'no-such-account');
    fd.set('csv', ONE_ROW);
    const r = await importTransactionsCsv(null, fd);
    expect(r.ok).toBe(false);
    expect(r.imported).toBe(0);
    expect(r.errors[0]).toMatch(/Account not found/);
  });
});
