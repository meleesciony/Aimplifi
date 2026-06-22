/**
 * SimpleFIN pure-mapper known-answer tests (ROADMAP: cheaper Plaid alternative).
 * The live network path can't run here (no SimpleFIN token), so the LEDGER-
 * correctness boundary — signs, cents, dates, account-type, categorization — is
 * what's tested. Hand-verified: unix 1577836800 = 2020-01-01 (epoch-day 18262);
 * 1781049600 = 2026-06-10 (18262 + 2192 + 160 = 20614).
 */
import { describe, expect, it } from 'vitest';
import { isoDate } from '@/lib/dates';
import {
  inferAccountType,
  mapSimplefinAccount,
  prepareSimplefinTransaction,
  simplefinAmountToCents,
  simplefinBalanceToPositiveCents,
  simplefinPostedToDate,
} from '@/lib/providers/simplefin-map';

const TODAY = isoDate('2026-06-10');

describe('SimpleFIN amount/balance/date conversion', () => {
  it('keeps the SimpleFIN sign (negative = out), no flip', () => {
    expect(simplefinAmountToCents('-42.50')).toBe(-4250); // money out
    expect(simplefinAmountToCents('2500.00')).toBe(250000); // money in
    expect(simplefinAmountToCents('0')).toBe(0);
  });
  it('tolerates thousands separators and >2 decimals (rounds to cents, no float)', () => {
    expect(simplefinAmountToCents('1,234.56')).toBe(123456); // comma stripped
    expect(simplefinAmountToCents('1.234')).toBe(123); // rounds down
    expect(simplefinAmountToCents('1.235')).toBe(124); // rounds half up
    expect(simplefinAmountToCents('-0.005')).toBe(-1);
  });
  it('throws only on genuine garbage', () => {
    expect(() => simplefinAmountToCents('abc')).toThrow();
    expect(() => simplefinAmountToCents('')).toThrow();
  });
  it('stores balances as a POSITIVE magnitude (type decides the sign)', () => {
    expect(simplefinBalanceToPositiveCents('-500.00')).toBe(50000); // a card you owe $500 on
    expect(simplefinBalanceToPositiveCents('1234.56')).toBe(123456);
  });
  it('converts a unix timestamp to a UTC calendar date (floored to the day)', () => {
    expect(simplefinPostedToDate(1577836800)).toBe('2020-01-01');
    expect(simplefinPostedToDate(1781049600)).toBe('2026-06-10');
    expect(simplefinPostedToDate(1781049600 + 43200)).toBe('2026-06-10'); // noon → same day
  });
});

describe('inferAccountType (SimpleFIN has no type field)', () => {
  it('infers from name keywords, defaulting to CHECKING', () => {
    expect(inferAccountType('Chase Sapphire Card')).toBe('CREDIT');
    expect(inferAccountType('Ally Online Savings')).toBe('SAVINGS');
    expect(inferAccountType('Fidelity Brokerage')).toBe('INVESTMENT');
    expect(inferAccountType('Wells Fargo Mortgage')).toBe('LOAN');
    expect(inferAccountType('Everyday Checking')).toBe('CHECKING');
    expect(inferAccountType('My Account')).toBe('CHECKING'); // default
  });

  it('classifies real-bank names that omit "card" / use product lines (DECISIONS #61)', () => {
    // Credit cards whose name has no "card"/issuer-type word (would have defaulted
    // to CHECKING and — at $0 balance — escaped the negative-balance safety net):
    expect(inferAccountType('Capital One QuicksilverOne (2079)')).toBe('CREDIT');
    expect(inferAccountType('Capital One VentureOne (2689)')).toBe('CREDIT');
    expect(inferAccountType('Chase Sapphire Reserve (0977)')).toBe('CREDIT');
    expect(inferAccountType('Capital One Spark Miles (5154)')).toBe('CREDIT');
    // 529 plans + retirement plans are investments, not checking:
    expect(inferAccountType('Charles Schwab US Schwab 529 Plan ...-01 (01)')).toBe('INVESTMENT');
    expect(inferAccountType('Vanguard Retirement Plan Account')).toBe('INVESTMENT');
    // Regression: an investor *checking* account must stay CHECKING (not investment):
    expect(inferAccountType('Charles Schwab US Investor Checking ...927 (927)')).toBe('CHECKING');
    expect(inferAccountType('Charles Schwab US Roth Contributory IRA ...156 (156)')).toBe('INVESTMENT');
  });
});

describe('mapSimplefinAccount', () => {
  it('maps id/name/type/positive-balance, prefixing the org name', () => {
    expect(
      mapSimplefinAccount({ id: 'acc-1', name: 'Sapphire Card', balance: '-642.10', org: { name: 'Chase' } }),
    ).toEqual({
      providerRef: 'acc-1',
      name: 'Chase Sapphire Card',
      type: 'CREDIT',
      currentBalanceCents: 64210, // positive magnitude; CREDIT type makes it a liability
    });
  });
  it('treats an ambiguously-named account with a NEGATIVE balance as a liability (net-worth-sign safety)', () => {
    // name matches no type keyword → would default CHECKING (asset); the negative
    // balance means it's owed, so it must be a liability or net worth inverts.
    expect(mapSimplefinAccount({ id: 'a', name: 'Signature Rewards', balance: '-1200.00' }).type).toBe('CREDIT');
    // an explicit checking with a negative balance (overdraft) is NOT reclassified
    expect(mapSimplefinAccount({ id: 'b', name: 'Everyday Checking', balance: '-50.00' }).type).toBe('CHECKING');
  });
});

describe('prepareSimplefinTransaction (through the shared pipeline)', () => {
  it('files a known merchant and keeps the outflow sign', () => {
    const r = prepareSimplefinTransaction(
      { id: 'tx1', posted: 1781049600, amount: '-42.50', description: 'STARBUCKS STORE 123 ATLANTA' },
      'acct',
      TODAY,
    );
    expect(r.amountCents).toBe(-4250);
    expect(r.date).toBe('2026-06-10');
    expect(r.categoryId).toBe('dining');
    expect(r.isTransfer).toBe(false);
    expect(r.status).toBe('POSTED');
    expect(r.providerRef).toBe('tx1');
  });
  it('flags a card payment as a transfer (shared transfer pattern)', () => {
    const r = prepareSimplefinTransaction(
      { id: 'tx2', posted: 1781049600, amount: '-500.00', description: 'CHASE EPAY SAPPHIRE' },
      'acct',
      TODAY,
    );
    expect(r.categoryId).toBe('transfer');
    expect(r.isTransfer).toBe(true);
  });
  it('marks a pending row PENDING and falls back to a descriptor when empty', () => {
    const r = prepareSimplefinTransaction({ id: 'tx3', posted: 1781049600, amount: '2500.00', pending: true }, 'acct', TODAY);
    expect(r.status).toBe('PENDING');
    expect(r.amountCents).toBe(250000);
    expect(r.rawDescriptor).toBe('Unknown Merchant');
  });
  it('dates a posted:0 pending row to transacted_at / today, never 1970 (LEDGER-3)', () => {
    const noTs = prepareSimplefinTransaction({ id: 'p1', posted: 0, amount: '-10.00', pending: true }, 'acct', TODAY);
    expect(noTs.date).toBe('2026-06-10'); // falls back to the sync date
    expect(noTs.status).toBe('PENDING');
    const withTs = prepareSimplefinTransaction({ id: 'p2', posted: 0, transacted_at: 1781049600, amount: '-10.00', pending: true }, 'acct', TODAY);
    expect(withTs.date).toBe('2026-06-10'); // uses transacted_at
  });
});
