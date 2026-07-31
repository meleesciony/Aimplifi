'use server';

/**
 * Manual transaction entry (cash, checks, anything a feed missed).
 * Session + account ownership verified; categorized through the same pipeline
 * as ingested rows; audit-logged. Balances are provider-authoritative and are
 * NOT mutated here (docs/DECISIONS.md).
 */
import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { type PreparedTxn, prepareManualTransaction } from '@/lib/engine/transactions/manual';
import {
  parseTransactionCsv,
  prepareImportedTransaction,
} from '@/lib/engine/transactions/csv-import';
import { pickAssistedCategory } from '@/lib/engine/categorize/llm';
import { DEMO_ENTRY_BLOCKED, isDemoUser } from '@/lib/demo-user';
import { auditLog, requireUserId } from '@/server/authz';
import { assistUnsureRows } from '@/server/categorize-assist';
import { categorizeSuggestFor } from '@/server/categorize-suggest';
import { loadUserRules } from '@/server/rules';
import { getThresholdTuning } from '@/server/tuning';
import { logCategoryPredictions } from '@/server/predictions';
import { assertOwnedCategory, getCategoryRenames, getCustomCategories } from '@/server/category-meta';
import { refuseManualWriteToSuperseded } from '@/server/reconciliation';
import { refreshRecurringForUser } from '@/server/recurring';
import { getProvider } from '@/lib/providers/demo';
import { isoDate } from '@/lib/dates';

/**
 * Best-effort recurring re-detection after a manual write (#251) — the same
 * post-ingest hook Plaid/SimpleFIN run. Without it, a manual-entry user's detected
 * ScheduledTransaction rows (and any income-pause confirmation lifecycle: the
 * projection exclusion, stale-confirmation cleanup on a resumed deposit) would only
 * update on the NEXT provider sync that never comes — the "returns automatically
 * when a new deposit arrives" copy claim depends on this hook. Failures are
 * swallowed: the entry itself must never fail because re-detection did.
 */
async function refreshRecurringBestEffort(userId: string): Promise<void> {
  try {
    await refreshRecurringForUser(userId, isoDate(getProvider().today(userId)));
  } catch {
    // best-effort (the plaid.ts precedent) — the write already succeeded.
  }
}

export interface AddTxnResult {
  ok: boolean;
  /** Inline field errors surfaced under the form (never the app error boundary). */
  errors?: string[];
}

