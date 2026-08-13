/**
 * CSV + PDF export builders (Phase 4). Pure functions; route handlers add
 * auth + audit logging. Money is formatted at this boundary only.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import { csvField } from '@/lib/csv';
import { type Cents, cents, formatCents } from '@/lib/money';
import { frozenTotalNote } from '@/lib/engine/account/feed-dropped-view';
import { withheldExportNote, type WithheldAccountSummary } from '@/lib/providers/currency';
import { isLiabilityType } from '@/lib/engine/transactions/query';

export interface ExportTxn {
  date: string;
  account: string;
  rawDescriptor: string;
  merchant: string | null;
  category: string | null;
  amountCents: number;
  status: string;
  /**
   * Whether this row sits on a day the reconciliation boundary released to BOTH
   * sides of a combined pair (U.19), so a transaction both connections reported
   * is in this file twice.
   *
   * REQUIRED, not optional-defaulting-false. `server/reconciliation.ts` states
   * that the disclosure exists for "a surface that reports totals a reader will
   * act on — the tax export above all, whose file leaves the app entirely", and
   * this file leaves just as completely: a reader sums the amount column in a
   * spreadsheet and the app never sees the figure it produced. A default would
   * let the next export path ship the silence back in.
   */
  onHandoverDay: boolean;
}

/**
 * The trailing note (U.19), emitted only when the file actually contains
 * released rows — a reader with no combined accounts gets a byte-identical file
 * to the one this export has always produced, minus the new empty column.
 *
 * Deliberately NOT the tax export's shape. That file opens with prose rows above
 * a blank line and its own table header, which is right for a summary a preparer
 * reads top to bottom, and wrong here: this file's first line IS its header, and
 * the thing a reader does with it — sort, filter, pivot, sum a column — is
 * exactly what a leading prose block breaks.
 */
const HANDOVER_CSV_NOTE =
  'Note: rows marked yes in changeover_day fall on a day one of your combined accounts was ' +
  'changing connections. Both connections’ records are kept for that day, because neither can ' +
  'be shown to have covered the whole of it — so if more than one of them reported the same ' +
  'transaction, it appears once for each. Nothing has been adjusted: dropping either side’s ' +
  'records would lose transactions only one connection saw.';

/**
 * @param withheld The accounts the currency guard (#135) kept OUT of `rows`, scoped to this
 *   file's own basis. REQUIRED for the same reason `ExportTxn.onHandoverDay` is: this file
 *   leaves the app, a reader sums its amount column in a spreadsheet, and the app never sees
 *   the figure that produces. An optional parameter defaulting to "nothing withheld" is a
 *   silence the next export path would ship back in (U.23). Pass `{ count: 0, currencies: [] }`
 *   to state that nothing was withheld — never to avoid finding out.
 */
export function transactionsToCsv(
  rows: readonly ExportTxn[],
  withheld: WithheldAccountSummary,
): string {
  // U.19: the column is UNCONDITIONAL, unlike the note below it. A column that
  // appears only for readers with a combined pair is a schema that changes shape
  // per reader, which breaks anything automated against the file silently and
  // only for some of them. An always-present column that is empty for everyone
  // else costs one character per row and keeps the file one shape.
  const header = 'date,account,description,merchant,category,amount,status,changeover_day';
  const lines = rows.map((r) =>
    [
      r.date,
      csvField(r.account),
      csvField(r.rawDescriptor),
      csvField(r.merchant ?? ''),
      csvField(r.category ?? ''),
      (r.amountCents / 100).toFixed(2),
      r.status,
      r.onHandoverDay ? 'yes' : '',
    ].join(','),
  );
  // Rectangular: each note occupies the first field and the rest are empty, so a
  // parser reading the file as a table still sees rows of the declared width
  // rather than a ragged tail.
  const noteRow = (text: string) => [csvField(text), '', '', '', '', '', '', ''].join(',');
  // Fixed order, both conditional: the handover note describes rows that ARE in
  // the file (the marked ones, so it belongs with the column it explains), the
  // currency note describes rows that are NOT. A reader who triggers both gets
  // them in the same order every time.
  const notes = [
    rows.some((r) => r.onHandoverDay) ? HANDOVER_CSV_NOTE : null,
    withheldExportNote(withheld),
  ].filter((n): n is string => n !== null);
  return [header, ...lines, ...notes.map(noteRow)].join('\r\n') + '\r\n';
}

export interface NetWorthExportRow {
  date: string;
  netWorthCents: number;
}

