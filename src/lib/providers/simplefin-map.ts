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
 * we do NOT flip the sign. Balances are signed too; we store the POSITIVE magnitude
 * and let the account `type` decide asset-vs-liability (a card's balance is owed).
 *
 * UNVERIFIED: the SimpleFIN protocol here is implemented from documentation as of
 * the Jan-2026 knowledge cutoff. Confirm the exact field names/shapes against the
 * current SimpleFIN spec before trusting the live path (docs/SIMPLEFIN_WALKTHROUGH.md).
 */
import { type ISODate, fromEpochDays } from '@/lib/dates';
import { type Cents, cents } from '@/lib/money';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { type RuleLike, categorize } from '@/lib/engine/categorize/pipeline';

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

/** Signed balance string → POSITIVE magnitude cents (account `type` decides net-worth sign). */
export function simplefinBalanceToPositiveCents(balance: string): Cents {
  return cents(Math.abs(simplefinAmountToCents(balance)));
}

/** Unix seconds → calendar date via PURE civil-date math (no Date object, no timezone drift). */
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
  if (/\b(credit|card|visa|mastercard|amex|discover)\b/.test(n)) return 'CREDIT';
  // Common credit-card PRODUCT lines, matched as substrings so a zero-balance card
  // (no sign signal) whose name omits "card" still classifies — e.g. "QuicksilverOne",
  // "VentureOne", "Sapphire Reserve" (real-bank sync, DECISIONS #61).
  if (/(quicksilver|venture|savor|spark|sapphire|skymiles|bonvoy|freedom)/.test(n)) return 'CREDIT';
  if (/\b(savings|save|money ?market|cd|certificate)\b/.test(n)) return 'SAVINGS';
  if (/\b(mortgage|loan|student)\b/.test(n)) return 'LOAN';
  // Investments incl. 529 plans + retirement plans (came through as CHECKING before).
  // \binvest\b deliberately does NOT match "Investor Checking" (no boundary), so a
  // Schwab/Fidelity investor *checking* account stays CHECKING.
  if (/\b(invest|brokerage|401k?|ira|roth|securities|portfolio|annuity|pension)\b/.test(n) || /\b529\b/.test(n) || /retirement/.test(n)) {
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

export interface SimplefinAccount {
  id: string;
  name: string;
  currency?: string;
  balance: string; // signed decimal string
  org?: { name?: string; domain?: string };
  transactions?: SimplefinTransaction[];
}

export interface MappedSfAccount {
  providerRef: string;
  name: string;
  type: PulseAccountType;
  currentBalanceCents: number;
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
  return {
    providerRef: acct.id,
    name: (display || acct.name || 'Account').slice(0, 80),
    type,
    currentBalanceCents: cents(Math.abs(signedBalance)),
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
  const result = categorize({ rawDescriptor, amountCents, date, accountId }, rules);
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
