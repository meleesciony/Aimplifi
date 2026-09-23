/**
 * Closed-fold label for Coach "This month" rest (#770, #771).
 * Names only the claims that render inside the disclosure. Creep, room for
 * error, the life-energy view, and the monthly review always render. The
 * automation blueprint, life energy by category, and the receipts tally do not.
 *
 * The three optional cards and this label share one predicate each, so a
 * summary cannot name a card the page did not render.
 */

/** Same check `AutomationBlueprintCard` uses before it returns null. */
export function showsAutomationBlueprint(steps: readonly unknown[]): boolean {
  return steps.length > 0;
}

/** Same check `FulfillmentCard` uses before it returns null. Narrows so the card can read the curve. */
export function showsFulfillment<T>(curve: T | null | undefined): curve is T {
  return curve != null;
}

/** Same check the value-receipts card uses before it renders. */
export function showsValueReceipts(total: number): boolean {
  return total > 0;
}

export function monthRestSummary(present: {
  automation: boolean;
  fulfillment: boolean;
  receipts: boolean;
}): string {
  const named = [
    'Lifestyle creep',
    'room for error',
    present.automation ? 'the automation blueprint' : null,
    'life-energy view',
    present.fulfillment ? 'life energy by category' : null,
    present.receipts ? 'what Aimplifi caught' : null,
  ].filter((part): part is string => part != null);
  return `${named.join(', ')}, and the monthly review`;
}
