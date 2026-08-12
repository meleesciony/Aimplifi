/**
 * Tax-year export engine (owner request 2026-07-27: *"so easy to export that data
 * during tax time"*).
 *
 * Pure: rows in, grouped rows and integer-cent totals out. No I/O, no `new Date()`,
 * no floats. The reader's own tags decide membership; this only adds them up.
 *
 * THE FOUR MONEY DECISIONS, because each one is a claim the export makes:
 *
 * 1. A REFUND SUBTRACTS FROM ITS CLASS. Amounts here are the app's signed cents
 *    (outflow negative, inflow positive), and a reimbursed prescription or a
 *    returned textbook is a positive row. Summing magnitudes would report money
 *    the reader did not spend — the overstating direction, and the dangerous one
 *    for a figure that may reach a return. So each class total is the NET paid:
 *    outflows minus anything that came back. A class can therefore legitimately
 *    total zero or below, and `netCents` is reported signed rather than clamped,
 *    because clamping would hide exactly the case worth seeing.
 *
 * 2. POSTED ONLY. A pending charge has not been paid, and a tax year is a
 *    statement about money that actually moved. Pending rows are counted out and
 *    the count is REPORTED (`excludedPending`), never silently dropped: a reader
 *    tagging in early January needs to know a charge is missing rather than
 *    wonder why a total is short.
 *
 * 3. TRANSFERS ARE NOT PAYMENTS. A move between the reader's own accounts pays
 *    nobody, so a tagged transfer is excluded and counted (`excludedTransfers`).
 *    Paying a credit card is the commonest example: the deductible charge is the
 *    purchase on the card, and counting the card payment too would double it.
 *
 * 4. A SPLIT PARENT IS A CONTAINER, NOT A CHARGE. When a reader splits a $300
 *    pharmacy charge into $200 medical and $100 household, the app keeps the
 *    original row as an `isSplitParent` container and the children carry the real
 *    amounts. Counting the parent as well would report the money twice — the same
 *    rule the register and the cash-needed assembler already enforce. Excluded and
 *    counted (`excludedSplitParents`), never silently dropped. (Added when the
 *    persistence half of this slice landed: the register hides split parents, so
 *    nothing tagged one by hand, but the export reads the whole table and a row
 *    tagged BEFORE it was split would otherwise have double-counted in silence.)
 *
 * 5. THE YEAR IS THE TRANSACTION DATE, inclusive of both ends, on the calendar
 *    date the app already stores (YYYY-MM-DD strings, no timezones — the
 *    `driver-parsed-timestamp` lesson). No settlement-date reasoning: the app has
 *    one business date per row and inventing a second would be a fabrication.
 *
 * WHAT IT REFUSES TO DO. It computes no deduction, applies no threshold or limit,
 * and produces no "you can claim" figure. `disclosures` carries the sentences that
 * say so, and they are part of the return value rather than the caller's job,
 * because a total that travels without them reads as an entitlement.
 */
import { type TaxClass, TAX_CLASSES, TAX_CLASS_LABELS, isTaxClass } from './classes';

/** One transaction as this engine consumes it — the fields an export needs and
 *  nothing else, so no caller can hand it a row shape that hides a status. */
export interface TaxExportRow {
  /** Calendar date, YYYY-MM-DD. */
  date: string;
  /** What the reader sees in the register (merchant name or cleaned descriptor). */
  description: string;
  /** SIGNED cents: outflow negative, inflow positive. */
  amountCents: number;
  /** 'POSTED' | 'PENDING' — see decision 2. */
  status: string;
  /** True for a move between the reader's own accounts — see decision 3. */
  isTransfer: boolean;
  /** True for the container row left behind by a split — see decision 4. REQUIRED,
   *  not optional with a `false` default: a caller that does not know whether its
   *  rows can contain split parents has to go and find out, and a default would let
   *  the one caller that reads the raw table double-count in silence. */
  isSplitParent: boolean;
  /** The reader's tag. Anything unrecognized reads as untagged (`isTaxClass`). */
  taxClass: string | null;
  /** The reader's own note, carried VERBATIM. Never parsed, never summed. */
  note: string | null;
}

