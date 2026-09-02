/**
 * Pure CSV transaction import. Parses a bank/Mint-style export into validated,
 * categorized, persist-ready rows with per-row errors. No I/O — the server
 * action reads the upload and persists; this module is fully unit-tested and is
 * the third ingest source that must obey the DECISIONS #22 pipeline order
 * (normalize → rules → categorize), exactly like Plaid and manual entry.
 *
 * Contract (kept deliberately simple and unambiguous):
 *  - A header row is required. Recognized columns (case-insensitive, aliased):
 *      date         ← date | transaction date | posted date | trade date
 *      description  ← description | payee | memo | name | transaction description
 *      amount       ← amount | net amount | transaction amount
 *                    OR Debit+Credit / Outflow+Inflow (unsigned; debit/outflow = money out)
 *      category     ← category   (OPTIONAL; slug, display name, or Simplifi alias)
 *  - Amount is SIGNED in Pulse convention: NEGATIVE = money out, POSITIVE = in
 *    (matches Mint/most US bank exports). "$" and thousands commas are stripped.
 *  - Dates accepted as YYYY-MM-DD or US MM/DD/YYYY.
 *  - Category may be a slug ("dining"), a display name ("Dining Out"), or a
 *    Simplifi alias ("Restaurants" → dining). Unknown or blank → auto-categorized.
 *    On a duplicate of an existing row, the file category is applied to that row.
 */
import { type ISODate, isoDate } from '@/lib/dates';
import { centsFromDollarString } from '@/lib/money';
import { CATEGORIES, CATEGORY_BY_ID } from '@/lib/engine/categorize/categories';
import { simplifiAliasToCategoryId } from '@/lib/engine/categorize/simplifi-aliases';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { type RuleLike, categorize } from '@/lib/engine/categorize/pipeline';
import type { PredictionSource } from '@/lib/engine/categorize/provenance';

const DESCRIPTION_ALIASES = ['description', 'payee', 'memo', 'name', 'transaction description'];
const DATE_ALIASES = ['date', 'transaction date', 'posted date', 'trade date'];
const AMOUNT_ALIASES = ['amount', 'net amount', 'transaction amount'];
const DEBIT_ALIASES = ['debit', 'outflow'];
const CREDIT_ALIASES = ['credit', 'inflow'];

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
  // System display name, then a Simplifi alias (Restaurants → dining), then a
  // custom category name the user owns; unknown → auto. Simplifi wins
  // classification: an export name must file the existing id, never a new leaf.
  return (
    CATEGORY_BY_NAME.get(s) ??
    simplifiAliasToCategoryId(raw) ??
    customByName.get(s) ??
    null
  );
}

function signedAmountFromCell(raw: string): number {
  const amountRaw = raw.replace(/[$,\s]/g, '');
  if (amountRaw === '') throw new Error('amount is empty');
  return centsFromDollarString(amountRaw);
}

/** Debit/outflow is money out; credit/inflow is money in. Columns are magnitudes. */
function composedDebitCreditCents(debitRaw: string, creditRaw: string): number {
  const debitCell = debitRaw.replace(/[$,\s]/g, '');
  const creditCell = creditRaw.replace(/[$,\s]/g, '');
  const debitAbs = debitCell === '' ? 0 : Math.abs(centsFromDollarString(debitCell));
  const creditAbs = creditCell === '' ? 0 : Math.abs(centsFromDollarString(creditCell));
  if (debitAbs === 0 && creditAbs === 0) throw new Error('amount is empty');
  return creditAbs - debitAbs;
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
  const amountCol = find(AMOUNT_ALIASES);
  const debitCol = find(DEBIT_ALIASES);
  const creditCol = find(CREDIT_ALIASES);
  const catCol = header.indexOf('category');
  const canComposeAmount = debitCol !== -1 && creditCol !== -1;

  const missing: string[] = [];
  if (dateCol === -1) missing.push('date');
  if (descCol === -1) missing.push('description');
  if (amountCol === -1 && !canComposeAmount) missing.push('amount');
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
      const amountCents =
        amountCol !== -1
          ? signedAmountFromCell(fields[amountCol] ?? '')
          : composedDebitCreditCents(fields[debitCol] ?? '', fields[creditCol] ?? '');
      const categoryId = catCol === -1 ? null : resolveCategory(fields[catCol] ?? '', customByName);
      rows.push({ line: lineNo, date, description, amountCents, categoryId });
    } catch (e) {
      errors.push({ line: lineNo, message: e instanceof Error ? e.message : 'invalid row' });
    }
  }
  return { rows, errors };
}

