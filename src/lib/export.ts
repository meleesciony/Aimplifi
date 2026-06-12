/**
 * CSV + PDF export builders (Phase 4). Pure functions; route handlers add
 * auth + audit logging. Money is formatted at this boundary only.
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { type Cents, cents, formatCents } from '@/lib/money';

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

export async function netWorthReportPdf(params: {
  generatedFor: string;
  asOf: string;
  netWorthCents: Cents;
  accounts: { name: string; type: string; currentBalanceCents: number }[];
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

  draw('Pulse Finance — Net Worth Report', { size: 18, isBold: true });
  draw(`Generated for ${params.generatedFor} - data as of ${params.asOf}`, { size: 9 });
  y -= 8;
  draw(`Net worth: ${formatCents(params.netWorthCents)}`, { size: 14, isBold: true });
  y -= 6;
  draw('Accounts', { size: 12, isBold: true });
  for (const a of params.accounts) {
    const sign = a.type === 'CREDIT' || a.type === 'LOAN' ? '-' : '';
    draw(`${a.name}  (${a.type})  ${sign}${formatCents(cents(a.currentBalanceCents))}`, { size: 10 });
  }
  y -= 6;
  draw('Trend (month-end)', { size: 12, isBold: true });
  for (const r of params.trend.slice(-12)) {
    draw(`${r.date}   ${formatCents(cents(r.netWorthCents))}`, { size: 9 });
  }
  y -= 4;
  draw('Educational, not financial advice. Balances reflect the data source at export time.', { size: 8 });

  return doc.save();
}
