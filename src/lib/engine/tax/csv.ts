/**
 * The tax-year export, as the file the reader actually opens (owner request
 * 2026-07-27: *"so easy to export that data during tax time"*).
 *
 * Pure: a `TaxExport` in, one CSV string out. It computes NOTHING — every figure
 * here is copied from the engine that already decided it (`./export.ts`), because a
 * second place that adds money up is a second place that can disagree.
 *
 * SHAPE, and why it is three sections rather than one flat table. The reader's job
 * at tax time is "what did I pay for medical in 2025" — a per-class total — but the
 * preparer's job is "show me the charges behind that number". A flat table serves
 * only the second, and a totals-only file only the first. So:
 *
 *   1. A header block: the year, and the disclosures, one per row in column A.
 *   2. Every line, with its class on the row — a real table a spreadsheet can sort,
 *      filter and pivot without any of this file's structure getting in the way.
 *   3. The totals, per class and overall, in their own small table.
 *
 * THE DISCLOSURES GO FIRST, at the top of the file, not in a footer. This file will
 * be forwarded, printed, and pasted into somebody's return. The sentence saying
 * these are the reader's own tags added up — and not a deduction, an entitlement, or
 * advice — has to be the first thing on the page, not something a scroll can miss.
 */
import { csvAmount, csvDocument, csvField, csvRow } from '@/lib/csv';
import type { TaxExport } from './export';

/** The filename the download arrives as. One author, so the route header and any
 *  future surface offering the same file cannot name it two things. */
export function taxExportFilename(year: number): string {
  return `aimplifi-tax-${year}.csv`;
}

export function taxExportToCsv(x: TaxExport): string {
  const rows: string[] = [];

  // --- 1. Header + disclosures -------------------------------------------------
  rows.push(csvRow([csvField('Aimplifi tax-year export'), csvField(String(x.year))]));
  for (const d of x.disclosures) rows.push(csvRow([csvField(d)]));

  // --- 2. The lines ------------------------------------------------------------
  rows.push('');
  rows.push(csvRow(['tax_class', 'date', 'description', 'amount', 'note']));
  for (const g of x.groups) {
    for (const l of g.lines) {
      rows.push(
        csvRow([
          csvField(g.label),
          l.date,
          csvField(l.description),
          // Signed, exactly as the engine holds it: the minus sign is what makes a
          // refund legible in a column the reader is going to select and sum.
          csvAmount(l.amountCents),
          csvField(l.note ?? ''),
        ]),
      );
    }
  }
  // A year with tags but nothing that survived the gates (all pending, say) reaches
  // here with no lines at all. Say which zero it is rather than shipping a file whose
  // only content is a header row (L.29) — the disclosures above already carry the
  // reason, and this points at them.
  if (x.groups.length === 0) {
    rows.push(csvRow([csvField('Nothing to list for this year — see the notes at the top of this file.')]));
  }

  // --- 3. The totals -----------------------------------------------------------
  rows.push('');
  rows.push(csvRow(['tax_class', 'net_paid', 'refunded']));
  for (const g of x.groups) {
    rows.push(csvRow([csvField(g.label), csvAmount(g.paidCents), csvAmount(g.refundedCents)]));
  }
  // "All groups", never "Total deductible": this is the arithmetic sum of what the
  // reader tagged, and naming it after a tax outcome would be the one claim this
  // whole feature refuses to make. It also folds the business group in — which is
  // exactly why the per-class rows above are the numbers that matter, and why the
  // label says all GROUPS rather than anything resembling an itemized subtotal.
  rows.push(csvRow([csvField('All groups'), csvAmount(x.totalPaidCents), csvAmount(x.totalRefundedCents)]));

  return csvDocument(rows);
}
