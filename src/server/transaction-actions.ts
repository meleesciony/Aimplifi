'use server';

/**
 * Manual transaction entry (cash, checks, anything a feed missed).
 * Session + account ownership verified; categorized through the same pipeline
 * as ingested rows; audit-logged. Balances are provider-authoritative and are
 * NOT mutated here (docs/DECISIONS.md).
 */
import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { prisma, serializableTx } from '@/lib/db';
import { type PreparedTxn, prepareManualTransaction } from '@/lib/engine/transactions/manual';
import {
  parseCsvImportNewAccount,
  parseTransactionCsv,
  planCsvCategoryApply,
  planCsvDedupe,
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
import { refuseManualWriteToSuperseded, getReconciliationTxnKeep } from '@/server/reconciliation';
import { registerRowWhere } from '@/server/transactions';
import { refreshRecurringForUser } from '@/server/recurring';
import { SPENDING_ACCOUNT_TYPES } from '@/lib/engine/transactions/query';
import { getProvider } from '@/lib/providers/demo';
import { type ISODate, isoDate } from '@/lib/dates';

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
      ...(prepared.spendClassStamp
        ? { spendClassOverride: prepared.spendClassStamp }
        : {}),
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
  revalidatePath('/transactions/import');
  revalidatePath('/triage');
  // Return success; the client navigates to /transactions (a full navigation, so
  // the register can't show stale state) — NOT a server redirect, so the form
  // stays a plain onSubmit + reload recipe like GoalForm (#170).
  return { ok: true };
}

export interface ImportResult {
  ok: boolean;
  imported: number;
  /** File rows the account already holds and the import did not create (H.2). */
  duplicates: number;
  /**
   * Existing rows whose category was rewritten from an explicit CSV category
   * (Simplifi export during standup). 0 when the file has no category column.
   */
  recategorized: number;
  /**
   * Kept rows whose (date, amount) key occurs ≥2 times in the FILE itself
   * (critic P1-1). The classic shape is two overlapping exports pasted
   * together; a well-formed export never contains it. Shown as an amber
   * warning — never a block: two genuine same-day same-amount charges are
   * legitimate, and the key cannot tell them apart (the count is the hint).
   */
  repeatedRows: number;
  skipped: number;
  /** Earliest date the account's register history now reaches, register basis — null when no rows were added. */
  historyReachesDate: string | null;
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
  if (isDemoUser(userId)) {
    return { ok: false, imported: 0, duplicates: 0, recategorized: 0, repeatedRows: 0, skipped: 0, historyReachesDate: null, errors: [DEMO_ENTRY_BLOCKED] };
  }

  let accountId = String(formData.get('accountId') ?? '').trim();
  let account = accountId
    ? await prisma.account.findFirst({ where: { id: accountId, userId } })
    : null;
  if (!account) {
    if (accountId) {
      return { ok: false, imported: 0, duplicates: 0, recategorized: 0, repeatedRows: 0, skipped: 0, historyReachesDate: null, errors: ['Account not found'] };
    }
    const parsed = parseCsvImportNewAccount(
      String(formData.get('newAccountName') ?? ''),
      String(formData.get('newAccountType') ?? ''),
      String(formData.get('newAccountBalance') ?? ''),
    );
    if (!parsed.ok) {
      return { ok: false, imported: 0, duplicates: 0, recategorized: 0, repeatedRows: 0, skipped: 0, historyReachesDate: null, errors: [parsed.error] };
    }
    account = await prisma.account.create({
      data: {
        userId,
        provider: 'manual',
        name: parsed.name,
        type: parsed.type,
        currentBalanceCents: parsed.currentBalanceCents,
        currency: 'USD',
        mask: null,
      },
    });
    accountId = account.id;
    await auditLog(userId, 'account.manual.create', {
      id: account.id,
      type: parsed.type,
      currentBalanceCents: parsed.currentBalanceCents,
      via: 'csv-import',
    });
  }
  // Critic P2-2 residual: the picker only offers register accounts, but crafted
  // FormData could name any account — fence the WRITE to the same basis
  // (SPENDING_ACCOUNT_TYPES + USD-or-null, the register's own where) so imported
  // POSTED rows always land where a reader can see them (K.3: write basis =
  // reader basis).
  if (
    !SPENDING_ACCOUNT_TYPES.includes(account.type) ||
    (account.currency !== null && account.currency !== 'USD')
  ) {
    return {
      ok: false,
      imported: 0,
      duplicates: 0,
      recategorized: 0,
      repeatedRows: 0,
      skipped: 0,
      historyReachesDate: null,
      errors: ['Imported rows appear in the register — choose a checking, savings, or credit account.'],
    };
  }

