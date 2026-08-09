'use server';

/**
 * Budget-target mutations (ROADMAP #7). Session + ownership verified, validated
 * through the pure engine, audit-logged. Budget targets are display/tracking
 * only — they feed the /budgets view and NOTHING else (not cash-needed, not FI,
 * not net worth) — so a target write perturbs no golden value.
 */
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { DEMO_ENTRY_BLOCKED, isDemoUser } from '@/lib/demo-user';
import { isBudgetable, parseBudgetTargetCents } from '@/lib/engine/budgets/status';
import { auditLog, requireUserId } from '@/server/authz';
import { assertOwnedCategory } from '@/server/category-meta';

export interface BudgetFormResult {
  ok: boolean;
  /** Inline message for the amount field when validation failed (#166). */
  amountError?: string;
  /**
   * Echoed for the form's defaultValues: React 19 resets the form after EVERY
   * dispatch, snapping the select back to the first option — a user retyping
   * a corrected amount could silently target the WRONG category (#166 critic
   * P1). categoryId is echoed on success AND failure (keep the selection);
   * amount only on failure (clear it once set).
   */
  values?: { categoryId: string; amount: string };
}

export async function setBudget(
  _prev: BudgetFormResult | null,
  formData: FormData,
): Promise<BudgetFormResult> {
  const userId = await requireUserId();
  // The demo is ONE shared row every anonymous visitor signs into: a target set
  // here would move the /budgets view for every later visitor — the typed-
  // figures leg of the shared-account rule. The /budgets UI hides the form for
  // demo (`canEdit`); this is the server-side defense in depth, mirroring every
  // other visitor-personalization write (plan overrides, reserves, dials).
  if (isDemoUser(userId)) return { ok: false, amountError: DEMO_ENTRY_BLOCKED };
  const categoryId = String(formData.get('categoryId') ?? '').trim();
  // Validate against the SAME set the UI offers (real + budgetable), so the
  // accepted set equals the offered set — a hand-crafted POST can't target
  // income/transfer/uncategorized. `isBudgetable` rejects those; `assertOwned`
  // then confirms the id is a known system category OR a custom this user owns,
  // so it can't target a foreign custom id either (DECISIONS #111). The picker
  // can't produce a bad id, so a bad one stays a throw (tamper, not typo).
  if (!isBudgetable(categoryId)) {
    throw new Error('Choose a valid spending category');
  }
  await assertOwnedCategory(userId, categoryId);
  // The amount IS free-typed — a typo gets an inline error, never a crash (#166).
  const monthCents = parseBudgetTargetCents(String(formData.get('amount') ?? ''));
  if (monthCents === null) {
    return { ok: false, amountError: 'Enter a monthly amount above $0 — like 500 or $1,200.' };
  }

  // One target per (user, category): a single atomic upsert on the compound
  // unique — structurally one row, no find-then-write race (schema @@unique).
  await prisma.budget.upsert({
    where: { userId_categoryId: { userId, categoryId } },
    update: { monthCents },
    create: { userId, categoryId, monthCents },
  });
  await auditLog(userId, 'budget.set', { categoryId, monthCents });
  revalidatePath('/budgets');
  return { ok: true };
}

export async function clearBudget(categoryId: string): Promise<void> {
  const userId = await requireUserId();
  // Same shared-account fence as setBudget: a crafted clear must not reach the
  // demo row (a throw — the UI gate makes this unreachable, so the refusal is
  // for a tampered POST, the file's own style for impossible inputs).
  if (isDemoUser(userId)) throw new Error(DEMO_ENTRY_BLOCKED);
  await prisma.budget.deleteMany({ where: { userId, categoryId } });
  await auditLog(userId, 'budget.clear', { categoryId });
  revalidatePath('/budgets');
}
