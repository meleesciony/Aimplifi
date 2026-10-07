/**
 * DECISIONS #789, critic cycle 2 — the two server readers the pure tests cannot reach:
 * the CSV export's transfer column (P3-2) and /recurring's price increases (P2-3), each
 * through its real loader over a real database. Every amount and name is invented.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { GET } from '@/app/api/export/route';
import { prisma } from '@/lib/db';
import { getRecurring } from '@/server/recurring';

const USER = `inv-not-spend-c2-${Date.now()}-${process.pid}`;
const CHK = `${USER}-chk`;
const LOAN = `${USER}-loan`;

beforeAll(async () => {
  vi.stubEnv('DEMO_TODAY', '2026-06-10');
  await prisma.user.deleteMany({ where: { id: USER } });
  await prisma.user.create({ data: { id: USER, email: `${USER}@test.local`, paymentAccountId: null } });
  await prisma.account.create({
    data: { id: CHK, userId: USER, provider: 'manual', providerRef: `${USER}-r`, name: 'Everyday Checking', type: 'CHECKING', mask: '3318', currentBalanceCents: 900000, currency: 'USD' },
  });
  await prisma.account.create({
    data: { id: LOAN, userId: USER, provider: 'manual', providerRef: `${USER}-l`, name: 'Car Loan', type: 'LOAN', mask: '7740', currentBalanceCents: -1200000, currency: 'USD' },
  });
  const r = (date: string, amountCents: number, rawDescriptor: string, categoryId: string) => ({ accountId: CHK, date, amountCents, rawDescriptor, categoryId, confidenceBps: 10000, needsReview: false });
  const data = [];
  // #792 critic cycle 3, P2-2: rows /recurring's detector never reads (pending; on a loan
  // account), dated first, so the snapshot's positions are not the detector's. A verdict
  // read by snapshot position would read these rows' filings for the 529's.
  for (const d of ['2025-12-01', '2025-12-02', '2025-12-03']) {
    data.push({ ...r(d, -4500, 'PENDING COFFEE', 'shopping'), status: 'PENDING' });
    data.push({ ...r(d, -9000, 'LOAN INTEREST', 'shopping'), accountId: LOAN });
  }
  for (const m of ['01', '02', '03', '04', '05']) {
    // A 529 plan the reader files Investment & Savings (the categorizer does not), rising.
    data.push(r(`2026-${m}-20`, m === '05' ? -25000 : -20000, 'NY 529 COLLEGE SAVINGS PLAN', 'investment'));
    // A real subscription that rose.
    data.push(r(`2026-${m}-08`, m === '05' ? -1799 : -1599, 'NETFLIX.COM', 'subscriptions'));
  }
  await prisma.transaction.createMany({ data });
});

afterAll(async () => {
  await prisma.rateLimit.deleteMany({ where: { key: `export:${USER}` } });
  await prisma.transaction.deleteMany({ where: { account: { userId: USER } } });
  await prisma.account.deleteMany({ where: { userId: USER } });
  await prisma.user.deleteMany({ where: { id: USER } });
  vi.unstubAllEnvs();
});

describe('P2-3 — /recurring reads the reader’s filing', () => {
  it('the 529 the reader filed Investment & Savings rose: more saving, not a price increase; Netflix is one', async () => {
    const { summary } = await getRecurring(USER);
    expect(summary.items.some((i) => /529/i.test(i.merchantCanonical) && i.movesMoney)).toBe(true);
    expect(summary.priceIncreases.some((i) => /529/i.test(i.merchantCanonical))).toBe(false);
    expect(summary.priceIncreases.some((i) => /netflix/i.test(i.merchantCanonical))).toBe(true);
  });
});

describe('P3-2 — the CSV’s transfer column is the register’s own test', () => {
  it('a row filed Investment & Savings is marked, and the note names money moved into investing', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: USER } } as never);
    await prisma.rateLimit.deleteMany({ where: { key: `export:${USER}` } });
    const res = await GET(new NextRequest('http://localhost/api/export?format=transactions-csv'));
    expect(res.status).toBe(200);
    const lines = (await res.text()).split('\r\n');
    const rowsOf = (d: string) => lines.filter((l) => l.includes(d));
    expect(rowsOf('NY 529 COLLEGE SAVINGS PLAN').length).toBe(5);
    expect(rowsOf('NY 529 COLLEGE SAVINGS PLAN').every((l) => l.endsWith(',yes'))).toBe(true);
    expect(rowsOf('NETFLIX.COM').every((l) => l.endsWith(','))).toBe(true);
    expect(lines.some((l) => l.includes('moving money between accounts, or into or out of investing,'))).toBe(true);
  });
});