/** The only fields the dedupe reads off a row: its calendar date and its signed amount. */
export interface ImportDedupeRow {
  date: ISODate;
  amountCents: number; // signed — the sign is part of the identity (a $5 refund ≠ a $5 charge)
}

export interface CsvDedupePlan {
  /** Parallel to `fileRows`: true = create this row, false = the account already holds it. */
  keep: boolean[];
  /** Rows not created because the account already holds one like them. */
  duplicates: number;
  /**
   * Rows about to be created whose (date, amount) key appears MORE THAN ONCE in
   * the file itself, and more often than the account already holds (critic
   * P1-1). The classic shape is two overlapping exports pasted together (the
   * guides' own chunked-download flow); a well-formed export never contains it.
   * Warn, never block: two genuine same-day same-amount charges are legitimate,
   * and the app cannot tell them apart by key — the count is the honest hint.
   */
  repeatedRows: number;
}

/**
 * TASKS H.2 — decide which parsed CSV rows are genuinely new.
 *
 * Key: (date, signed amount) on the SAME account (the caller fetches one
 * account's rows). Descriptor is deliberately NOT part of the key: the whole
 * point of the overlap dedupe is matching bank-export text against
 * provider-synced rows, whose rawDescriptor ("SQ *GOOSE POND") never equals the
 * statement text ("GOOSE POND BAR GRILLE") — requiring it would make the
 * provider-overlap case import double (H.6's prescription: "the dedupe must key
 * on account identity + date + amount").
 *
 * Semantics: multiset difference. For each key the file offers M rows and the
 * account already holds N; create max(0, M − N) of them. This is exactly right
 * for the two shipping cases — re-importing the same file (M == N → all
 * dropped) and the provider-overlap window (the provider's copy is in N) — and
 * never drops a key the account does not hold. When M > N (e.g. two identical
 * $5 charges, one already synced) it keeps exactly the new information, in file
 * order, without having to say which of the M is the new one — the rows are
 * indistinguishable by construction, so the count is the only honest answer.
 *
 * Split containers are plain rows here: a split charge's parent carries
 * (date, full amount), so the file's whole-charge row matches it and is
 * dropped — the charge is already represented (as its pieces). A row the
 * register hides (reconciliation-disowned) must NOT appear in `existingRows`:
 * an import is the reader asking for this history back, and a hidden row is not
 * a visible copy to collide with (H.8: a writer sees what its readers see).
 *
 * A file that contains the same line twice with NO stored row for it imports
 * both — the multiset rule cannot know which line is the corrupt one. That is
 * now SURFACED, not fixed: `repeatedRows` counts exactly those kept rows whose
 * key repeats in the file (warn, never block — a user pasting two overlapping
 * exports sees the count and can stop; a user with two genuine identical
 * charges sees a note and continues).
 */
