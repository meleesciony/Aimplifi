/**
 * Household correction of the bank text a rule matches.
 *
 * The write is the row's rawDescriptor. Amount, date, payee overlay,
 * merchantId, and category stay put.
 */
export const MAX_TXN_DESCRIPTOR = 200;

export function txnDescriptorError(raw: string): string | undefined {
  const text = raw.trim();
  if (!text) return 'Enter the words the bank sent.';
  if (text.length > MAX_TXN_DESCRIPTOR) {
    return `Keep the bank text under ${MAX_TXN_DESCRIPTOR} characters.`;
  }
  return undefined;
}
