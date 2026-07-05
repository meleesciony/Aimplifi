/**
 * SimpleFIN pure-mapper known-answer tests (ROADMAP: cheaper Plaid alternative).
 * The live network path can't run here (no SimpleFIN token), so the LEDGER-
 * correctness boundary — signs, cents, dates, account-type, categorization — is
 * what's tested. Hand-verified: unix 1577836800 = 2020-01-01 (epoch-day 18262);
 * 1781049600 = 2026-06-10 (18262 + 2192 + 160 = 20614).
 */
import { describe, expect, it } from 'vitest';
import { isoDate } from '@/lib/dates';
import { netWorthCents } from '@/lib/engine/cash-needed/assemble';
import {
  inferAccountType,
  mapSimplefinAccount,
  prepareSimplefinTransaction,
  simplefinAmountToCents,
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
  it('converts a unix timestamp to a UTC calendar date (floored to the day)', () => {
    expect(simplefinPostedToDate(1577836800)).toBe('2020-01-01');
    expect(simplefinPostedToDate(1781049600)).toBe('2026-06-10');
    expect(simplefinPostedToDate(1781049600 + 43200)).toBe('2026-06-10'); // noon → same day
  });

  it('pins the UTC day-boundary convention (#127 tail — no tz data, so ±1 day for mid-day feeds is by design)', () => {
    const midnightUtc = 1781049600; // 2026-06-10 00:00:00 UTC
    expect(simplefinPostedToDate(midnightUtc)).toBe('2026-06-10'); // exact boundary → that day
    expect(simplefinPostedToDate(midnightUtc + 86399)).toBe('2026-06-10'); // 23:59:59 UTC → same day
    expect(simplefinPostedToDate(midnightUtc + 86400)).toBe('2026-06-11'); // next midnight → next day
    // A US-evening post (e.g. 20:00 EDT = 00:00 UTC next day) intentionally lands on the UTC day.
    expect(simplefinPostedToDate(midnightUtc + 86400)).not.toBe('2026-06-10');
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
    // Brokerage institution with an ambiguous name → INVESTMENT (so its tickers
    // don't leak into the spending register), but a deposit account stays put:
    expect(inferAccountType('Charles Schwab US Community Property ...383 (383)')).toBe('INVESTMENT');
    expect(inferAccountType('Vanguard Brokerage Account')).toBe('INVESTMENT');
    expect(inferAccountType('Fidelity Cash Management')).toBe('CHECKING');
    expect(inferAccountType('Wells Fargo Everyday Checking')).toBe('CHECKING');
  });

  it('classifies no-keyword cash-back/travel cards + non-card liabilities (audit #126-followup)', () => {
    // No-keyword credit products a real SimpleFIN sync surfaces (would have defaulted to CHECKING):
    expect(inferAccountType('Wells Fargo Active Cash')).toBe('CREDIT');
    expect(inferAccountType('Citi Double Cash')).toBe('CREDIT');
    expect(inferAccountType('Citi Custom Cash')).toBe('CREDIT');
    expect(inferAccountType('Wells Fargo Autograph')).toBe('CREDIT');
    expect(inferAccountType('Bilt Rewards')).toBe('CREDIT');
    expect(inferAccountType('US Bank Altitude Go')).toBe('CREDIT');
    // Non-card liabilities (keyword-less or servicer-named) must be LOAN, never a CHECKING asset:
    expect(inferAccountType('Home Equity Line of Credit')).toBe('LOAN'); // not CREDIT ("credit" substring)
    expect(inferAccountType('My HELOC')).toBe('LOAN');
    expect(inferAccountType('MOHELA')).toBe('LOAN');
    expect(inferAccountType('Nelnet Student Loans')).toBe('LOAN');
    expect(inferAccountType('Navient')).toBe('LOAN');
    // ...but a deposit "Cash" account is NOT swept into CREDIT by the tight cash-product patterns:
    expect(inferAccountType('Premier Cash Rewards Checking')).toBe('CHECKING');
    expect(inferAccountType('PNC Cash Reserve')).toBe('CHECKING'); // not a brokerage name, no card product
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
      currency: null, // no currency on this fixture → assumed USD (DECISIONS #135)
    });
  });

  it('canonicalizes the account currency (DECISIONS #135): ISO upper-cased, non-ISO kept, omitted → null', () => {
    expect(mapSimplefinAccount({ id: 'u', name: 'Everyday Checking', balance: '100.00', currency: 'USD' }).currency).toBe('USD');
    // a lower-case ISO is upper-cased so the read-boundary 'USD' compare is exact
    expect(mapSimplefinAccount({ id: 'e', name: 'Euro Savings', balance: '100.00', currency: 'eur' }).currency).toBe('EUR');
    // SimpleFIN uses a URL for non-ISO currencies (crypto); kept as-is so it can never equal 'USD' → withheld
    expect(
      mapSimplefinAccount({ id: 'c', name: 'BTC Wallet', balance: '1.00', currency: 'https://x.test/btc' }).currency,
    ).toBe('https://x.test/btc');
    // omitted currency → null → assumed USD (golden-safe)
    expect(mapSimplefinAccount({ id: 'n', name: 'Everyday Checking', balance: '100.00' }).currency).toBeNull();
  });
  it('treats an ambiguously-named account with a NEGATIVE balance as a liability (net-worth-sign safety)', () => {
    // name matches no type keyword → would default CHECKING (asset); the negative
    // balance means it's owed, so it must be a liability or net worth inverts.
    expect(mapSimplefinAccount({ id: 'a', name: 'Signature Rewards', balance: '-1200.00' }).type).toBe('CREDIT');
    // an explicit checking with a negative balance (overdraft) is NOT reclassified
    expect(mapSimplefinAccount({ id: 'b', name: 'Everyday Checking', balance: '-50.00' }).type).toBe('CHECKING');
  });

  // audit #126-followup: an ASSET keeps its signed balance (an overdraft must NOT abs() to a
  // positive asset) and a LIABILITY stores |owed| (robust to SimpleFIN's un-normalized sign —
  // a card owed-negative and a loan positive-principal both land as a liability). Each case
  // hand-verifies the net-worth contribution via netWorthCents (isLiabilityType ? −bal : +bal).
  it('stores a sign-correct balance so net worth nets right (overdraft / owed card / positive-principal loan)', () => {
    const nw = (type: string, c: number) => netWorthCents([{ type, currentBalanceCents: c }]);

    // Owed card: SimpleFIN reports −642.10; store +64210 (|owed|), netWorth −$642.10. UNCHANGED.
    const owed = mapSimplefinAccount({ id: 'c', name: 'Sapphire Card', balance: '-642.10', org: { name: 'Chase' } });
    expect(owed.currentBalanceCents).toBe(64210);
    expect(nw(owed.type, owed.currentBalanceCents)).toBe(-64210);

    // Overdrawn checking: SimpleFIN reports −42.17; store −4217 (NOT +4217), netWorth −$42.17.
    const overdrawn = mapSimplefinAccount({ id: 'd', name: 'Everyday Checking', balance: '-42.17' });
    expect(overdrawn.type).toBe('CHECKING');
    expect(overdrawn.currentBalanceCents).toBe(-4217); // was +4217 under the old abs() bug
    expect(nw(overdrawn.type, overdrawn.currentBalanceCents)).toBe(-4217);

    // Positive-principal loan under a servicer name: typed LOAN (not a CHECKING asset), |owed|
    // = +1,800,000, netWorth −$18,000 (the old default-CHECKING path booked it as a +asset).
    const loan = mapSimplefinAccount({ id: 'f', name: 'Nelnet Student Loans', balance: '18000.00' });
    expect(loan.type).toBe('LOAN');
    expect(loan.currentBalanceCents).toBe(1800000);
    expect(nw(loan.type, loan.currentBalanceCents)).toBe(-1800000);

    // A healthy checking keeps its positive balance.
    expect(mapSimplefinAccount({ id: 'g', name: 'Everyday Checking', balance: '1500.00' }).currentBalanceCents).toBe(150000);
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
    expect(r.categoryId).toBe('coffee'); // #163: Starbucks = coffee
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
