/**
 * HOSTILE CRITIC — Phase 5 (final) probes: new Phase-4/5 surface.
 *  - CSV export: RFC-4180 quoting + spreadsheet-formula-injection regressions
 *    (critic finding P2-1, fixed: '=+-@'-leading fields get an apostrophe).
 *  - rateLimit(): 10 allowed / 11th rejected within the window.
 *  - Categorization: 5 fresh hostile descriptors through the live pipeline.
 *  - Calendar: weekend card due date appears on the EFFECTIVE (walked-back) day.
 */
import { describe, expect, it, vi } from 'vitest';

// authz.ts imports @/auth (next-auth) and @/lib/db (prisma) for its session
// helpers; neither resolves under vitest. Mock those imports so the REAL
// rateLimit implementation is still the code under test.
vi.mock('@/auth', () => ({ auth: async () => null }));
vi.mock('@/lib/db', () => ({ prisma: {} }));

import { transactionsToCsv, type ExportTxn } from '@/lib/export';
import { rateLimit } from '@/server/authz';
import { categorize } from '@/lib/engine/categorize/pipeline';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { buildCashFlowCalendar } from '@/lib/engine/calendar/build';
import type { CardObligation } from '@/lib/engine/cash-needed/types';
import { cents, type Cents } from '@/lib/money';
import { holidayTable, isoDate } from '@/lib/dates';

function row(over: Partial<ExportTxn>): ExportTxn {
  return {
    date: '2026-06-01',
    account: 'Checking',
    rawDescriptor: 'KROGER #123',
    merchant: 'Kroger',
    category: 'Groceries',
    amountCents: -1234,
    status: 'POSTED',
    onHandoverDay: false,
    ...over,
  };
}

describe('critic5: CSV export quoting + formula injection', () => {
  it('RFC-4180: commas/quotes/newlines are quoted and doubled', () => {
    const csv = transactionsToCsv([row({ rawDescriptor: 'A, "B"\nC' })]);
    expect(csv).toContain('"A, ""B""\nC"');
  });

  it('formula injection neutralized: leading = gets an apostrophe prefix (critic P2-1, fixed)', () => {
    const csv = transactionsToCsv([row({ rawDescriptor: '=SUM(A1:A9)' })]);
    const line = csv.split('\r\n')[1];
    expect(line).toContain(",'=SUM(A1:A9),");
    expect(line).not.toContain(',=SUM');
  });

  it('formula injection neutralized: leading + and @ too (critic P2-1, fixed)', () => {
    const csv = transactionsToCsv([
      row({ rawDescriptor: '+1-CMD|calc' }),
      row({ rawDescriptor: '@evil()' }),
    ]);
    expect(csv).toContain(",'+1-CMD|calc,");
    expect(csv).toContain(",'@evil(),");
    expect(csv).not.toMatch(/,[=+@]/);
  });
});

describe('critic5: export rate limiter', () => {
  it('allows exactly 10 requests per window, rejects the 11th', () => {
    const key = `critic5-probe-${Date.now()}`;
    const results: boolean[] = [];
    for (let i = 0; i < 11; i++) results.push(rateLimit(key, 10, 60_000));
    expect(results.slice(0, 10).every(Boolean)).toBe(true);
    expect(results[10]).toBe(false);
  });
});

describe('critic5: 5 fresh hostile descriptors through the live pipeline', () => {
  it('1. "T-MOBILE PREPAY AUTOPAY" stays REAL spending (EPAY substring inside PREPAY must not match)', () => {
    const r = categorize({ rawDescriptor: 'T-MOBILE PREPAY', amountCents: -4500, date: '2026-06-08', accountId: 'a' });
    expect(r.categoryId).not.toBe('transfer');
  });

  it('2. "PAYMENT THANK YOU - WEB" IS a card-payment transfer (anchored match)', () => {
    const r = categorize({ rawDescriptor: 'PAYMENT THANK YOU - WEB', amountCents: 50000, date: '2026-06-08', accountId: 'a' });
    expect(r.categoryId).toBe('transfer');
    expect(r.needsReview).toBe(false);
  });

  it('3. bare processor prefix "SQ *" does not crash and goes to review with a non-empty merchant', () => {
    const r = categorize({ rawDescriptor: 'SQ *', amountCents: -700, date: '2026-06-08', accountId: 'a' });
    expect(r.merchantCanonical.length).toBeGreaterThan(0); // "Unknown Merchant" fallback
    expect(r.needsReview).toBe(true);
  });

  it('4. spreadsheet-formula descriptor "=HYPERLINK(...)" categorizes without crashing → review', () => {
    const r = categorize({ rawDescriptor: '=HYPERLINK("http://evil","x")', amountCents: -100, date: '2026-06-08', accountId: 'a' });
    expect(r.needsReview).toBe(true);
    expect(r.categoryId).toBe('uncategorized');
  });

  it('5. "COSTCO GAS#0042 ATLANTA GA" (missing space) is NOT silently mis-filed as Costco groceries', () => {
    const m = normalizeMerchant('COSTCO GAS#0042 ATLANTA GA');
    expect(m.known).toBe(false); // pattern requires "GAS #"; unknown → low confidence
    const r = categorize({ rawDescriptor: 'COSTCO GAS#0042 ATLANTA GA', amountCents: -5210, date: '2026-06-08', accountId: 'a' });
    expect(r.needsReview).toBe(true); // conservative: review, never a wrong silent auto-file
  });
});

describe('critic5: calendar places weekend due dates on the effective day', () => {
  const freedomOb: CardObligation = {
    cardId: 'freedom',
    cardName: 'Freedom Card',
    dueDate: isoDate('2026-06-28'), // Sunday (issuer date)
    effectiveDueDate: isoDate('2026-06-26'), // Friday (engine-adjusted)
    cashRequiredCents: cents(60000) as Cents,
    autopayCents: cents(0) as Cents,
    userActionCents: cents(60000) as Cents,
    remainingDueCents: cents(60000) as Cents,
    minimumDueCents: cents(0) as Cents,
    isEstimated: false,
    notes: [],
    frozenSince: null,
    isManual: false,
  };

  it('Freedom (issuer Sun 06-28) shows on Fri 06-26 and NOT on 06-28', () => {
    const cal = buildCashFlowCalendar({
      month: '2026-06',
      scheduled: [],
      cardObligations: [freedomOb],
      today: isoDate('2026-06-10'),
      holidays: holidayTable(2026, 2027),
    });
    const d26 = cal.days.find((d) => d.date === '2026-06-26')!;
    const d28 = cal.days.find((d) => d.date === '2026-06-28')!;
    expect(d26.events.some((e) => e.kind === 'card-due' && e.label.startsWith('Freedom'))).toBe(true);
    expect(d28.events).toHaveLength(0);
    expect(cal.reminderDates).toContain('2026-06-26');
    expect(cal.totalOutCents).toBe(60000);
  });
});
