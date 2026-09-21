/**
 * Closed-fold label for Coach "This month" rest (#770).
 * Names only the claims that render inside the disclosure. Creep, room for
 * error, hours, and the monthly review always render. The automation
 * blueprint, life energy by category, and the receipts tally do not.
 */
export function monthRestSummary(present: {
  automation: boolean;
  fulfillment: boolean;
  receipts: boolean;
}): string {
  const named = [
    'Lifestyle creep',
    'room for error',
    present.automation ? 'the automation blueprint' : null,
    'hours',
    present.fulfillment ? 'life energy by category' : null,
    present.receipts ? 'what Aimplifi caught' : null,
  ].filter((part): part is string => part != null);
  return `${named.join(', ')}, and the monthly review`;
}