export async function createManualTransaction(
  _prev: AddTxnResult | null,
  formData: FormData,
): Promise<AddTxnResult> {
  const userId = await requireUserId();
  // Demo manual-entry fence (#243 follow-up): a typed real amount + raw
  // descriptor + date must never persist to the shared demo row (and the
  // descriptor must never reach the categorize pipeline's optional LLM).
  if (isDemoUser(userId)) return { ok: false, errors: [DEMO_ENTRY_BLOCKED] };

  const accountId = String(formData.get('accountId') ?? '');
  const categoryRaw = String(formData.get('categoryId') ?? '').trim();
  const descriptor = String(formData.get('descriptor') ?? '');
  const amount = String(formData.get('amount') ?? '');
  const dateStr = String(formData.get('date') ?? '');
  const direction = String(formData.get('direction') ?? 'out') === 'in' ? 'in' : 'out';

  const account = await prisma.account.findFirst({ where: { id: accountId, userId } });
  if (!account) return { ok: false, errors: ['That account wasn’t found — refresh and try again.'] };

  // Superseded-predecessor fence (slice-6 critics B-F2/C-4): a hand-typed row on a
  // reconciled predecessor dated after its cutover is dropped by the boundary — money the
  // user entered that no figure would reflect, a silent dropped figure. Predecessors are
  // read-only history; the pickers exclude them and this guard closes the direct path.
  const supersededRefusal = await refuseManualWriteToSuperseded(userId, accountId);
  if (supersededRefusal) return { ok: false, errors: [supersededRefusal] };

  // An EXPLICIT category must be a known system id or a custom this user owns —
  // a foreign/garbage id would otherwise be trusted into the row (DECISIONS #111).
  // Auto-detect (empty) skips this; the pipeline only yields system ids.
  if (categoryRaw) {
    try {
      await assertOwnedCategory(userId, categoryRaw);
    } catch (e) {
      // assertOwnedCategory throws exactly 'Choose a valid category' for a
      // not-owned id; anything else (e.g. a DB blip) is unexpected — don't
      // mislabel it "category not found" (#170 P2).
      return e instanceof Error && e.message === 'Choose a valid category'
        ? { ok: false, errors: ['That category wasn’t found — pick one from the list.'] }
        : { ok: false, errors: ['Something went wrong — please try again.'] };
    }
  }
  const [rules, tuning] = await Promise.all([loadUserRules(userId), getThresholdTuning(userId)]);

  // prepareManualTransaction validates the amount/date/description and THROWS on
  // bad input — a non-numeric or non-positive amount, a malformed date. Those are
  // reachable from the form (the amount box is free text), so catch them into an
  // inline field error instead of letting them hit the app error boundary
  // (#170 — finishing the reliable-mutation pass; matches the goal/budget forms).
  let prepared: PreparedTxn;
  try {
    prepared = prepareManualTransaction(
      {
        descriptor,
        amount,
        direction,
        date: dateStr,
        accountId,
        categoryId: categoryRaw || null,
      },
      rules,
      // The engine re-checks ids for defense in depth but only knows the system
      // set; a custom id is a per-user cuid. Pass exactly the one id that
      // assertOwnedCategory just verified above (regression #136).
      categoryRaw ? new Set([categoryRaw]) : undefined,
      tuning.flaggedBps,
    );
  } catch (e) {
    // Map the engine's (sometimes technical) validation throws to a friendly,
    // non-leaky hint. Amount is the only free-form numeric input; date is a
    // native date picker but can still be cleared/malformed.
    const msg = e instanceof Error ? e.message : '';
    const friendly = /amount/i.test(msg)
      ? 'Enter a positive dollar amount, like 12.50.'
      : /date/i.test(msg)
        ? 'Enter a valid calendar date.'
        : 'Please check your entries and try again.';
    return { ok: false, errors: [friendly] };
  }

  // When the user didn't dictate a category, let the optional LLM assist an
  // UNKNOWN merchant (DECISIONS #38). No ANTHROPIC_API_KEY → null → the
  // deterministic result stands unchanged (demo-mode invariant).
  let categoryId = prepared.categoryId;
  let confidenceBps = prepared.confidenceBps;
  let needsReview = prepared.needsReview;
  // Provenance to log (Why-This-Category §3.1): the pipeline's source, stamped
  // 'llm' when the assist overlay auto-files. Undefined when the user dictated a
  // category (confidence 10000 → never logged as a prediction).
  let source = prepared.source;
  if (!categoryRaw) {
    // categorizeSuggestFor carries BOTH the demo fence (#242 P1-1/F1: a demo
    // visitor's typed descriptor never egresses, on any deployment) and the
    // Trust Center audit sink (§3.2).
    const llm = await categorizeSuggestFor(userId)({
      rawDescriptor: prepared.rawDescriptor,
      amountCents: prepared.amountCents,
    });
    const picked = pickAssistedCategory(
      {
        categoryId: prepared.categoryId ?? 'uncategorized',
        confidenceBps: prepared.confidenceBps ?? 0,
        needsReview: prepared.needsReview,
      },
      llm,
    );
    categoryId = picked.categoryId;
    confidenceBps = picked.confidenceBps;
    if (picked.source === 'llm') {
      needsReview = false; // a confident LLM pick auto-files
      source = 'llm';
    }
  }

  const createdRow = await prisma.transaction.create({
    data: {
      accountId: prepared.accountId,
      date: prepared.date,
      amountCents: prepared.amountCents,
      rawDescriptor: prepared.rawDescriptor,
      categoryId,
      confidenceBps,
      status: prepared.status,
      needsReview,
      isTransfer: prepared.isTransfer,
      // O.15 slice 6 — a rule's tag action, on a row that is brand new and so has
      // no tag of its own to protect. Written only when a rule with the action
      // actually filed the row; the pipeline decided that, not this call site.
      ...(prepared.taxClassStamp ? { taxClass: prepared.taxClassStamp } : {}),
    },
  });
  // Log the pipeline/LLM verdict for the accuracy metric + threshold tuning
  // (DECISIONS #190). An EXPLICIT user category carries confidence 10000 and is
  // skipped inside the helper — the user dictating a category is not a prediction.
  await logCategoryPredictions(userId, [
    { transactionId: createdRow.id, categoryId, confidenceBps, source },
  ]);

  await auditLog(userId, 'transaction.create.manual', {
    accountId,
    amountCents: prepared.amountCents,
    needsReview: prepared.needsReview,
  });

  await refreshRecurringBestEffort(userId);

  revalidatePath('/transactions');
  revalidatePath('/triage');
  // Return success; the client navigates to /transactions (a full navigation, so
  // the register can't show stale state) — NOT a server redirect, so the form
  // stays a plain onSubmit + reload recipe like GoalForm (#170).
  return { ok: true };
}

