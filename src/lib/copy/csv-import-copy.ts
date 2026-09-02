/**
 * Import-transactions reader copy. CSV is a production classify-any-source
 * path (any bank export, optional category column). It is not a Simplifi-only
 * standup matcher and must not say so on the page.
 */
export const CSV_IMPORT_INTRO =
  'Bring in real transactions from any bank or CSV and paste it here. No bank connection required. Rows your synced connection already holds are not duplicated. If the file names a category, matching existing rows take that category. If the file contains the same line twice the import will flag it.';

export const CSV_IMPORT_CATEGORY_HELP =
  'A category in the file on a row you already have replaces the one on file.';

export const CSV_IMPORT_COLUMNS_HELP =
  'Need a date (Date, Post Date, Trade Date, or Run Date), a payee, and money: amount or Net Amount, or Debit/Credit or Withdrawal/Deposit. Optional category. Signed amount is negative for money out. Debit and Withdrawal are money out. Dates as YYYY-MM-DD, MM/DD/YYYY, or MM/DD/YY.';

export function csvImportGuidesIntro(connectedInstitutionCount: number): string {
  if (connectedInstitutionCount === 0) {
    return 'Paste a CSV from any bank. If a bank only offers PDF statements, CSV cannot backfill it.';
  }
  return "These routes are the banks we see on your accounts. Banks that only offer PDF statements can't backfill via CSV — the synced feed is their history.";
}
