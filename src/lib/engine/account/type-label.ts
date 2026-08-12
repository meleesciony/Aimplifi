/**
 * The one human vocabulary for account types. Extracted from accounts-list.tsx
 * (the mortgage dead-end slice, owner 2026-08-11) the moment a SECOND surface
 * needed it: the register's 'account-not-here' empty state says "「name」 is a
 * mortgage account", and that word must be the same one /accounts prints under
 * the row the reader just clicked — two copies of this map is how the two
 * pages start calling one account two things.
 */
export const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  CHECKING: 'Checking',
  SAVINGS: 'Savings',
  CREDIT: 'Credit card',
  INVESTMENT: 'Investment',
  LOAN: 'Loan',
  REAL_ESTATE: 'Real estate',
  VEHICLE: 'Vehicle',
  CASH: 'Cash',
  OTHER_ASSET: 'Other asset',
  MORTGAGE: 'Mortgage',
  OTHER_LIABILITY: 'Other debt',
};

/** Total over unknown strings — a type this map has never heard of renders as
 *  itself rather than as undefined. */
export function accountTypeLabel(t: string): string {
  return ACCOUNT_TYPE_LABEL[t] ?? t;
}
