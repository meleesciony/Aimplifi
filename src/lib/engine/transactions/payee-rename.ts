/**
 * Household name for a payee, written from a transaction, without a rule.
 *
 * Identity is the joined Merchant.canonical, or the normalizer's canonical of
 * the bank text when there is no merchant. Overlay only: Merchant.canonical,
 * merchantId, and CategorizationRule stay put. Demo writes are fenced.
 */
export const MAX_PAYEE_NAME = 60;
export const MAX_PAYEE_KEY = 200;

export function payeeNameError(raw: string): string | undefined {
  const name = raw.trim();
  if (!name) return 'Give the payee a name.';
  if (name.length > MAX_PAYEE_NAME) {
    return `Keep the name under ${MAX_PAYEE_NAME} characters.`;
  }
  return undefined;
}
