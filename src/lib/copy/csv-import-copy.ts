/**
 * Import-transactions reader copy. CSV is a production classify-any-source
 * path (any bank export, optional category column). It is not a Simplifi-only
 * standup matcher and must not say so on the page.
 */
export const CSV_IMPORT_INTRO =
  'Bring in real transactions from any bank or CSV and paste it here. No bank connection required. Rows your synced connection already holds are not duplicated. If the file names a category, matching existing rows take that category. If the file contains the same line twice the import will flag it.';

export const CSV_IMPORT_CATEGORY_HELP =
  'A category in the file on a row you already have replaces the one on file.';
