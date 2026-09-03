/**
 * Household correction of a transaction's dollars.
 *
 * The write is the row's amountCents (integer cents). Sign stays with the
 * existing row so an outflow stays an outflow. Splits are refused: the
 * parts carry the money.
 */
export const MAX_TXN_ABS_CENTS = 2_147_483_647;

export function txnAmountError(parsed: number | null): string | undefined {
  if (parsed === null || parsed === 0) {
    return 'Enter an amount above $0 — like 12.50 or $12.50.';
  }
  if (Math.abs(parsed) > MAX_TXN_ABS_CENTS) {
    return 'That amount is too large.';
  }
  return undefined;
}

/** Magnitude from what they typed; sign from the existing row. */
export function signedTxnAmountCents(currentCents: number, parsed: number): number {
  const magnitude = Math.abs(parsed);
  if (currentCents === 0) return parsed;
  return currentCents < 0 ? -magnitude : magnitude;
}

/** Negate the signed cents. Null when there is nothing to flip. */
export function flippedTxnAmountCents(currentCents: number): number | null {
  if (currentCents === 0) return null;
  if (currentCents === -MAX_TXN_ABS_CENTS - 1) return null;
  return -currentCents;
}