  // Superseded-predecessor fence (slice-6 critics B-F2/C-4) — same rule as manual entry:
  // imported rows landing on a reconciled predecessor would be silently dropped figures.
  const supersededRefusal = await refuseManualWriteToSuperseded(userId, accountId);
  if (supersededRefusal) {
    return { ok: false, imported: 0, duplicates: 0, recategorized: 0, repeatedRows: 0, skipped: 0, historyReachesDate: null, errors: [supersededRefusal] };
  }

  const text = String(formData.get('csv') ?? '');
  if (!text.trim()) {
    return { ok: false, imported: 0, duplicates: 0, recategorized: 0, repeatedRows: 0, skipped: 0, historyReachesDate: null, errors: ['Paste CSV content first.'] };
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
  const [rules, tuning, keeps] = await Promise.all([
    loadUserRules(userId),
    getThresholdTuning(userId),
    getReconciliationTxnKeep(userId),
  ]);

  // H.2 overlap dedupe — BEFORE any preparation work: fetch this account's own
  // rows across the file's date span (index-backed, @@index([accountId, date]))
  // and let the engine planner say which lines are genuinely new. The key is
  // (date, signed amount) — descriptor excluded BY DESIGN so bank-export text
  // matches provider-synced rows whose rawDescriptor differs (the engine doc
  // spells the cases out). The R1 keep is applied to the MATCH SET, so a
  // reconciliation-disowned row never suppresses a visible re-add — an import
  // is a reader asking for this history back, and a writer must see what its
  // readers see (H.8).
  //
  // Two reads by design (critic P2-4): this first read is a PLANNING snapshot
  // that decides which rows pay for prepare + LLM assist below; the
  // authoritative check-then-act re-runs the plan inside a serializableTx
  // right before the write, where a concurrent import's commit surfaces as a
  // P2034 retry against fresh state — closing the concurrent-double-import
  // race (double-click, two tabs) that Postgres at READ COMMITTED would let
  // mint duplicate rows. While the store only GROWS (the import-vs-import race
  // this closes), the in-tx re-plan can only SUBTRACT from this plan's keep
  // set — no import is ever missed. A concurrent DELETE could make plan2 keep
  // a row plan1 dropped; the loop below skips it (plan1Keep guard), so the
  // result is a countable under-import that a re-import repairs — never a
  // double-import, the dangerous direction (critic round-2 edge).
  let rowsToImport = rows;
  let duplicates = 0;
  let repeatedRows = 0;
  let categoryApplies: { transactionId: string; categoryId: string }[] = [];
  let spanMin: ISODate | null = null;
  let spanMax: ISODate | null = null;
  let plan1Keep: boolean[] | null = null;
  if (rows.length > 0) {
    spanMin = rows[0].date;
    spanMax = rows[0].date;
    for (const r of rows) {
      if (r.date < spanMin) spanMin = r.date;
      if (r.date > spanMax) spanMax = r.date;
    }
    const existing = await prisma.transaction.findMany({
      where: { accountId, date: { gte: spanMin, lte: spanMax } },
      select: { id: true, date: true, amountCents: true, categoryId: true },
    });
    const visibleExisting = existing
      .filter((r) => keeps(accountId, r.date))
      .map((r) => ({
        id: r.id,
        date: r.date as ISODate,
        amountCents: r.amountCents,
        categoryId: r.categoryId,
      }));
    const plan1 = planCsvDedupe(
      rows.map((r) => ({ date: r.date, amountCents: r.amountCents })),
      visibleExisting,
    );
    plan1Keep = plan1.keep;
    rowsToImport = rows.filter((_, i) => plan1.keep[i]);
    duplicates = plan1.duplicates;
    repeatedRows = plan1.repeatedRows;
    categoryApplies = planCsvCategoryApply(rows, visibleExisting, plan1.keep);
  }

  const prepared = rowsToImport.map((row) => {
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
      spendClassStamp: p.spendClassStamp ?? null,
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

  // Phase 2 — the authoritative check-then-act inside SERIALIZABLE isolation
  // (critic P2-4). `data` is aligned with `rowsToImport` in file order; the
  // fresh snapshot re-plans and only the rows it still keeps are created. The
  // whole fn is DB-only (prepare/assist ran above, outside the tx), so a P2034
  // retry re-runs cleanly against post-race state.
  let createdRows: typeof data = [];
  if (data.length > 0) {
    const out = await serializableTx(async (tx) => {
      const fresh = await tx.transaction.findMany({
        where: { accountId, date: { gte: spanMin!, lte: spanMax! } },
        select: { date: true, amountCents: true },
      });
      const plan2 = planCsvDedupe(
        rows.map((r) => ({ date: r.date, amountCents: r.amountCents })),
        fresh
          .filter((r) => keeps(accountId, r.date))
          .map((r) => ({ date: r.date as ISODate, amountCents: r.amountCents })),
      );
      const toCreate: typeof data = [];
      let kept = 0;
      for (let i = 0; i < rows.length; i++) {
        if (!plan1Keep![i]) continue; // plan1 dropped it — never prepared
        const row = data[kept]!;
        kept++;
        // plan2's keep is a subset of plan1's (the store only grows), so every
        // row reached here was prepared and assist-evaluated exactly once.
        if (plan2.keep[i]) toCreate.push(row);
      }
      if (toCreate.length > 0) {
        // Project to Transaction columns only (`source` is NOT one) before the
        // write; each row carries its pre-assigned id, so the prediction log
        // reads straight off `data` — no reliance on returned-row order (critic P1-2).
        await tx.transaction.createMany({
          data: toCreate.map((r) => ({
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
            ...(r.spendClassStamp ? { spendClassOverride: r.spendClassStamp } : {}),
          })),
        });
      }
      return { created: toCreate, duplicates: plan2.duplicates, repeatedRows: plan2.repeatedRows };
    });
    createdRows = out.created;
    duplicates = out.duplicates;
    repeatedRows = out.repeatedRows;
    // Log each pipeline/LLM verdict + its provenance for the accuracy metric +
    // threshold tuning (DECISIONS #190) and Why-This-Category (§3.1). Rows whose
    // category the CSV dictated carry confidence 10000 and are skipped in the helper.
    // After the tx (created rows only): the log must never fail an already-committed
    // import, and rows a concurrent import beat us to were never created.
    await logCategoryPredictions(
      userId,
      createdRows.map((r) => ({
        transactionId: r.id,
        categoryId: r.categoryId,
        confidenceBps: r.confidenceBps,
        source: r.source,
      })),
    );
  }

  // Duplicate rows with an explicit CSV category take that category on the
  // existing register row (Simplifi wins classification during standup).
  // Just this once: a Correction, no merchant rule.
  let recategorized = 0;
  if (categoryApplies.length > 0) {
    recategorized = await serializableTx(async (tx) => {
      let n = 0;
      for (const a of categoryApplies) {
        const fresh = await tx.transaction.findFirst({
          where: { id: a.transactionId, account: { userId } },
        });
        if (!fresh || fresh.categoryId === a.categoryId) continue;
        await tx.correction.create({
          data: {
            userId,
            transactionId: fresh.id,
            fromCategoryId: fresh.categoryId,
            toCategoryId: a.categoryId,
          },
        });
        await tx.transaction.update({
          where: { id: fresh.id },
          data: {
            categoryId: a.categoryId,
            needsReview: false,
            confidenceBps: 9900,
            reviewPinned: false,
            ...(a.categoryId === 'transfer' ? { isTransfer: true as const } : {}),
          },
        });
        n++;
      }
      return n;
    });
  }

  // H.2 depth confirmation: after a successful import, the account's earliest
  // KEPT register row is the "history now reaches" fact — computed on the SAME
  // basis as the /accounts depth line (registerRowWhere + the R1 keep) so the
  // two surfaces agree by construction (K.3/H.8: one fact, one basis).
  let historyReachesDate: string | null = null;
  if (createdRows.length > 0) {
    const floorRows = await prisma.transaction.findMany({
      where: { accountId, ...registerRowWhere(userId) },
      select: { date: true },
    });
    for (const r of floorRows) {
      if (keeps(accountId, r.date) && (historyReachesDate === null || r.date < historyReachesDate)) {
        historyReachesDate = r.date;
      }
    }
  }

  await auditLog(userId, 'transaction.import.csv', {
    accountId,
    imported: createdRows.length,
    duplicates,
    recategorized,
    repeatedRows,
    skipped: errors.length,
    historyReachesDate,
  });
  if (createdRows.length > 0) await refreshRecurringBestEffort(userId);
  revalidatePath('/transactions');
  revalidatePath('/triage');
  // The /accounts depth line ("History available from …") must re-read the new
  // floor — the card that told the user their history was shallow is the card
  // that must show it deepened (H.2).
  revalidatePath('/accounts');

  revalidatePath('/dashboard');
  return {
    ok: createdRows.length > 0 || duplicates > 0 || recategorized > 0,
    imported: createdRows.length,
    duplicates,
    recategorized,
    repeatedRows,
    skipped: errors.length,
    historyReachesDate,
    errors: errors.map((e) => `Line ${e.line}: ${e.message}`),
  };
}