export interface TaxExportLine {
  date: string;
  description: string;
  /** Signed, exactly as stored — the sign is what makes a refund legible. */
  amountCents: number;
  note: string | null;
}

export interface TaxExportGroup {
  taxClass: TaxClass;
  label: string;
  lines: TaxExportLine[];
  /** Net paid: outflows minus refunds, signed. Reported as a POSITIVE number for
   *  ordinary spending, because `paidCents` is the magnitude of money that left. */
  paidCents: number;
  /** What came back inside this class (magnitude, 0 when nothing did). Printed
   *  beside `paidCents` so a netted total can never look like a raw one. */
  refundedCents: number;
}

export interface TaxExport {
  year: number;
  groups: TaxExportGroup[];
  /** Sum of every group's `paidCents`. NOT a deductible amount — see disclosures. */
  totalPaidCents: number;
  totalRefundedCents: number;
  /** Tagged rows the year excluded, by reason, so a short total is explainable. */
  excludedPending: number;
  excludedTransfers: number;
  excludedSplitParents: number;
  /** Sentences that must travel with the figures. */
  disclosures: string[];
}

/**
 * Group a reader's tagged transactions into a tax year's report.
 *
 * `rows` may be the reader's whole history: the year filter lives here so no
 * caller can pass an already-narrowed set and lose the excluded counts.
 */
/**
 * The handover days (U.13) — dates where two connections were changing over and BOTH sides'
 * rows are kept, so a charge both reported is counted twice.
 *
 * Passed in rather than inferred, because the only honest detector is the boundary's own
 * rule; guessing from the rows (two equal amounts on one date) cannot tell a real pair of
 * identical charges from a handover duplicate. Defaults to empty, which is the truth for
 * every reader with no combined accounts.
 *
 * This exists because every other sentence in the disclosure block explains why a total is
 * LOW — pending, transfers, split containers, untagged groups — and U.13 created the app's
 * first deliberate over-count. A block that enumerates five under-counts and stays silent
 * about the one over-count reads as a completeness claim, and this file's own ethic
 * ("counting both would report the money twice") is the reason that is not acceptable here:
 * the CSV leaves the app, carries no account column, and gets forwarded to a preparer.
 */
