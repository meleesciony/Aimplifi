/**
 * CSV + PDF export builders (Phase 4). Pure functions; route handlers add
 * auth + audit logging. Money is formatted at this boundary only.
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { type Cents, cents, formatCents } from '@/lib/money';
import { frozenTotalNote } from '@/lib/engine/account/feed-dropped-view';

export interface ExportTxn {
  date: string;
  account: string;
  rawDescriptor: string;
  merchant: string | null;
  category: string | null;
  amountCents: number;
  status: string;
}

/**
 * RFC-4180 quoting + spreadsheet-formula-injection neutralization: fields
 * beginning with = + - @ or a tab/CR get a leading apostrophe so Excel/Sheets
 * treats them as text, never as a formula (final critic finding P2-1).
 */
function csvField(value: string): string {
  const neutralized = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(neutralized)
    ? `"${neutralized.replace(/"/g, '""')}"`
    : neutralized;
}

export function transactionsToCsv(rows: readonly ExportTxn[]): string {
  const header = 'date,account,description,merchant,category,amount,status';
  const lines = rows.map((r) =>
    [
      r.date,
      csvField(r.account),
      csvField(r.rawDescriptor),
      csvField(r.merchant ?? ''),
      csvField(r.category ?? ''),
      (r.amountCents / 100).toFixed(2),
      r.status,
    ].join(','),
  );
  return [header, ...lines].join('\r\n') + '\r\n';
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
  name: string;
  type: string;
  currentBalanceCents: number;
  /** YYYY-MM-DD the bank stopped sharing this account, else null. */
  feedDroppedAt: string | null;
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
  const sign = a.type === 'CREDIT' || a.type === 'LOAN' ? '-' : '';
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
  trend: NetWorthExportRow[];
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]); // US Letter
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let y = 740;
  const draw = (text: string, opts: { size?: number; isBold?: boolean; x?: number } = {}) => {
    page.drawText(text, {
      x: opts.x ?? 48,
      y,
      size: opts.size ?? 11,
      font: opts.isBold ? bold : font,
      color: rgb(0.1, 0.1, 0.12),
    });
    y -= (opts.size ?? 11) + 7;
  };

  draw('Aimplifi — Net Worth Report', { size: 18, isBold: true });
  draw(`Generated for ${params.generatedFor} - data as of ${params.asOf}`, { size: 9 });
  y -= 8;
  draw(`Net worth: ${formatCents(params.netWorthCents)}`, { size: 14, isBold: true });
  y -= 6;
  draw('Accounts', { size: 12, isBold: true });
  for (const a of params.accounts) draw(netWorthAccountLine(a), { size: 10 });
  const frozenNote = netWorthFrozenNote(params.accounts);
  if (frozenNote) {
    y -= 4;
    draw(frozenNote, { size: 8 });
  }
  y -= 6;
  draw('Trend (month-end)', { size: 12, isBold: true });
  for (const r of params.trend.slice(-12)) {
    draw(`${r.date}   ${formatCents(cents(r.netWorthCents))}`, { size: 9 });
  }
  y -= 4;
  draw(NET_WORTH_REPORT_FOOTER, { size: 8 });

  return doc.save();
}
