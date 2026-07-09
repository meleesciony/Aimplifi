/**
 * Pure mappers from SimpleFIN shapes into Pulse's data model (ROADMAP: cheaper
 * Plaid alternative). No I/O — the single boundary where SimpleFIN's signed
 * decimal-string amounts and unix timestamps become Pulse's integer cents and
 * YYYY-MM-DD calendar dates. Unit-tested with fixtures: this is the part whose
 * bugs would silently corrupt the ledger, so it is tested even though the live
 * network calls cannot be (no SimpleFIN token in this env).
 *
 * Sign convention (SimpleFIN): `amount` is a signed decimal STRING where NEGATIVE
 * means money LEFT the account — the SAME convention Pulse stores, so unlike Plaid
 * we do NOT flip the transaction sign. BALANCES are signed too, but SimpleFIN does NO sign
 * normalization (a card may report owed as negative, a loan as positive principal). We store
 * the SIGNED balance for an ASSET (so an overdrawn deposit account stays negative) and the
 * |amount owed| for a LIABILITY, so the type-based net-worth flip (`isLiabilityType ? −bal :
 * +bal`) nets correctly. The earlier Math.abs()-everything store inverted an overdrawn deposit
 * account into a positive asset (audit #126-followup).
 *
 * UNVERIFIED: the SimpleFIN protocol here is implemented from documentation as of
 * the Jan-2026 knowledge cutoff. Confirm the exact field names/shapes against the
 * current SimpleFIN spec before trusting the live path (docs/SIMPLEFIN_WALKTHROUGH.md).
 */
import { type ISODate, fromEpochDays } from '@/lib/dates';
import { type Cents, cents } from '@/lib/money';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { type RuleLike, categorize } from '@/lib/engine/categorize/pipeline';
import { canonicalizeCurrency } from './currency';

export type PulseAccountType = 'CHECKING' | 'SAVINGS' | 'CREDIT' | 'INVESTMENT' | 'LOAN';

/**
 * Signed decimal-string amount → signed cents (NO flip — SimpleFIN is
 * outflow-negative, like Pulse). Tolerant of thousands separators and MORE than
 * two decimals (the spec doesn't guarantee 2dp), rounding to cents with integer
 * math — no float — so a legitimate '12.345' or '1,234.5' ingests instead of being
 * silently dropped (Hostile Critic LEDGER-4). Throws only on genuine garbage.
 */
export function simplefinAmountToCents(amount: string): Cents {
  const s = amount.trim().replace(/,/g, '');
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new Error(`simplefin amount malformed: "${amount}"`);
  const [, sign, whole, frac = ''] = m;
  const padded = (frac + '000').slice(0, 3); // 2 cent digits + 1 for rounding
  let value = parseInt(whole, 10) * 100 + parseInt(padded.slice(0, 2), 10);
  if (Number(padded[2]) >= 5) value += 1; // round half up on the 3rd decimal
  return cents((sign === '-' ? -value : value) || 0); // collapse -0
}

/**
 * Unix seconds → the UTC calendar date, via PURE civil-date math (no Date object). The epoch is
 * a UTC instant, so this returns the date it falls on IN UTC. SimpleFIN carries no per-account
 * timezone (#127-tail), so a feed that stamps `posted` mid-day in a non-UTC zone can land ±1
 * calendar day from the holder's LOCAL date (a US-evening post is already the next UTC day). This
 * is a deliberate, neutral convention: no timezone data exists to resolve it, and any fixed
 * offset would only move the error to a different region. The app treats every business date as a
 * calendar date with no tz, so this is internally consistent (net-worth/spending never depend on
 * the exact posting day, only its month). Pinned in tests/unit/simplefin.test.ts.
 */
export function simplefinPostedToDate(posted: number): ISODate {
  if (!Number.isFinite(posted)) throw new Error(`simplefinPostedToDate: non-finite ${posted}`);
  return fromEpochDays(Math.floor(posted / 86400));
}

/**
 * Best-effort account type from the account/org name. SimpleFIN has no standard
 * `type` field, so we infer from keywords and default to CHECKING. DOCUMENTED
 * LIMITATION: a card with an ambiguous name could land as an asset (inverting its
 * net-worth sign), so synced account types are worth a sanity check.
 */