export function netWorthToCsv(rows: readonly NetWorthExportRow[]): string {
  const header = 'date,net_worth';
  const lines = rows.map((r) => `${r.date},${(r.netWorthCents / 100).toFixed(2)}`);
  return [header, ...lines].join('\r\n') + '\r\n';
}

/** The account rows this report prints, as much of them as the honesty rules depend on. */
export interface NetWorthReportAccount {
  /** Needed to drop a reconciliation PREDECESSOR — see `activeNetWorthReportAccounts`. */
  id: string;
  name: string;
  type: string;
  currentBalanceCents: number;
  /** YYYY-MM-DD the bank stopped sharing this account, else null. */
  feedDroppedAt: string | null;
}

/**
 * The rows this report may speak about: everything except a reconciliation PREDECESSOR that has
 * been superseded by a live successor (L.20 critic cycle, finding A-1).
 *
 * The assembler zeroes a superseded predecessor's balance, so such a row reaches this report as
 * `$0.00` — and `netWorthFrozenNote` would then tell a lender that this $0.00 "is still counted in
 * the net worth and trend in this report", about a figure contributing nothing to either. That
 * exact pairing was already fixed once for the dashboard banner (`getFeedDroppedAccounts`), where
 * the note is on record as "not exotic — it is the journey this very disclosure provokes": the row
 * freezes, the user re-adds the bank, and accepts "Continue this account". The PDF path never got
 * the guard.
 *
 * The predecessor is dropped from the ROW LIST too, not merely from the note. /accounts hides it,
 * the net worth excludes it, and a lender reading a duplicate account name at $0.00 has no way to
 * ask what it is — a durable artifact should not print a row the app itself no longer shows.
 */
export function activeNetWorthReportAccounts(
  accounts: readonly NetWorthReportAccount[],
  supersededAccountIds: readonly string[],
): NetWorthReportAccount[] {
  const superseded = new Set(supersededAccountIds);
  return accounts.filter((a) => !superseded.has(a.id));
}

/**
 * The report's provenance line.
 *
 * It used to read "Balances reflect the data source at export time", which is affirmatively FALSE
 * about an account whose bank stopped sending one: the figure printed is older than the export, and
 * this sentence told a lender otherwise (TASKS L.20). True of every row unconditionally now, rather
 * than branched — an export with nothing frozen loses nothing by declining to claim a currency it
 * was never checking for, and a provenance line that is only sometimes right is worse than one that
 * is always right.
 *
 * Exported as a constant, and the per-row/summary builders below as functions, for the reason
 * `today-feed-copy.ts` gives: money copy inside a binary artifact is otherwise testable only by
 * grepping compressed PDF bytes, so in practice it would not be tested at all.
 */
export const NET_WORTH_REPORT_FOOTER =
  'Educational, not financial advice. Balances are the most recent figures each source sent us.';

/**
 * One account row. The staleness is marked on the ROW as well as in the summary note below,
 * because a reader scanning a long list matches a figure to its caveat far more reliably when the
 * caveat sits on the figure.
 */
export function netWorthAccountLine(a: NetWorthReportAccount): string {
  // `isLiabilityType`, not a two-type comparison (L.20 critic cycle, finding A-3). The canonical
  // set is CREDIT | LOAN | MORTGAGE | OTHER_LIABILITY, and `netWorthCents` subtracts all four —
  // so the hand-written pair printed a $310,000 mortgage as a POSITIVE number in a report whose
  // headline had subtracted it, and the rows disagreed with the total by twice the mortgage.
  // Both missing types are user-creatable from the manual-account form, so this was reachable
  // without any bank at all.
  const sign = isLiabilityType(a.type) ? '-' : '';
  const stale = a.feedDroppedAt ? `  - not updated since ${a.feedDroppedAt}` : '';
  return `${a.name}  (${a.type})  ${sign}${formatCents(cents(a.currentBalanceCents))}${stale}`;
}

/**
 * The summary claim for a report containing one or more frozen balances, or null when none are.
 *
 * `figureLabel` names BOTH figures the report prints, because the frozen balance is inside each of
 * them: the trend's recent points carry it forward exactly as the headline does. `open-app` because
 * a PDF holds no control at all — it can name the app, and nothing inside it.
 */
export function netWorthFrozenNote(
  accounts: readonly NetWorthReportAccount[],
): string | null {
  return frozenTotalNote(
    accounts
      .filter((a) => a.feedDroppedAt != null)
      .map((a) => ({ label: a.name, frozenSince: a.feedDroppedAt as string })),
    { figureLabel: 'the net worth and trend in this report', nextStep: 'open-app' },
  );
}

