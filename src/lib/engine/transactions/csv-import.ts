/**
 * Pure CSV transaction import. Parses a bank/Mint-style export into validated,
 * categorized, persist-ready rows with per-row errors. No I/O — the server
 * action reads the upload and persists; this module is fully unit-tested and is
 * the third ingest source that must obey the DECISIONS #22 pipeline order
 * (normalize → rules → categorize), exactly like Plaid and manual entry.
 *
 * Contract (kept deliberately simple and unambiguous):
 *  - A header row is required. Recognized columns (case-insensitive, aliased):
 *      date         ← date | transaction date | posted date
 *      description  ← description | payee | memo | name
 *      amount       ← amount
 *      category     ← category   (OPTIONAL)
 *  - Amount is SIGNED in Pulse convention: NEGATIVE = money out, POSITIVE = in
 *    (matches Mint/most US bank exports). "$" and thousands commas are stripped.
 *  - Dates accepted as YYYY-MM-DD or US MM/DD/YYYY.
 *  - Category may be a slug ("dining") or a display name ("Dining Out"); unknown
 *    or blank → auto-categorized through the pipeline.
 */
import { type ISODate, isoDate } from '@/lib/dates';
import { centsFromDollarString } from '@/lib/money';
import { CATEGORIES, CATEGORY_BY_ID } from '@/lib/engine/categorize/categories';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { type RuleLike, categorize } from '@/lib/engine/categorize/pipeline';

const DESCRIPTION_ALIASES = ['description', 'payee', 'memo', 'name'];
const DATE_ALIASES = ['date', 'transaction date', 'posted date'];

const CATEGORY_BY_NAME = new Map(CATEGORIES.map((c) => [c.name.toLowerCase(), c.id]));

export interface ParsedCsvRow {
  /** 1-based line number in the source file (header counts as line 1). */
  line: number;
  date: ISODate;
  description: string;
  amountCents: number; // signed (Pulse convention)
  categoryId: string | null; // explicit, validated slug — or null = auto
}

export interface CsvRowError {
  line: number;
  message: string;
}

export interface ParsedCsv {
  rows: ParsedCsvRow[];
  errors: CsvRowError[];
}

/** Split one CSV line into fields, honoring double-quoted fields and "" escapes. */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      fields.push(field);
      field = '';
    } else {
      field += c;
    }
  }
  fields.push(field);
  return fields.map((f) => f.trim());
}

/** YYYY-MM-DD or US MM/DD/YYYY → ISODate. Throws on anything else. */
export function normalizeImportDate(raw: string): ISODate {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return isoDate(s);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (us) {
    const [, m, d, y] = us;
    return isoDate(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`);
  }
  throw new Error(`unrecognized date "${raw}" (use YYYY-MM-DD or MM/DD/YYYY)`);
}

function resolveCategory(raw: string, customByName: ReadonlyMap<string, string>): string | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (CATEGORY_BY_ID.has(s)) return s;
  // System display name, then a custom category name the user owns; unknown → auto.
  return CATEGORY_BY_NAME.get(s) ?? customByName.get(s) ?? null;
}

/**
 * @param customByName lowercased custom-category name → id, so a CSV "category"
 * column naming one of the user's own categories ("Golf") resolves to it
 * (DECISIONS #111). Empty by default → system-only resolution, unchanged.
 */
export function parseTransactionCsv(
  text: string,
  customByName: ReadonlyMap<string, string> = new Map(),
): ParsedCsv {
  const rawLines = text.split(/\r\n|\r|\n/);
  // index of the first non-blank line = header
  const headerIdx = rawLines.findIndex((l) => l.trim() !== '');
  if (headerIdx === -1) return { rows: [], errors: [{ line: 1, message: 'File is empty' }] };

  const header = parseCsvLine(rawLines[headerIdx]).map((h) => h.toLowerCase());
  const find = (aliases: string[]) => header.findIndex((h) => aliases.includes(h));
  const dateCol = find(DATE_ALIASES);
  const descCol = find(DESCRIPTION_ALIASES);
  const amountCol = header.indexOf('amount');
  const catCol = header.indexOf('category');

  const missing: string[] = [];
  if (dateCol === -1) missing.push('date');
  if (descCol === -1) missing.push('description');
  if (amountCol === -1) missing.push('amount');
  if (missing.length) {
    return {
      rows: [],
      errors: [{ line: headerIdx + 1, message: `Missing required column(s): ${missing.join(', ')}` }],
    };
  }

  const rows: ParsedCsvRow[] = [];
  const errors: CsvRowError[] = [];
  for (let i = headerIdx + 1; i < rawLines.length; i++) {
    const lineNo = i + 1;
    if (rawLines[i].trim() === '') continue; // skip blank lines
    const fields = parseCsvLine(rawLines[i]);
    try {
      const description = (fields[descCol] ?? '').trim();
      if (!description) throw new Error('description is empty');
      const date = normalizeImportDate(fields[dateCol] ?? '');
      const amountRaw = (fields[amountCol] ?? '').replace(/[$,\s]/g, '');
      if (amountRaw === '') throw new Error('amount is empty');
      const amountCents = centsFromDollarString(amountRaw); // signed; throws if malformed
      const categoryId = catCol === -1 ? null : resolveCategory(fields[catCol] ?? '', customByName);
      rows.push({ line: lineNo, date, description, amountCents, categoryId });
    } catch (e) {
      errors.push({ line: lineNo, message: e instanceof Error ? e.message : 'invalid row' });
    }
  }
  return { rows, errors };
}

export interface PreparedImportRow {
  accountId: string;
  date: ISODate;
  amountCents: number;
  rawDescriptor: string;
  merchantCanonical: string;
  categoryId: string;
  confidenceBps: number;
  needsReview: boolean;
  isTransfer: boolean;
  status: 'POSTED';
}

/**
 * Turn a parsed row into a categorized, persist-ready row. An explicit, valid
 * category is authoritative; otherwise the standard pipeline decides (and a
 * low-confidence guess lands in the triage inbox like any other ingested row).
 */
export function prepareImportedTransaction(
  row: ParsedCsvRow,
  accountId: string,
  rules: readonly RuleLike[] = [],
): PreparedImportRow {
  const merchant = normalizeMerchant(row.description);
  if (row.categoryId) {
    return {
      accountId,
      date: row.date,
      amountCents: row.amountCents,
      rawDescriptor: row.description,
      merchantCanonical: merchant.canonical,
      categoryId: row.categoryId,
      confidenceBps: 10000,
      needsReview: false,
      isTransfer: row.categoryId === 'transfer',
      status: 'POSTED',
    };
  }
  const result = categorize(
    { rawDescriptor: row.description, amountCents: row.amountCents, date: row.date, accountId },
    rules,
  );
  return {
    accountId,
    date: row.date,
    amountCents: row.amountCents,
    rawDescriptor: row.description,
    merchantCanonical: merchant.canonical,
    categoryId: result.categoryId,
    confidenceBps: result.confidenceBps,
    needsReview: result.needsReview,
    isTransfer: result.source === 'transfer',
    status: 'POSTED',
  };
}
