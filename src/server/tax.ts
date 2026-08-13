/**
 * Server read layer for the tax-year export: Prisma rows in, the pure engine's
 * report out. All the money decisions live in `src/lib/engine/tax/export.ts`; this
 * file's only job is to hand that engine an honest, correctly-scoped row set.
 *
 * SCOPING, copied deliberately from the existing `/api/export` transactions-csv
 * branch rather than invented here, because a second scoping rule is a second
 * chance to leak someone else's rows into a file the reader downloads:
 *  - `account: { userId }` — the viewer's OWN accounts, never a household widening.
 *  - `SPENDING_ACCOUNT_TYPES` — bank + cards; brokerage/loan activity is not spending.
 *  - the reconciliation keep-rule, so a reconciled pair's overlap is counted once.
 *
 * Split parents are NOT filtered out in the query on purpose: the engine excludes and
 * COUNTS them, and a row filtered here would be a silent omission the reader could
 * never explain. Same for pending and transfers.
 */
import { prisma } from '@/lib/db';
import { SPENDING_ACCOUNT_TYPES } from '@/lib/engine/transactions/query';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { getReconciliationBoundary, getReconciliationTxnKeep } from '@/server/reconciliation';
import { buildTaxExport, taxYearsWithTags, type TaxExport, type TaxExportRow } from '@/lib/engine/tax/export';

/**
 * Every row the tax engine may speak about, in the engine's own shape.
 *
 * U.33: the R1 keep arrives as a PARAMETER rather than being fetched here, so
 * `getTaxExport` — which also needs the released dates the same links produce — can
 * resolve both from one read. Required, not optional-with-a-fallback: an optional
 * parameter defaulting to its own fetch is how the second read survives a consolidation
 * unnoticed, and the whole point of this slice is that a file leaving the app must not
 * be assembled from two different snapshots of the link table.
 */
async function taxRows(
  userId: string,
  keepsReconciled: (accountId: string, date: string) => boolean,
): Promise<TaxExportRow[]> {
  const raw = await prisma.transaction.findMany({
    where: {
      account: { userId, type: { in: [...SPENDING_ACCOUNT_TYPES] }, OR: [{ currency: null }, { currency: 'USD' }] },
      // Only TAGGED rows can appear in this report, and the tag is the whole filter
      // — untagged rows are not "untagged medical", they are simply not part of it.
      //
      // "Tagged" gained a second author in O.15 slice 6: a rule the reader wrote can
      // stamp `taxClass` when it files a row. That is still his instruction rather
      // than the app's inference (only an explicit typed rule may carry the action,
      // never a learned one, a merchant default or a provider guess), which is why
      // this filter is unchanged — but the sentence above used to say "the reader
      // actually tagged", and a rule-tagged row would have made it false.
      taxClass: { not: null },
    },
    include: { merchant: true },
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
  });
  return raw
    .filter((t) => keepsReconciled(t.accountId, t.date))
    .map((t) => ({
      date: t.date,
      // The same name the register shows, so a line in the file is findable in the
      // app — a descriptor the reader has never seen on screen is not a record.
      description: t.merchant?.canonical ?? normalizeMerchant(t.rawDescriptor).canonical,
      amountCents: t.amountCents,
      status: t.status,
      isTransfer: t.isTransfer,
      isSplitParent: t.isSplitParent,
      taxClass: t.taxClass,
      note: t.note,
    }));
}

/** The report for one year. */
export async function getTaxExport(userId: string, year: number): Promise<TaxExport> {
  // U.33: ONE read of the link table decides both which rows this file may speak about and
  // which of its dates carry two connections' copies. It used to be two independent reads run
  // concurrently — `taxRows` fetching the keep for itself while `getReconciliationHandoverDates`
  // fetched the same links again — so an "Undo combine" landing between them could produce a
  // file whose rows were filtered on one set of links and whose duplicate disclosure named the
  // dates of another. Concurrency is what was traded away: the keep is now awaited before the
  // row query starts. That is one round trip, against three fewer queries and a file that can
  // no longer contradict itself.
  const { keepsReconciled, handoverDates } = await getReconciliationBoundary(userId);
  return buildTaxExport(await taxRows(userId, keepsReconciled), year, handoverDates);
}

/** The years this reader has something to export for, most recent first. */
export async function getTaxYears(userId: string): Promise<number[]> {
  // Only the keep is needed here (a year list names no dates), so this keeps the single-output
  // wrapper rather than resolving three views it would discard.
  return taxYearsWithTags(await taxRows(userId, await getReconciliationTxnKeep(userId)));
}
