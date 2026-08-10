/**
 * O.18c — the copy contract of the expandable "what did the detector see" panel
 * on each /recurring row.
 *
 * Composed HERE, in the engine, not in the component — the same lesson as
 * `categoryPanelBasis` (glass-box): the panel's first sentence embeds the row's
 * RENDERED figure, and a rule that lives in a .tsx cannot be locked (this repo
 * has no component-rendering harness). The component passes the exact string
 * the row paints, so the sentence can never describe a different amount than
 * the figure above it; the unit tests lock the sentences; the e2e locks the
 * wiring.
 *
 * The panel exists because a row that says "you pay Netflix $17.99/mo" is a
 * claim the reader may want to see the evidence for (the owner's every-table-
 * expandable ask, Wave O.18 — "what exactly is the system classifying as a
 * bill"). The disclosure the row owes is the INVERSE of the glass-box "these
 * rows add up to this figure" claim: the figure above is the typical (most
 * recent) charge, NOT the total of the listed charges. No total is shown, on
 * purpose — a cumulative sum of N months of charges invites the wrong reading
 * ("$1,400 of Netflix?!") and the row's figure is a rate, not a sum.
 */
import type { Cadence } from './detect';

/** How a series' cadence reads in a sentence — the plain English of the row's
 *  `/wk`, `/mo`… suffix. */
const CADENCE_WORD: Record<Cadence, string> = {
  WEEKLY: 'weekly',
  BIWEEKLY: 'biweekly',
  MONTHLY: 'monthly',
  QUARTERLY: 'quarterly',
  SEMIANNUAL: 'semiannual',
  ANNUAL: 'yearly',
  IRREGULAR: 'irregular',
};

export type PanelNoun = 'charge' | 'deposit';

function plural(count: number, noun: PanelNoun): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * The contract sentence: the figure above is the typical (most recent) charge,
 * not the total of the rows below. `typicalRendered` is the ROW's own rendered
 * figure, passed in — never formatted again here — so the sentence and the
 * row cannot disagree.
 */
export function typicalNotTotalSentence(typicalRendered: string, count: number, noun: PanelNoun): string {
  const latest = noun === 'deposit' ? "this payee's most recent deposit" : "this payee's most recent charge";
  if (count === 1) {
    // One row IS the total: the "not the total" clause would be a literal
    // falsehood next to the single row it describes (reachable — a declared
    // series may carry one charge, the critic's F1). Say what the row proves.
    return `The ${typicalRendered} above is ${latest} — the only ${noun} in the series.`;
  }
  return `The ${typicalRendered} above is ${latest} — the typical amount, not the total of ${plural(count, noun)} in the series.`;
}

/** Detected: the app read a rhythm off the reader's own charges. */
export function detectedRhythmSentence(cadence: Cadence, count: number, noun: PanelNoun): string {
  return `Detected a ${CADENCE_WORD[cadence]} rhythm in these ${plural(count, noun)}.`;
}

/**
 * Declared (O.13f): the rhythm is the READER's, never claimed as observed —
 * a declaration exists precisely where the evidence did not earn one.
 */
export function declaredRhythmSentence(isIncome: boolean): string {
  return isIncome
    ? 'You marked this as recurring income — the rhythm is yours, not detected from your history.'
    : 'You marked this as a bill — the rhythm is yours, not detected from your history.';
}

/**
 * The two-plateau evidence, when the detector saw a price change. Income gets
 * "amount" (a raise is not a price change), never "price" — the same
 * favorable/adverse distinction the price-change badge makes.
 *
 * The date claim is the DETECTOR's, not a change date: `priceChangedAt` is the
 * date of the FIRST charge at the new price — the change itself happened some
 * time between the last old-price charge and that row. So the sentence says
 * "first charged/deposited at the new … on D", never "changed on D" (the
 * price-change badge precedent: no time claim the detector doesn't record).
 */
export function priceChangeSentence(
  fromRendered: string,
  toRendered: string,
  changedAtRendered: string,
  isIncome: boolean,
): string {
  const kind = isIncome ? 'amount' : 'price';
  const noun = isIncome ? 'deposit' : 'charge';
  return `The ${kind} changed from ${fromRendered} to ${toRendered} — the first ${noun} at the new ${kind} was ${changedAtRendered}.`;
}

/** How long the evidence spans — answers "since when?". "Seen", not "started":
 *  the first row is the earliest charge the app has, not a first-ever claim. */
export function spanSentence(firstSeenRendered: string, lastSeenRendered: string): string {
  return `First seen ${firstSeenRendered} · last seen ${lastSeenRendered}.`;
}

/**
 * The panel's full copy, composed once so a surface cannot forget a disclosure
 * (L.30): the typical-not-total sentence is always first, and the rhythm
 * sentence is always present — detected or declared, never neither. The
 * price-change sentence appears only when the detector recorded one (never for
 * a declared series, which carries no plateau claim by construction).
 */
export function recurringPanelSentences(input: {
  cadence: Cadence;
  isIncome: boolean;
  declaredByUser: boolean;
  count: number;
  typicalRendered: string;
  priceChange: { fromRendered: string; toRendered: string; changedAtRendered: string } | null;
  span: { firstSeenRendered: string; lastSeenRendered: string };
}): [string, ...string[]] {
  const noun: PanelNoun = input.isIncome ? 'deposit' : 'charge';
  const out = [
    typicalNotTotalSentence(input.typicalRendered, input.count, noun),
    input.declaredByUser
      ? declaredRhythmSentence(input.isIncome)
      : detectedRhythmSentence(input.cadence, input.count, noun),
  ];
  if (input.priceChange) {
    out.push(
      priceChangeSentence(
        input.priceChange.fromRendered,
        input.priceChange.toRendered,
        input.priceChange.changedAtRendered,
        input.isIncome,
      ),
    );
  }
  out.push(spanSentence(input.span.firstSeenRendered, input.span.lastSeenRendered));
  // The first two elements are pushed unconditionally, so the tuple is never
  // empty at runtime — the non-empty shape is what forces the component to
  // print at least the contract sentence (the `basis` lesson).
  return [out[0], out[1], ...out.slice(2)];
}
