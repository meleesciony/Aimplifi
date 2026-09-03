/**
 * Household correction of which account a transaction sits on.
 *
 * The write is the row's accountId. Amount, date, payee, and descriptor stay
 * put. Splits stay on one account. Balances stay provider-authoritative.
 */
export function txnAccountError(raw: string): string | undefined {
  if (!raw.trim()) return 'Pick an account.';
  return undefined;
}
