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
  /**
   * The reader's own "this row is not my spending" flag (O.15), and the
   * own-account transfer flag — the two facts `summarizeTransactions` uses to
   * decide a row contributes NOTHING to the register's in/out/net tiles
   * (`engine/transactions/query.ts`: transfers `continue` outright, excluded
   * rows are counted and then skipped).
   *
   * REQUIRED for the reason `onHandoverDay` is, and U.26 is what that reason
   * looks like when it is ignored: measured against a real database, one
   * $100.00 purchase, one $1,200.00 row the reader had marked not-their-spending
   * and one $2,000.00 transfer exported as three rows summing -$3,300.00 while
   * the register — over the very same three rows — reported $100.00 of money
   * out and said on screen that one row was excluded. Row-set parity (U.23) was
   * intact; what the file could not do was carry WHY two of its rows are not in
   * any figure the app shows. A reader summing the amount column got a number 33
   * times the app's, with nothing in the file to explain the gap.
   */
  excludeFromTotals: boolean;
  isTransfer: boolean;
}

/**
 * The file's own basis (U.25), stated UNCONDITIONALLY.
 *
 * U.23 gave this file a note naming ONE reason it is incomplete — the currency
 * withhold — and that note only appears for the rare reader who owns a non-USD
 * account. Meanwhile the file omits every loan, mortgage, brokerage and
 * investment row (#62), split PARENT containers, and rows the reconciliation
 * keep disowns, for EVERY reader, saying nothing. A single enumerated omission
 * reads as the complete list.
 *
 * Two things follow, and they are the whole design:
 *
 * 1. It is unconditional, because the fact is. Bolting a basis clause onto the
 *    currency note would gate a truth about every reader's file behind the rare
 *    condition of owning a euro account — the exact defect
 *    `docs/lessons/a-disclosure-gated-to-the-loudest-branch-misses-the-reachable-one.md`
 *    distilled from U.21 one session earlier. It costs U.19's "byte-identical
 *    file for a reader with no combined accounts" property, knowingly: that
 *    property was a statement about churn, and this is a statement about what
 *    the reader is holding.
 *
 * 2. Every clause is a RULE about the file, and none is an assertion about the
 *    reader's own data. This is the correction both critic passes forced, each
 *    having executed it: the first draft ended "It does not cover every account
 *    you hold, and it is not every transaction row Aimplifi has stored", which
 *    is FALSE for a reader holding only spending accounts in dollars with no
 *    splits — measured at 2 accounts of 2 and 3 rows of 3, and false for the
 *    production demo's own file, where all 847 stored rows are exported. Being
 *    unconditional is right for a rule and wrong for a claim about a reader:
 *    making a per-reader fact unconditional is `a-disclosure-gated-to-the-loudest-branch`
 *    with the sign flipped, and it is `scoping-the-number-does-not-scope-the-sentence`
 *    again — where a clause must speak for every reader, state a rule with no
 *    count and no claim of omission in it. Hence "whether or not you hold one".
 *
 *    The rule is also self-maintaining. Since U.23 this route and
 *    `getTransactions` share `registerRowWhere` and the same R1 keep, with no
 *    date window and no default filter on either side, so the equality clause is
 *    true by construction and stays true when that clause changes. It is scoped
 *    to "those accounts" because the Transactions page ALSO renders a household
 *    member's shared rows (`transactions/page.tsx:270`), ungated by filters — a
 *    superset this file does not carry — and it names every page of it because
 *    the register paginates at 100 while the file does not.
 *
 *    The account types are glossed rather than left as "spending accounts". The
 *    reader this note is written for may be an accountant holding the file with
 *    no way to open the app (`a-disclosure-written-for-a-page-is-false-in-an-email`),
 *    so the one clause they can act on must not be app jargon. The gloss is the
 *    register page's own (`transactions/page.tsx:173`).
 */
const BASIS_CSV_NOTE =
  'Note: this file lists transactions from your spending accounts — checking, savings and ' +
  'credit cards. Accounts of any other kind are not represented here, whether or not you hold ' +
  'one. Within those accounts, it holds the same rows Aimplifi shows on its Transactions page, ' +
  'across every page of it, and no others.';

/** Sentences written lowercase-initial, joined with the later ones capitalised. */
function joinSentences(parts: readonly string[]): string {
  return parts
    .map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(' ');
}

