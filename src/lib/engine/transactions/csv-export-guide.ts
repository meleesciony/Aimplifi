/**
 * TASKS H.2 — per-institution CSV export instructions for /transactions/import.
 * Pure copy data + exact-name lookup; no I/O. Every bank's route below was
 * web-verified against bank help pages / established exporter guides before it
 * shipped — the never-guess rule: an instruction that isn't verified doesn't
 * ship. Where sources disagreed on a number (e.g. Chase's exact CSV window),
 * the copy says "recent window" instead of inventing one.
 *
 * Match basis: the institution names the import page passes in — live
 * PlaidItem.institution values ("Chase"), the same names /accounts shows for
 * the connection. Lookup is human-name → card: case and punctuation are
 * normalized; any name without a verified card resolves to null, and the UI
 * falls back to the generic card.
 */
export interface CsvExportGuide {
  /** Shown as the card title. */
  institution: string;
  /** One action per step, in order. */
  steps: string[];
  /** Verified caveat about the bank's export window or format. */
  note?: string;
}

export const CSV_EXPORT_GUIDES: readonly CsvExportGuide[] = [
  {
    institution: 'Chase',
    steps: [
      'Sign in at chase.com on a computer.',
      'Open the account you want (checking, savings, or credit card).',
      'In the account activity list, click "Download account activity".',
      'Choose "Spreadsheet (Excel, CSV)" as the file type.',
      'Pick the date range and click Download.',
    ],
    note: "Chase's CSV export covers a recent window of activity only — older months are PDF statements, not CSV.",
  },
  {
    institution: 'Capital One',
    steps: [
      'Sign in at capitalone.com on a computer (the CSV download is not in the mobile app).',
      'Open the account you want — each account downloads separately.',
      'In the transaction list, click "Download Transactions".',
      'Choose CSV as the file type, pick a date range, and click Export.',
    ],
    note: "Capital One's export uses separate Debit and Credit columns instead of one signed amount. Before pasting, add a column named `amount`: use the Credit value for money in, and the Debit value as a negative number for money out. (The export covers recent activity only.)",
  },
  {
    institution: 'American Express',
    steps: [
      'Sign in at americanexpress.com on a computer.',
      'Go to "Statements and Activity".',
      'Choose "Custom Date Range", enter the start and end dates, and click Search.',
      'Click Download, choose CSV as the format, and save the file.',
    ],
    note: 'About two years of transactions are downloadable this way; older months are PDF statements.',
  },
  {
    institution: 'Charles Schwab',
    steps: [
      'Sign in at schwab.com on a computer.',
      'In the Accounts menu, go to "History".',
      'Pick the account and set the date range, then click Search.',
      'Click Export, choose CSV, and save the file.',
    ],
    note: 'CSV downloads are capped at 10,000 rows — split very long date ranges into smaller pieces.',
  },
  {
    institution: 'Vanguard',
    steps: [
      'Sign in at vanguard.com on a computer.',
      'Go to "My accounts" → "Transaction history" (Accounts & activity).',
      'Click "Download", choose CSV and a date range, then save the file.',
    ],
    note: "Vanguard's export uses different column names (Trade Date / Transaction Description / Net Amount) — rename the headers to `date`, `description`, and `amount` before pasting. The CSV window is limited; older history is PDF statements.",
  },
  {
    institution: 'Truist',
    steps: [
      'Sign in at truist.com on a computer.',
      'Open the account you want.',
      'In the transaction list, find the Download/Export option (near the top of the list).',
      'Choose CSV and a date range, then download.',
    ],
    note: "Truist's CSV export covers a recent window (about 90 days per download) — older months are PDF statements.",
  },
  {
    institution: 'U.S. Bank',
    steps: [
      'Sign in at usbank.com on a computer (the CSV download is not in the mobile app).',
      'Open the account you want.',
      'In the Transactions tile, click the download icon in the top-right corner.',
      'Choose the date range (up to 90 days per download) and CSV format, then click Download.',
    ],
    note: 'Only posted transactions export, and downloads are capped at 18 months of history in 90-day chunks — older months are PDF statements.',
  },
];

/** Generic guidance for any institution without a verified card. */
export const GENERIC_CSV_GUIDE: CsvExportGuide = {
  institution: 'Your bank',
  steps: [
    'Sign in on a computer and open the account.',
    'Look for "Download" or "Export" near the transaction list — often a small icon.',
    'Choose CSV (or spreadsheet) format and a date range.',
    'Open the file: the columns should say date, description, and amount, with money out negative.',
    'Paste the contents here.',
  ],
  note: "If your bank only offers PDF statements, CSV backfill isn't available for it — the synced feed is your history there. For guidance on any bank: search \"<bank name> download transactions CSV\".",
};

/** Lowercase, strip punctuation — "U.S. Bank" == "US Bank" == "usbank". */
function keyOf(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const GUIDE_BY_KEY = new Map<string, CsvExportGuide>();
for (const g of CSV_EXPORT_GUIDES) GUIDE_BY_KEY.set(keyOf(g.institution), g);
// Verified aliases only — "Amex" is the common name for American Express, and
// "Schwab" is what users type for Charles Schwab.
GUIDE_BY_KEY.set('amex', GUIDE_BY_KEY.get('americanexpress')!);
GUIDE_BY_KEY.set('schwab', GUIDE_BY_KEY.get('charlesschwab')!);

/** Exact-name lookup — null means "no verified card": show the generic one. */
export function csvExportGuideFor(institution: string): CsvExportGuide | null {
  return GUIDE_BY_KEY.get(keyOf(institution)) ?? null;
}