export function planCsvDedupe(
  fileRows: readonly ImportDedupeRow[],
  existingRows: readonly ImportDedupeRow[],
): CsvDedupePlan {
  const counts = new Map<string, number>();
  for (const r of existingRows) {
    const k = `${r.date}|${r.amountCents}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  // File-side counts first: a kept row whose key occurs ≥2 times in the FILE is
  // an overlap hint, independent of what the account holds (the existing-rows
  // pass below decrements `counts` as it plans).
  const fileCounts = new Map<string, number>();
  for (const r of fileRows) {
    const k = `${r.date}|${r.amountCents}`;
    fileCounts.set(k, (fileCounts.get(k) ?? 0) + 1);
  }
  const keep = new Array<boolean>(fileRows.length);
  let duplicates = 0;
  let repeatedRows = 0;
  for (let i = 0; i < fileRows.length; i++) {
    const k = `${fileRows[i].date}|${fileRows[i].amountCents}`;
    const n = counts.get(k) ?? 0;
    if (n > 0) {
      counts.set(k, n - 1);
      keep[i] = false;
      duplicates++;
    } else {
      keep[i] = true;
      if ((fileCounts.get(k) ?? 0) >= 2) repeatedRows++;
    }
  }
  return { keep, duplicates, repeatedRows };
}


/** An existing register row the CSV overlap planner can recategorize. */
export interface ExistingImportRow {
  id: string;
  date: ISODate;
  amountCents: number;
  categoryId: string | null;
}

export interface CsvCategoryApply {
  transactionId: string;
  categoryId: string;
}

/**
 * When a CSV row is a duplicate of an existing register row AND the file
 * names an explicit category, apply that category onto the existing row.
 * Simplifi-as-source-of-truth during standup: matching history takes the
 * export's category instead of keeping Aimplifi's. No-ops when the file
 * has no category, the name does not resolve, or the row is already that id.
 *
 * Matching consumes existing rows in the same (date, signed amount) file
 * order as `planCsvDedupe`, so the row that was skipped as a duplicate is
 * the row that gets recategorized.
 */
export function planCsvCategoryApply(
  fileRows: readonly { date: ISODate; amountCents: number; categoryId: string | null }[],
  existingRows: readonly ExistingImportRow[],
  keep: readonly boolean[],
): CsvCategoryApply[] {
  const queues = new Map<string, ExistingImportRow[]>();
  for (const r of existingRows) {
    const k = `${r.date}|${r.amountCents}`;
    const q = queues.get(k) ?? [];
    q.push(r);
    queues.set(k, q);
  }
  const out: CsvCategoryApply[] = [];
  for (let i = 0; i < fileRows.length; i++) {
    if (keep[i]) continue;
    const row = fileRows[i];
    if (!row.categoryId) continue;
    const k = `${row.date}|${row.amountCents}`;
    const q = queues.get(k);
    if (!q || q.length === 0) continue;
    const existing = q.shift()!;
    if (existing.categoryId === row.categoryId) continue;
    out.push({ transactionId: existing.id, categoryId: row.categoryId });
  }
  return out;
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
  /**
   * Provenance of the auto-categorized category (Why-This-Category §3.1). Absent
   * when the CSV DICTATED a category — that carries confidence 10000 and is never
   * logged as a prediction, so it has no source by construction.
   */
  source?: PredictionSource;
  /**
   * The tax tag a matched RULE instructs for this row (O.15 slice 6), or absent
   * when no rule with the action filed it. Absent on the explicit-category branch
   * by construction — a CSV that dictates a category consults no rule at all.
   */
  taxClassStamp?: string | null;
  spendClassStamp?: string | null;
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
  /** Per-user AUTO_FLAGGED boundary (threshold tuning, DECISIONS #190); undefined = global. */
  flaggedBps?: number,
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
    { flaggedBps },
  );
  return {
    accountId,
    date: row.date,
    amountCents: row.amountCents,
    rawDescriptor: row.description,
    // The PIPELINE's canonical (identical to the normalizer's unless a
    // rename-payee rule filed the row — O.13c, see plaid-map.ts).
    merchantCanonical: result.merchantCanonical,
    categoryId: result.categoryId,
    confidenceBps: result.confidenceBps,
    needsReview: result.needsReview,
    isTransfer: result.source === 'transfer',
    status: 'POSTED',
    source: result.source,
    // O.15 slice 6: a rule that files an imported row tags it too, so a CSV row
    // and a synced row that match the same rule end up identical.
    taxClassStamp: result.taxClassStamp,
    spendClassStamp: result.spendClassStamp,
  };
}

/** Spending-account types a first-run CSV import may create. */
export const CSV_IMPORT_NEW_ACCOUNT_TYPES = ['CHECKING', 'SAVINGS', 'CREDIT'] as const;
export type CsvImportNewAccountType = (typeof CSV_IMPORT_NEW_ACCOUNT_TYPES)[number];

/**
 * First-run import: the onboarding CSV path has no account picker yet.
 * Name + spending type only. Balance stays 0 — the file is history, not a
 * statement of current cash (DECISIONS #24).
 */
export function parseCsvImportNewAccount(
  name: string,
  type: string,
): { ok: true; name: string; type: CsvImportNewAccountType } | { ok: false; error: string } {
  const n = name.trim();
  if (!n) return { ok: false, error: 'Name the account these rows belong to.' };
  if (n.length > 60) return { ok: false, error: 'Name must be 60 characters or fewer.' };
  if (!(CSV_IMPORT_NEW_ACCOUNT_TYPES as readonly string[]).includes(type)) {
    return { ok: false, error: 'Pick checking, savings, or credit.' };
  }
  return { ok: true, name: n, type: type as CsvImportNewAccountType };
}