/**
 * The note for rows that are IN this file and in none of the app's money totals
 * (U.26), or null when the file holds no such row.
 *
 * Conditional, and assembled from the flags actually present, because each
 * sentence is a claim about a set: telling a reader that "rows marked yes in
 * excluded_from_totals are ones you told us were not your spending" when they
 * have never excluded a row sends them looking down a column of blanks for a
 * marker that was never there.
 *
 * What it deliberately does NOT say:
 *  - No direction. The flagged rows carry signed amounts, so "your sum will be
 *    too high" is false for a reader whose excluded rows are refunds — the same
 *    inverted-direction clause the U.19–U.22 critic caught executing backwards
 *    on negative-net merchants. "Includes money those totals leave out" is true
 *    whatever the signs are, and true even when they happen to cancel.
 *  - No promise of equality. It does not tell the reader that dropping these
 *    rows reproduces the app's figures: `changeover_day` can still double a row,
 *    and a claim that two engines agree is exactly what
 *    `a-link-on-a-figure-asserts-two-engines-agree` says must be earned rather
 *    than asserted. The file states the fact; the arithmetic stays the reader's.
 *  - NOT that the app leaves these rows out everywhere. The first draft said
 *    "the spending, income and net totals it shows", and the money critic
 *    executed the counterexample on the production demo's own data: an auto-loan
 *    ACH is flagged `isTransfer`, and `recurring/detect.ts:416` deliberately
 *    KEEPS it (`plan.ts:631` says so out loud), so /spending-plan prints
 *    "CarMax Auto Finance $385.00/mo" as a named line inside a $3,096.72 Fixed
 *    figure — 18 rows this file marks `transfer,yes`. The excluded side has the
 *    same shape: the tax export keeps a row the reader both tagged and excluded,
 *    because the tag is the later instruction (`exclude.ts:30-32`). So the
 *    sentence names the THREE figures whose basis is `summarizeTransactions` —
 *    the register's own tiles, which is exactly what these two flags gate — and
 *    nothing wider.
 *  - Not a claim that the money is fictional, and not the reverse either. The
 *    first draft closed with "Account balances count every row either way",
 *    which is false for a hand-entered row: `transactions/manual.ts:7` records
 *    that a manual entry never rewrites a provider-authoritative balance, and
 *    the register invites hand entry. "Still real transactions" carries the same
 *    reassurance without asserting which figure counts them.
 *  - No claim about a COUNTERPART. `isTransfer` is set by descriptor evidence
 *    alone (`transfers.ts:139` via the `auto-loan` merchant category), so a
 *    reader who never added their car loan has no other account for the money to
 *    have moved to, and the first draft told them the matching row existed
 *    somewhere. The flag is the app's judgement about a row, so the sentence
 *    attributes it to the app rather than asserting the fact.
 */
export function excludedTransferCsvNote(rows: readonly ExportTxn[]): string | null {
  const hasExcluded = rows.some((r) => r.excludeFromTotals);
  const hasTransfer = rows.some((r) => r.isTransfer);
  if (!hasExcluded && !hasTransfer) return null;
  const sentences = [
    hasExcluded
      ? // The control's own label (`transaction-list.tsx` badge, the action menu),
        // and sign-neutral: excluding is not gated on sign, so "you said this was
        // not your spending" is wrong about an excluded refund.
        'rows marked yes in excluded_from_totals are ones you marked "Exclude from totals" in ' +
        'Aimplifi.'
      : null,
    hasTransfer
      ? 'rows marked yes in transfer are ones Aimplifi treated as moving money between accounts ' +
        'rather than as spending or income.'
      : null,
    `${hasExcluded && hasTransfer ? 'Both kinds are' : 'They are'} left out of the money-in, ` +
      'money-out and net figures on Aimplifi\'s Transactions page, so a sum of the amount column ' +
      'here includes money those three figures leave out. The rows are still real transactions, ' +
      'and other parts of Aimplifi may count them.',
  ].filter((s): s is string => s !== null);
  return `Note: ${joinSentences(sentences)}`;
}

/**
 * The trailing note (U.19), emitted only when the file actually contains
 * released rows.
 *
 * It used to add that a reader with no combined accounts still received a
 * byte-identical file. That stopped being true at U.25, deliberately: every file
 * now ends with the unconditional basis note above, because a file whose shape
 * never changes is worth less than a file that says what it is.
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
  // U.26 appends its two columns rather than grouping them beside `amount`,
  // where they read more naturally: a reader's saved script indexes this file by
  // POSITION, and inserting a column mid-row silently re-points every one of
  // those indexes at the wrong field. Appending can only add.
  const header =
    'date,account,description,merchant,category,amount,status,changeover_day,' +
    'excluded_from_totals,transfer';
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
      r.excludeFromTotals ? 'yes' : '',
      r.isTransfer ? 'yes' : '',
    ].join(','),
  );
  // Rectangular: each note occupies the first field and the rest are empty, so a
  // parser reading the file as a table still sees rows of the declared width
  // rather than a ragged tail. Derived from the header rather than hand-counted
  // (it was a literal array of eight empty strings until U.26 added the ninth
  // and tenth columns): the padding and the schema cannot drift apart if only
  // one of them is a number anyone can get wrong.
  const width = header.split(',').length;
  const noteRow = (text: string) => [csvField(text), ...Array(width - 1).fill('')].join(',');
  // Fixed order, and the rule behind it: the basis note first because it frames
  // the whole file, then the notes explaining a marked column in the order those
  // columns appear, then the currency note last because it alone describes rows
  // that are NOT here. A reader who triggers all four gets them the same way
  // every time.
  const notes = [
    BASIS_CSV_NOTE,
    rows.some((r) => r.onHandoverDay) ? HANDOVER_CSV_NOTE : null,
    excludedTransferCsvNote(rows),
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

/** Heading over the trend rows. Claims nothing about recorded vs live —
 *  the last row is today's live overwrite (U.10). Locked so a later
 *  parenthetical cannot re-assert "recorded" or "month-end". */
export const NET_WORTH_REPORT_TREND_HEADING = 'Trend';

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
  // NOT "(month-end)" and NOT "(recorded balances)". U.4 ended month-end
  // shape; U.10's live overwrite means the last row is never a recording
  // (`netWorthSeries` replaces today's bucket). This is the artifact that
  // leaves the app. Each row already carries its date; the heading claims
  // nothing about how a row was built.
  draw(NET_WORTH_REPORT_TREND_HEADING, { size: 12, isBold: true });
  for (const r of params.trend.slice(-12)) {
    draw(`${r.date}   ${formatCents(cents(r.netWorthCents))}`, { size: 9 });
  }
  y -= 4;
  draw(NET_WORTH_REPORT_FOOTER, { size: 8 });

  return doc.save();
}
