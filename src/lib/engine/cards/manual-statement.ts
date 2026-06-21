/**
 * Manual card statements (extends DECISIONS #45). A manual CREDIT card has no
 * statement, so the Cash-Needed Engine drops it from "how much do I need & when"
 * (engine.ts: no statement AND no cycle days → buildObligation returns null) — it
 * only counts toward net worth. This lets the user enter the card's current
 * statement (balance, minimum, close + due dates), optional APR, and optional
 * autopay, so the card runs the PRECISE cash-needed path exactly like a linked
 * card's generated statement.
 *
 * Pure: validation + parse + derivation only. No I/O. The server action
 * (card-actions.ts) persists the result as a Statement row (+ Account billing
 * fields + AutopayConfig), all of which the existing engine already consumes.
 *
 * Money is integer cents; APR is basis points (24.99% → 2499 bps). Dates are
 * YYYY-MM-DD, validated via dates.ts. All problems are reported at once (the
 * codebase idiom — see settings/dials.ts and networth/manual.ts).
 */
import { centsFromDollarString } from '@/lib/money';
import { addMonthsClamped, compareDates, isoDate } from '@/lib/dates';

export type ManualAutopayMode = 'NONE' | 'STATEMENT_BALANCE' | 'MINIMUM' | 'FIXED_AMOUNT';

const AUTOPAY_MODES: ReadonlySet<string> = new Set([
  'NONE',
  'STATEMENT_BALANCE',
  'MINIMUM',
  'FIXED_AMOUNT',
]);

const MAX_AMOUNT_CENTS = 1_000_000_000_00; // $1B sanity ceiling (matches networth/manual.ts)
const MAX_APR_BPS = 100_00; // 100% APR ceiling — well above any real card

export interface ParsedManualStatement {
  statementBalanceCents: number;
  minimumPaymentCents: number;
  /** Derived: one month before the close date (Statement.cycleStart is required). */
  cycleStart: string; // YYYY-MM-DD
  cycleEnd: string; // YYYY-MM-DD (statement close)
  dueDate: string; // YYYY-MM-DD
  /** null when the user didn't supply an APR (engine treats missing APR as 0 interest). */
  aprBps: number | null;
  /** Derived day-of-month so the card still estimates the NEXT cycle once this one is paid. */
  cycleCloseDayOfMonth: number;
  dueDayOfMonth: number;
  /** null = no autopay; otherwise the configured mode (fixedAmountCents only for FIXED_AMOUNT). */
  autopay: { mode: Exclude<ManualAutopayMode, 'NONE'>; fixedAmountCents: number | null } | null;
}

export interface ManualStatementInput {
  statementBalance: string;
  minimumPayment: string;
  cycleEnd: string; // statement closing date
  dueDate: string;
  /** Optional APR as a percentage string, e.g. "24.99". Empty/absent → no APR. */
  apr?: string;
  /** Optional. Defaults to NONE. */
  autopayMode?: string;
  /** Required only when autopayMode === 'FIXED_AMOUNT'. */
  autopayFixedAmount?: string;
}

/** Parse a non-negative dollar string to cents (≥ 0, ≤ ceiling), or fail. */
function parseNonNegCents(s: string): { ok: true; cents: number } | { ok: false } {
  let c: number;
  try {
    c = centsFromDollarString(s.trim());
  } catch {
    return { ok: false };
  }
  if (c < 0 || c > MAX_AMOUNT_CENTS) return { ok: false };
  return { ok: true, cents: c };
}

/** Validate a string as a real calendar date; returns the date or null. */
function parseDate(s: string): string | null {
  try {
    return isoDate(s.trim());
  } catch {
    return null;
  }
}

/**
 * Validate + parse a manual card statement. Reports every problem at once so the
 * form can show them together. On success, returns the persisted shape plus the
 * derived cycleStart and day-of-month billing fields.
 */
export function parseManualStatement(
  input: ManualStatementInput,
): { ok: true; statement: ParsedManualStatement } | { ok: false; errors: string[] } {
  const errors: string[] = [];

  const bal = parseNonNegCents(input.statementBalance ?? '');
  if (!bal.ok) errors.push('Enter the statement balance, e.g. 1200 or 1200.00.');

  const min = parseNonNegCents(input.minimumPayment ?? '');
  if (!min.ok) errors.push('Enter the minimum payment, e.g. 35 or 35.00.');
  if (bal.ok && min.ok && min.cents > bal.cents) {
    errors.push('Minimum payment can’t exceed the statement balance.');
  }

  const cycleEnd = parseDate(input.cycleEnd ?? '');
  if (!cycleEnd) errors.push('Enter the statement closing date (YYYY-MM-DD).');

  const dueDate = parseDate(input.dueDate ?? '');
  if (!dueDate) errors.push('Enter the payment due date (YYYY-MM-DD).');
  if (cycleEnd && dueDate && compareDates(isoDate(dueDate), isoDate(cycleEnd)) <= 0) {
    errors.push('The due date must be after the statement closing date.');
  }

  // APR is optional. Empty string / undefined → no APR (null).
  let aprBps: number | null = null;
  const aprRaw = (input.apr ?? '').trim();
  if (aprRaw !== '') {
    let parsed: number | null = null;
    try {
      parsed = centsFromDollarString(aprRaw); // "24.99" → 2499 bps
    } catch {
      parsed = null;
    }
    if (parsed === null || parsed < 0 || parsed > MAX_APR_BPS) {
      errors.push('Enter the APR as a percentage, e.g. 24.99 (or leave it blank).');
    } else {
      aprBps = parsed;
    }
  }

  // Autopay is optional. Defaults to NONE.
  const modeRaw = (input.autopayMode ?? 'NONE').trim() || 'NONE';
  let autopay: ParsedManualStatement['autopay'] = null;
  if (!AUTOPAY_MODES.has(modeRaw)) {
    errors.push('Pick a valid autopay option.');
  } else if (modeRaw !== 'NONE') {
    if (modeRaw === 'FIXED_AMOUNT') {
      const fixed = parseNonNegCents(input.autopayFixedAmount ?? '');
      if (!fixed.ok || fixed.cents <= 0) {
        errors.push('Enter the fixed autopay amount, e.g. 100.');
      } else {
        autopay = { mode: 'FIXED_AMOUNT', fixedAmountCents: fixed.cents };
      }
    } else {
      autopay = { mode: modeRaw as 'STATEMENT_BALANCE' | 'MINIMUM', fixedAmountCents: null };
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  // All valid past here — the casts are guarded by the checks above.
  const end = cycleEnd as string;
  const due = dueDate as string;
  return {
    ok: true,
    statement: {
      statementBalanceCents: (bal as { ok: true; cents: number }).cents,
      minimumPaymentCents: (min as { ok: true; cents: number }).cents,
      cycleStart: addMonthsClamped(isoDate(end), -1),
      cycleEnd: end,
      dueDate: due,
      aprBps,
      cycleCloseDayOfMonth: +end.slice(8, 10),
      dueDayOfMonth: +due.slice(8, 10),
      autopay,
    },
  };
}
