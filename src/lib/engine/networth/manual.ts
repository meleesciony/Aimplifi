/**
 * Manual net-worth items (DECISIONS #39). Lets a user add assets and liabilities
 * a bank feed can't see — a home, a car, other property, a mortgage, other debt —
 * so net worth is complete (Mint-style) alongside linked accounts (including the
 * brokerage balance). Pure: validation + the allowed type catalog. No I/O.
 *
 * Stored as Account rows (provider 'manual'); balances are POSITIVE magnitudes,
 * and the account `type` decides asset vs liability (engine/transactions/query
 * `isLiabilityType`), exactly like linked accounts.
 */
import { centsFromDollarString } from '@/lib/money';

export interface ManualType {
  id: string;
  label: string;
}

export const MANUAL_ASSET_TYPES: ManualType[] = [
  // Bank-type accounts first — these can hold imported/manual transactions, and
  // a manual checking/savings can be the cash-needed payment account.
  { id: 'CHECKING', label: 'Checking' },
  { id: 'SAVINGS', label: 'Savings' },
  { id: 'INVESTMENT', label: 'Investment / brokerage' },
  // Net-worth-only items (no transactions).
  { id: 'REAL_ESTATE', label: 'Real estate / home' },
  { id: 'VEHICLE', label: 'Vehicle' },
  { id: 'CASH', label: 'Cash' },
  { id: 'OTHER_ASSET', label: 'Other asset' },
];

export const MANUAL_LIABILITY_TYPES: ManualType[] = [
  { id: 'CREDIT', label: 'Credit card' },
  { id: 'LOAN', label: 'Loan' },
  { id: 'MORTGAGE', label: 'Mortgage' },
  { id: 'OTHER_LIABILITY', label: 'Other debt' },
];

const ASSET_IDS = new Set(MANUAL_ASSET_TYPES.map((t) => t.id));
const LIABILITY_IDS = new Set(MANUAL_LIABILITY_TYPES.map((t) => t.id));
const MAX_VALUE_CENTS = 1_000_000_000_00; // $1B sanity ceiling

/** True if `type` is one a user may create manually (asset or liability). */
export function isManualType(type: string): boolean {
  return ASSET_IDS.has(type) || LIABILITY_IDS.has(type);
}

/** Parse a dollar string to positive cents for a manual balance, or an error. */
export function parseManualValueCents(value: string): { ok: true; cents: number } | { ok: false; error: string } {
  let c: number;
  try {
    c = centsFromDollarString(value.trim());
  } catch {
    return { ok: false, error: 'Enter an amount in dollars, e.g. 250000 or 250000.00.' };
  }
  if (c <= 0) return { ok: false, error: 'Amount must be greater than $0.' };
  if (c > MAX_VALUE_CENTS) return { ok: false, error: 'Amount is too large.' };
  return { ok: true, cents: c };
}

export interface ParsedManualAccount {
  name: string;
  type: string;
  currentBalanceCents: number;
}

/** Validate a new manual asset/liability. All fields checked at once. */
export function parseManualAccount(input: {
  name: string;
  type: string;
  value: string;
}): { ok: true; account: ParsedManualAccount } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const name = input.name.trim();
  if (!name) errors.push('Give it a name.');
  if (name.length > 60) errors.push('Name must be 60 characters or fewer.');
  if (!isManualType(input.type)) errors.push('Pick a valid asset or liability type.');
  const v = parseManualValueCents(input.value);
  if (!v.ok) errors.push(v.error);
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, account: { name, type: input.type, currentBalanceCents: (v as { ok: true; cents: number }).cents } };
}