export function inferAccountType(name: string): PulseAccountType {
  const n = name.toLowerCase();
  // Explicit NON-CARD liabilities FIRST (audit #126-followup): a HELOC / line of credit /
  // student-loan servicer is a liability, but "line of credit" contains "credit" and a
  // servicer name has no "loan" keyword — so without this they'd be mis-typed CREDIT or, worse,
  // default to a CHECKING asset (inverting net-worth sign when the balance is reported positive).
  if (/\b(heloc|home ?equity|line of credit|mohela|nelnet|navient|sallie ?mae|great lakes|aidvantage)\b/.test(n)) {
    return 'LOAN';
  }
  if (/\b(credit|card|visa|mastercard|amex|discover)\b/.test(n)) return 'CREDIT';
  // Common credit-card PRODUCT lines, matched as substrings so a zero-balance card
  // (no sign signal) whose name omits "card" still classifies — e.g. "QuicksilverOne",
  // "VentureOne", "Sapphire Reserve" (real-bank sync, DECISIONS #61), plus the no-keyword
  // cash-back/travel products a real sync surfaces (audit #126-followup). The "cash" variants
  // are tightly bounded so a deposit "Cash Management"/"Cash Reserve" account is NOT caught.
  if (
    /(quicksilver|venture|savor|spark|sapphire|skymiles|bonvoy|freedom|active cash|double cash|custom(ized)? cash|cash ?\+|cash plus|autograph|\bbilt\b|altitude)/.test(
      n,
    )
  ) {
    return 'CREDIT';
  }
  if (/\b(savings|save|money ?market|cd|certificate)\b/.test(n)) return 'SAVINGS';
  if (/\b(mortgage|loan|student|auto ?loan|personal loan|car loan)\b/.test(n)) return 'LOAN';
  // Investments incl. 529 plans + retirement plans (came through as CHECKING before).
  // \binvest\b deliberately does NOT match "Investor Checking" (no boundary), so a
  // Schwab/Fidelity investor *checking* account stays CHECKING.
  if (/\b(invest|brokerage|401k?|ira|roth|securities|portfolio|annuity|pension)\b/.test(n) || /\b529\b/.test(n) || /retirement/.test(n)) {
    return 'INVESTMENT';
  }
  // Brokerage INSTITUTION fallback (DECISIONS #63): a Schwab/Vanguard/Fidelity/etc.
  // account whose name is NOT explicitly a deposit/checking/savings account is a
  // brokerage → INVESTMENT, so its holdings (stock tickers, fund names) don't leak
  // into the spending register. Guarded against "...Investor Checking" so a real
  // brokerage CHECKING account stays CHECKING. Catches ambiguous names like
  // "Charles Schwab US Community Property".
  if (
    /\b(schwab|vanguard|fidelity|merrill|e-?trade|t\.? ?rowe|robinhood|betterment|wealthfront|edward jones|raymond james|morgan stanley|ameritrade|sofi invest|webull|m1 finance)\b/.test(n) &&
    !/\b(checking|chequing|savings|debit|deposit|money ?market|cash management)\b/.test(n)
  ) {
    return 'INVESTMENT';
  }
  return 'CHECKING';
}

export interface SimplefinTransaction {
  id: string;
  posted: number; // unix seconds; the spec allows 0 for a still-pending txn
  transacted_at?: number; // unix seconds: when it actually happened (fallback for posted:0)
  amount: string; // signed decimal string, negative = money out
  description?: string;
  payee?: string;
  memo?: string;
  pending?: boolean;
}

/**
 * A SimpleFIN investment holding (position) — present on brokerage/investment
 * accounts. All money-ish quantities are decimal STRINGS (like `amount`/`balance`).
 * `symbol` and several others are optional per the spec. UNVERIFIED against a live
 * server — see the file header. Mapped by simplefin-holdings.ts.
 */
export interface SimplefinHolding {
  id: string;
  created?: number; // unix seconds
  currency?: string; // ISO-4217 code or a non-ISO/crypto token; non-USD positions are withheld from USD totals — no FX (DECISIONS #156)
  cost_basis?: string; // total cost basis, signed decimal string
  description?: string; // human-readable security name
  market_value?: string; // total current market value, signed decimal string (authoritative)
  purchase_price?: string; // per-share purchase price (unused: not a CURRENT price)
  shares?: string; // share count, decimal string (may be fractional)
  symbol?: string; // ticker (optional in the spec)
}

export interface SimplefinAccount {
  id: string;
  name: string;
  currency?: string;
  balance: string; // signed decimal string
  org?: { name?: string; domain?: string };
  transactions?: SimplefinTransaction[];
  holdings?: SimplefinHolding[]; // present on investment accounts
}

export interface MappedSfAccount {
  providerRef: string;
  name: string;
  type: PulseAccountType;
  currentBalanceCents: number;
  /** Canonical currency code (e.g. 'USD'), or null when the feed omits it. Non-USD accounts
   *  are withheld from net worth at the read boundary (DECISIONS #135). */
  currency: string | null;
}

