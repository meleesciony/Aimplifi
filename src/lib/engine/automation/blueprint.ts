/**
 * Automation Blueprint (P0.5, DECISIONS #94) — turns the user's detected
 * paycheck cadence, goal contributions, and card due dates into an ordered,
 * copy-pasteable list of standing instructions to set up ONCE at their own
 * bank. Sethi/Babylon "automate everything", honored within Aimplifi's hard
 * invariant: Aimplifi never moves money (src/lib/engine/reminders/select.ts) —
 * this only tells the user what to set up. Ordering encodes "pay yourself
 * first": savings before card payments.
 *
 * Pure: structured data in, structured steps out. No I/O, no `new Date()`, no
 * money rounding (amounts pass through untouched). The COPY that phrases each
 * step lives in COACH_COPY (guardrail-scanned), not here.
 */
export type PayCadence = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | null;

export interface BlueprintInput {
  /** The detected paycheck, if any — used only to phrase timing ("on payday"). */
  paycheck: { cadence: PayCadence; amountCents: number } | null;
  /** Goal monthly contributions (pay-yourself-first). Only positive amounts are used. */
  savings: { name: string; monthlyCents: number }[];
  /** Cards with cash due this cycle (from the Cash-Needed engine). */
  cards: { cardName: string; dueDate: string; cashRequiredCents: number }[];
}

export interface BlueprintStep {
  order: number;
  kind: 'savings' | 'card';
  amountCents: number;
  /** Goal name (savings step) or card name (card step). */
  name: string;
  /** True when a paycheck cadence is known, so timing can read "on payday". */
  onPayday: boolean;
  /** ISO due date for card steps; null for savings steps. */
  dueDate: string | null;
}

/**
 * Build the ordered blueprint. Savings come first (pay yourself first), largest
 * contribution first; then cards needing cash, soonest due first. Zero/negative
 * contributions and cards with no cash due are dropped (nothing to automate).
 */
export function buildAutomationBlueprint(input: BlueprintInput): BlueprintStep[] {
  const steps: BlueprintStep[] = [];
  let order = 1;
  const onPayday = input.paycheck?.cadence != null;

  const savings = input.savings
    .filter((s) => s.monthlyCents > 0)
    .sort((a, b) => b.monthlyCents - a.monthlyCents);
  for (const g of savings) {
    steps.push({ order: order++, kind: 'savings', amountCents: g.monthlyCents, name: g.name, onPayday, dueDate: null });
  }

  const cards = input.cards
    .filter((c) => c.cashRequiredCents > 0)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  for (const c of cards) {
    steps.push({ order: order++, kind: 'card', amountCents: c.cashRequiredCents, name: c.cardName, onPayday, dueDate: c.dueDate });
  }

  return steps;
}