/** The report's page geometry, exported so a test can assert against the real numbers. */
export const NET_WORTH_REPORT_PAGE = { width: 612, height: 792, marginX: 48 } as const;
export const NET_WORTH_REPORT_USABLE_WIDTH =
  NET_WORTH_REPORT_PAGE.width - NET_WORTH_REPORT_PAGE.marginX * 2;

/**
 * Greedy word wrap against the real font metrics (L.20 critic cycle, finding A-2).
 *
 * `pdf-lib`'s `drawText` does not wrap: a line wider than the page simply runs off the right edge
 * and is CLIPPED. Measured, the one-frozen-account note is 861.6pt against 516pt of usable width,
 * so two thirds of it never rendered — and the two clauses that fell off the edge were the SCOPE
 * ("in the net worth and trend in this report") and the entire REMEDY ("Open Aimplifi to see the
 * connection and how to fix it"), leaving the visible half ending mid-word on "still co".
 *
 * That is a copy defect, not a layout nit: the sentence L.20 exists to put inside a durable
 * artifact was the part the reader could not see. Exported so the lock can measure text rather
 * than grep compressed PDF bytes.
 */
export function wrapToWidth(
  text: string,
  measure: (s: string) => number,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const candidate = line === '' ? word : `${line} ${word}`;
    if (line !== '' && measure(candidate) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line !== '') lines.push(line);
  return lines;
}

export async function netWorthReportPdf(params: {
  generatedFor: string;
  asOf: string;
  netWorthCents: Cents;
  /**
   * `feedDroppedAt` is REQUIRED (TASKS L.20). This report is the one surface in the app that
   * leaves it: a file, handed to a lender or filed away, with no way to correct itself once the
   * connection is noticed. A caller that forgets the flag produces a document asserting balances
   * are current when the bank stopped sending them — so the compiler asks for it.
   */
  accounts: NetWorthReportAccount[];
  /**
   * Reconciliation predecessors superseded by a live successor — REQUIRED for the same reason
   * `feedDroppedAt` is (L.20 critic cycle, finding A-1). Pass `[]` only when the caller has
   * genuinely established there are none; a forgotten filter makes the frozen note assert that a
   * zeroed phantom row "is still counted" in the totals below it.
   */
  supersededAccountIds: readonly string[];
  trend: NetWorthExportRow[];
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([NET_WORTH_REPORT_PAGE.width, NET_WORTH_REPORT_PAGE.height]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const accounts = activeNetWorthReportAccounts(params.accounts, params.supersededAccountIds);

  let y = 740;
  const draw = (text: string, opts: { size?: number; isBold?: boolean; x?: number } = {}) => {
    const size = opts.size ?? 11;
    const x = opts.x ?? NET_WORTH_REPORT_PAGE.marginX;
    const face: PDFFont = opts.isBold ? bold : font;
    const maxWidth = NET_WORTH_REPORT_PAGE.width - x - NET_WORTH_REPORT_PAGE.marginX;
    for (const line of wrapToWidth(text, (s) => face.widthOfTextAtSize(s, size), maxWidth)) {
      page.drawText(line, { x, y, size, font: face, color: rgb(0.1, 0.1, 0.12) });
      y -= size + 7;
    }
  };

  draw('Aimplifi — Net Worth Report', { size: 18, isBold: true });
  draw(`Generated for ${params.generatedFor} - data as of ${params.asOf}`, { size: 9 });
  y -= 8;
  draw(`Net worth: ${formatCents(params.netWorthCents)}`, { size: 14, isBold: true });
  y -= 6;
  draw('Accounts', { size: 12, isBold: true });
  for (const a of accounts) draw(netWorthAccountLine(a), { size: 10 });
  const frozenNote = netWorthFrozenNote(accounts);
  if (frozenNote) {
    y -= 4;
    draw(frozenNote, { size: 8 });
  }
  y -= 6;
  // NOT "(month-end)". Every row here used to be one because the seed was the
  // only writer of snapshots; U.4 records a live account on the day its balance
  // was read, so a heading asserting month-ends is false for every row a real
  // user exports — and this is the one artifact that leaves the app and is
  // handed to a third party, with no way to correct itself afterwards. Each row
  // already carries its own date, so the heading needs to claim nothing.
  draw('Trend (recorded balances)', { size: 12, isBold: true });
  for (const r of params.trend.slice(-12)) {
    draw(`${r.date}   ${formatCents(cents(r.netWorthCents))}`, { size: 9 });
  }
  y -= 4;
  draw(NET_WORTH_REPORT_FOOTER, { size: 8 });

  return doc.save();
}