export function mapSimplefinAccount(acct: SimplefinAccount): MappedSfAccount {
  const orgName = acct.org?.name?.trim();
  const display = (orgName ? `${orgName} ${acct.name}` : acct.name).trim();
  const signedBalance = simplefinAmountToCents(acct.balance);
  let type = inferAccountType(`${acct.name} ${orgName ?? ''}`);
  // Net-worth-sign safety (Hostile Critic LEDGER-1): a name that matched NO type
  // keyword defaults to CHECKING (an asset). If such an ambiguous account carries a
  // NEGATIVE balance it's almost certainly something you OWE (a card/loan) — storing
  // a positive magnitude under an asset type would INVERT its net-worth sign. So
  // reclassify it as a liability unless the name explicitly says it's a deposit acct.
  if (type === 'CHECKING' && signedBalance < 0 && !/\b(check|chequing|debit|deposit|saving|money)/i.test(acct.name)) {
    type = 'CREDIT';
  }
  const isLiability = type === 'CREDIT' || type === 'LOAN';
  return {
    providerRef: acct.id,
    name: (display || acct.name || 'Account').slice(0, 80),
    type,
    // Engine-convention balance (audit #126-followup). SimpleFIN does NO sign normalization, so:
    //  - ASSET: store the SIGNED balance, so an OVERDRAWN deposit account stays negative and
    //    reduces net worth (the old Math.abs() inverted it into a positive asset).
    //  - LIABILITY: store the |amount owed|. SimpleFIN gives no liability sign convention — a card
    //    may report owed as negative, a loan as positive principal — so the magnitude is the robust
    //    owed value regardless of institution. `isLiabilityType ? −bal : +bal` then nets correctly.
    // KNOWN EDGE: a genuine credit balance (an OVERPAID card) is indistinguishable from
    // owed-reported-with-the-other-sign, so it's treated as a small owed amount (rare; documented).
    currentBalanceCents: cents(isLiability ? Math.abs(signedBalance) : signedBalance),
    // SimpleFIN account-level currency: a 3-letter ISO code or a non-ISO URL (crypto). The app
    // does no FX, so a non-USD account is withheld from net worth at the read boundary
    // (DECISIONS #135). Canonicalized here; null when the feed omits it (assumed USD).
    currency: canonicalizeCurrency(acct.currency),
  };
}

export interface IngestedSfTransaction {
  providerRef: string;
  accountId: string;
  date: ISODate;
  amountCents: number; // signed (Pulse convention)
  rawDescriptor: string;
  merchantCanonical: string;
  categoryId: string;
  confidenceBps: number;
  needsReview: boolean;
  isTransfer: boolean;
  status: 'PENDING' | 'POSTED';
}

/**
 * Map ONE SimpleFIN transaction into a categorized, persist-ready row — through
 * the same normalize → rules → categorize arm every ingest source uses
 * (DECISIONS #22), so a SimpleFIN charge is filed exactly like a Plaid or
 * demo-seeded one. Transfer PAIRING + recurring re-detection are batch steps the
 * caller runs after inserting all rows.
 */
export function prepareSimplefinTransaction(
  txn: SimplefinTransaction,
  accountId: string,
  today: ISODate,
  rules: readonly RuleLike[] = [],
  /** Per-user AUTO_FLAGGED boundary (threshold tuning, DECISIONS #190); undefined = global. */
  flaggedBps?: number,
): IngestedSfTransaction {
  const rawDescriptor = (txn.description || txn.payee || txn.memo || '').trim() || 'Unknown Merchant';
  const amountCents = simplefinAmountToCents(txn.amount);
  // `posted` is 0 for a still-pending txn (spec sentinel); fall back to
  // transacted_at, else the sync date — never 1970-01-01 (Hostile Critic LEDGER-3).
  const date =
    txn.posted > 0
      ? simplefinPostedToDate(txn.posted)
      : txn.transacted_at && txn.transacted_at > 0
        ? simplefinPostedToDate(txn.transacted_at)
        : today;
  const merchant = normalizeMerchant(rawDescriptor);
  const result = categorize({ rawDescriptor, amountCents, date, accountId }, rules, { flaggedBps });
  return {
    providerRef: txn.id,
    accountId,
    date,
    amountCents,
    rawDescriptor,
    merchantCanonical: merchant.canonical,
    categoryId: result.categoryId,
    confidenceBps: result.confidenceBps,
    needsReview: result.needsReview,
    isTransfer: result.source === 'transfer',
    status: txn.pending ? 'PENDING' : 'POSTED',
  };
}