export function buildTaxExport(
  rows: readonly TaxExportRow[],
  year: number,
  handoverDates: ReadonlySet<string> = new Set<string>(),
): TaxExport {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;

  let countedOnHandoverDays = 0;
  let excludedPending = 0;
  let excludedTransfers = 0;
  let excludedSplitParents = 0;
  const byClass = new Map<TaxClass, TaxExportLine[]>();

  for (const r of rows) {
    if (!isTaxClass(r.taxClass)) continue;
    // Inclusive both ends, on plain string comparison — safe because every date
    // here is a zero-padded YYYY-MM-DD calendar date.
    if (r.date < from || r.date > to) continue;
    // Counted BEFORE the status/transfer gates so an excluded row is reported
    // rather than vanishing; a reader whose total looks short can see why.
    // Split parents first: a container is not a charge at all, so it is not a
    // transfer question or a pending question.
    if (r.isSplitParent) {
      excludedSplitParents += 1;
      continue;
    }
    if (r.isTransfer) {
      excludedTransfers += 1;
      continue;
    }
    if (r.status !== 'POSTED') {
      excludedPending += 1;
      continue;
    }
    // Counted AFTER every exclusion gate, so this reports rows that actually reached a
    // total — a pending or transfer row on a handover day is already not in the figure.
    if (handoverDates.has(r.date)) countedOnHandoverDays += 1;
    const lines = byClass.get(r.taxClass) ?? [];
    lines.push({ date: r.date, description: r.description, amountCents: r.amountCents, note: r.note });
    byClass.set(r.taxClass, lines);
  }

  const groups: TaxExportGroup[] = [];
  for (const taxClass of TAX_CLASSES) {
    const lines = byClass.get(taxClass);
    // A class the reader tagged nothing into gets NO group: an empty drawer is not
    // a fact about the year, and printing "$0.00" beside a class name would read
    // as "nothing qualified" when it means "you tagged nothing" (the L.29 rule,
    // and the reason this engine reports absence by omission plus a disclosure).
    if (!lines || lines.length === 0) continue;
    lines.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.description < b.description ? -1 : 1));
    let outflow = 0;
    let refunded = 0;
    for (const l of lines) {
      if (l.amountCents < 0) outflow += -l.amountCents;
      else refunded += l.amountCents;
    }
    groups.push({
      taxClass,
      label: TAX_CLASS_LABELS[taxClass],
      lines,
      paidCents: outflow - refunded,
      refundedCents: refunded,
    });
  }

  const totalPaidCents = groups.reduce((s, g) => s + g.paidCents, 0);
  const totalRefundedCents = groups.reduce((s, g) => s + g.refundedCents, 0);

  const disclosures: string[] = [
    'These totals are what you and your rules tagged, added up. Aimplifi does not decide what is deductible, applies no limits or thresholds, and this is not tax advice — check it against your own records before it goes near a return.',
  ];
  if (totalRefundedCents > 0) {
    disclosures.push(
      'Where money came back — a refund or a reimbursement — it is subtracted from its own group, so each total is what you actually paid out over the year rather than the sum of the charges.',
    );
  }
  if (excludedPending > 0) {
    disclosures.push(
      `${excludedPending} tagged ${excludedPending === 1 ? 'charge has' : 'charges have'} not posted yet, so ${excludedPending === 1 ? 'it is' : 'they are'} not counted here — money that has not moved is not part of a tax year.`,
    );
  }
  if (excludedTransfers > 0) {
    disclosures.push(
      `${excludedTransfers} tagged ${excludedTransfers === 1 ? 'row is a transfer' : 'rows are transfers'} between your own accounts and ${excludedTransfers === 1 ? 'is' : 'are'} not counted — a transfer pays nobody, and the charge it covers is already counted where it was made.`,
    );
  }
  if (excludedSplitParents > 0) {
    disclosures.push(
      `${excludedSplitParents} tagged ${excludedSplitParents === 1 ? 'row was split' : 'rows were split'} into parts, so the original ${excludedSplitParents === 1 ? 'is' : 'are'} not counted — the parts carry the amounts, and counting both would report the money twice. Tag the parts instead.`,
    );
  }
  if (countedOnHandoverDays > 0) {
    disclosures.push(
      `${countedOnHandoverDays} counted ${countedOnHandoverDays === 1 ? 'row falls' : 'rows fall'} on a day one of your combined accounts was changing connections. On that day every connection's records are kept, because neither can be shown to have covered the whole of it — so if more than one of them reported the same transaction, it is counted once for each here. This is the only sentence in this file about a total moving the WRONG way — too high when the repeats are purchases, too low when they are returns: check those ${countedOnHandoverDays === 1 ? 'date' : 'dates'} against your own records.`,
    );
  }
  if (groups.length < TAX_CLASSES.length) {
    disclosures.push(
      'Only the groups you tagged something into appear. A group missing here means nothing was tagged to it, not that nothing qualified.',
    );
  }

  return {
    year,
    groups,
    totalPaidCents,
    totalRefundedCents,
    excludedPending,
    excludedTransfers,
    excludedSplitParents,
    disclosures,
  };
}

/**
 * The years this reader can actually export, most recent first.
 *
 * Deliberately computed with the SAME predicate `buildTaxExport` counts by — tagged,
 * posted, not a transfer, not a split container — rather than "any row with a tag".
 * A year offered in a list must produce a report with something in it; offering 2024
 * and then handing back a page of disclosures and no groups is the empty-state
 * failure the L.29 rule exists to prevent, and here it would arrive as a downloaded
 * file the reader has to open to discover is blank.
 */
export function taxYearsWithTags(rows: readonly TaxExportRow[]): number[] {
  const years = new Set<number>();
  for (const r of rows) {
    if (!isTaxClass(r.taxClass)) continue;
    if (r.isSplitParent || r.isTransfer || r.status !== 'POSTED') continue;
    // Every date here is a validated YYYY-MM-DD calendar date, so the year is its
    // first four characters — no Date object, no timezone, no parse.
    const year = Number(r.date.slice(0, 4));
    if (Number.isInteger(year)) years.add(year);
  }
  return [...years].sort((a, b) => b - a);
}