export interface ImportResult {
  ok: boolean;
  imported: number;
  skipped: number;
  errors: string[];
}

/**
 * Bulk CSV import (useActionState shape). Parses, categorizes each row through
 * the standard pipeline, and inserts the valid ones; malformed rows are skipped
 * and reported by line number. Like manual entry, this records activity only —
 * it does not mutate account balances (DECISIONS #24).
 */
export async function importTransactionsCsv(
  _prev: ImportResult | null,
  formData: FormData,
): Promise<ImportResult> {
  const userId = await requireUserId();
  // Demo manual-entry fence (#243 follow-up): a pasted CSV is bulk REAL
  // statement rows — the highest-volume leak of the four typed/uploaded paths.
  if (isDemoUser(userId)) return { ok: false, imported: 0, skipped: 0, errors: [DEMO_ENTRY_BLOCKED] };

  const accountId = String(formData.get('accountId') ?? '');
  const account = await prisma.account.findFirst({ where: { id: accountId, userId } });
  if (!account) return { ok: false, imported: 0, skipped: 0, errors: ['Account not found'] };

  // Superseded-predecessor fence (slice-6 critics B-F2/C-4) — same rule as manual entry:
  // imported rows landing on a reconciled predecessor would be silently dropped figures.
  const supersededRefusal = await refuseManualWriteToSuperseded(userId, accountId);
  if (supersededRefusal) return { ok: false, imported: 0, skipped: 0, errors: [supersededRefusal] };

  const text = String(formData.get('csv') ?? '');
  if (!text.trim()) {
    return { ok: false, imported: 0, skipped: 0, errors: ['Paste CSV content first.'] };
  }

  // A CSV "category" column may name one of the user's custom categories ("Golf"),
  // or a built-in they RENAMED (O.17) — resolve both to their id alongside the
  // canonical system names (DECISIONS #111).
  //
  // The rename half is not a nicety: /api/export writes the reader's own label
  // into this column, so without it a user who exports, edits in Excel and
  // re-imports their own file gets every renamed row resolved to `null` — which
  // is not an error, it is a silent hand-off to the auto-categorizer, re-filing
  // their rows into a different category (both O.17 critics, independently).
  // A rename can never equal another visible category's name (the rename door
  // refuses that), so adding these keys cannot make a name ambiguous.
  const [custom, renames] = await Promise.all([
    getCustomCategories(userId),
    getCategoryRenames(userId),
  ]);
  const customByName = new Map(custom.map((c) => [c.name.toLowerCase(), c.id]));
  for (const [categoryId, name] of renames) customByName.set(name.toLowerCase(), categoryId);
  const { rows, errors } = parseTransactionCsv(text, customByName);
  const [rules, tuning] = await Promise.all([loadUserRules(userId), getThresholdTuning(userId)]);
  const prepared = rows.map((row) => {
    const p = prepareImportedTransaction(row, accountId, rules, tuning.flaggedBps);
    return {
      // Pre-assigned id so the prediction log correlates provenance by KEY, not by
      // createManyAndReturn row order (which SQLite/Prisma do not contractually
      // guarantee) — critic P1-2. Survives the assistUnsureRows spread.
      id: randomUUID(),
      accountId,
      date: p.date,
      amountCents: p.amountCents,
      rawDescriptor: p.rawDescriptor,
      categoryId: p.categoryId,
      confidenceBps: p.confidenceBps,
      status: p.status,
      needsReview: p.needsReview,
      isTransfer: p.isTransfer,
      // O.15 slice 6 — the rule's tag action, carried through the LLM-assist
      // spread to the write below. Assist only ever changes the CATEGORY of a row
      // no rule settled, and a row no rule settled carries no stamp, so the two
      // can never contradict each other.
      taxClassStamp: p.taxClassStamp ?? null,
      // Provenance for the prediction log (Why-This-Category §3.1). NOT a
      // Transaction column — stripped before the DB write below, carried only to
      // logCategoryPredictions. assistUnsureRows may stamp it 'llm'.
      source: p.source,
    };
  });

  // LLM-assist unsure rows at ingest (DECISIONS #42): a confident suggestion
  // auto-files instead of landing in review. No ANTHROPIC_API_KEY → suggest
  // returns null → rows unchanged (demo stays deterministic + credential-free).
  // categorizeSuggestFor: demo fence (rows stand unchanged, no egress) + §3.2 audit sink.
  const data = await assistUnsureRows(prepared, categorizeSuggestFor(userId));

  if (data.length > 0) {
    // Project to Transaction columns only (`source` is NOT one) before the DB
    // write; each row carries its pre-assigned id, so the prediction log below
    // reads straight off `data` — no reliance on returned-row order (critic P1-2).
    await prisma.transaction.createMany({
      data: data.map((r) => ({
        id: r.id,
        accountId: r.accountId,
        date: r.date,
        amountCents: r.amountCents,
        rawDescriptor: r.rawDescriptor,
        categoryId: r.categoryId,
        confidenceBps: r.confidenceBps,
        status: r.status,
        needsReview: r.needsReview,
        isTransfer: r.isTransfer,
        // O.15 slice 6 — see the manual-entry write above; same reasoning, same
        // brand-new row with no tag to protect.
        ...(r.taxClassStamp ? { taxClass: r.taxClassStamp } : {}),
      })),
    });
    // Log each pipeline/LLM verdict + its provenance for the accuracy metric +
    // threshold tuning (DECISIONS #190) and Why-This-Category (§3.1). Rows whose
    // category the CSV dictated carry confidence 10000 and are skipped in the helper.
    await logCategoryPredictions(
      userId,
      data.map((r) => ({
        transactionId: r.id,
        categoryId: r.categoryId,
        confidenceBps: r.confidenceBps,
        source: r.source,
      })),
    );
  }

  await auditLog(userId, 'transaction.import.csv', {
    accountId,
    imported: data.length,
    skipped: errors.length,
  });
  if (data.length > 0) await refreshRecurringBestEffort(userId);
  revalidatePath('/transactions');
  revalidatePath('/triage');

  return {
    ok: data.length > 0,
    imported: data.length,
    skipped: errors.length,
    errors: errors.map((e) => `Line ${e.line}: ${e.message}`),
  };
}
