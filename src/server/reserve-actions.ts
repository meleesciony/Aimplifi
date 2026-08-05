'use server';

/**
 * Reserve mutations (C.23 / H.4) — the owner's sinking funds.
 *
 * A reserve is stored as a `Goal` row with `kind = 'reserve'`, because it is the
 * same shape (a name, an amount, a rhythm) and a second table would have to be
 * joined into every place goals are already read. What it is NOT is a savings
 * goal, and the two facts that keep it from being counted as one live here:
 * `monthlyContributionCents` is written as NULL, and `targetCents` holds the
 * TRUE COST once per `cadence` — never a monthly figure. The plan loader's
 * explicit `kind !== 'reserve'` filter is the other half; see `reserves.ts`.
 */
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { parseDollarInput } from '@/lib/money';
import { auditLog, requireUserId } from '@/server/authz';
import { monthlyRateCents } from '@/lib/engine/spending-plan/plan';
import {
  isReserveCadence,
  MAX_RESERVE_COST_CENTS,
  MAX_RESERVE_NAME,
  MAX_RESERVES_PER_USER,
  RESERVE_KIND,
} from '@/lib/engine/spending-plan/reserves';
import { DEMO_ENTRY_BLOCKED, isDemoUser } from '@/lib/demo-user';

/**
 * Every route that renders the fixed figure this write moves.
 *
 * `/dashboard` was missing (C.23 critic P1-3, executed): `SafeToSpendCard` reads
 * `plan.fixedExpensesCents`, so adding a reserve left the home page serving a
 * safe-to-spend that contradicted the plan page it was just set on. The sibling
 * action that moves the same number — `updatePlanFigures` — already revalidates
 * this exact set, which is why the omission was invisible: one list existed and
 * the new writer wrote a shorter one from memory.
 */
function revalidateReserveSurfaces(): void {
  revalidatePath('/spending-plan');
  revalidatePath('/dashboard');
  revalidatePath('/budgets');
  revalidatePath('/goals');
}

export interface ReserveFormResult {
  ok: boolean;
  /** A whole-form refusal that belongs to no field (the demo fence). Kept
   *  separate from `errors` so it is not rendered as though the reader typed
   *  something wrong — they did not. */
  error?: string;
  /** Per-field messages, rendered inline. A typo may never reach the error
   *  boundary and take the whole plan page down with it (#166). */
  errors?: { name?: string; amount?: string; cadence?: string };
}

/**
 * Create a reserve.
 *
 * Invoked DIRECTLY from the form's `onSubmit` (the #164 / mutation-form-recipe
 * pattern), never as a form action: React 19's form-action auto-reset reverts an
 * uncontrolled `<select>` to its first option on the error return, and the first
 * option here is MONTHLY — so a reader correcting an amount on an ANNUAL reserve
 * would silently resubmit it as monthly, at twelve times the truth.
 */
export async function createReserve(
  _prev: ReserveFormResult | null,
  formData: FormData,
): Promise<ReserveFormResult> {
  const userId = await requireUserId();
  // The shared-demo fence (`shared-demo-account-must-not-learn`). Every
  // anonymous visitor IS `user-demo`, so a reserve typed here — a name and an
  // amount from one stranger's real life — would appear inside the next
  // visitor's fixed costs and move their guilt-free figure. This is the
  // typed-figures leg of the rule, the same one `updatePlanFigures` applies on
  // this very page.
  if (isDemoUser(userId)) return { ok: false, error: DEMO_ENTRY_BLOCKED };
  const name = String(formData.get('name') ?? '').trim();
  const amount = String(formData.get('amount') ?? '').trim();
  const cadence = String(formData.get('cadence') ?? '').trim();

  const errors: NonNullable<ReserveFormResult['errors']> = {};
  if (!name) errors.name = 'Give the reserve a name — "Home repair", "Gym dues".';
  else if (name.length > MAX_RESERVE_NAME) {
    errors.name = `Keep the name under ${MAX_RESERVE_NAME} characters.`;
  }
  const trueCostCents = parseDollarInput(amount);
  if (trueCostCents === null || trueCostCents <= 0) {
    errors.amount = 'Enter the whole cost, above $0 — like 1200 or $1,200.';
  } else if (trueCostCents > MAX_RESERVE_COST_CENTS) {
    // `Goal.targetCents` is a Prisma `Int`, which is `integer` on the production
    // Postgres — 2,147,483,647 cents. `parseDollarInput` allows far more, so
    // without this the row is accepted on the SQLite dev/test datasource and
    // THROWS on INSERT in production, where the form's catch-all treats the
    // rejection as a lost confirmation and reloads the page showing no reserve
    // and no error (C.23 critic P1-2, executed). Refused here, in words.
    errors.amount = 'That is larger than this field can hold — enter the cost of one item.';
  } else if (isReserveCadence(cadence) && monthlyRateCents(trueCostCents, cadence) === 0) {
    // THE REMEDY HAS TO WORK. `resolveReserves` refuses a cost whose monthly
    // share rounds to nothing and the page tells the reader to remove it and add
    // it again — advice that reproduced the identical row, because the form
    // accepted any amount above zero (critic P1-3, `prevention-is-not-a-remedy`
    // inverted). Refused here, so that row can no longer be created at all.
    errors.amount = 'Spread over that period this comes to less than a cent a month — enter the whole cost.';
  }
  // Validated against the same list the engine divides by, so a value this
  // boundary lets through can never reach `monthlyRateCents`'s pass-through
  // default and be counted as monthly.
  if (!isReserveCadence(cadence)) {
    errors.cadence = 'Choose how often that cost comes around.';
  }
  if (errors.name || errors.amount || errors.cadence) return { ok: false, errors };

  const existing = await prisma.goal.count({ where: { userId, kind: RESERVE_KIND } });
  if (existing >= MAX_RESERVES_PER_USER) {
    return {
      ok: false,
      error: `You can keep ${MAX_RESERVES_PER_USER} reserves at once — remove one to add another.`,
    };
  }

  await prisma.goal.create({
    data: {
      userId,
      name,
      kind: RESERVE_KIND,
      // The WHOLE cost. The app divides — the reader never does.
      targetCents: trueCostCents!,
      cadence,
      savedCents: 0,
      // NEVER a contribution: a reserve inside `goalContributionsCents` would be
      // committed once as savings and again as Fixed.
      monthlyContributionCents: null,
    },
  });
  await auditLog(userId, 'reserve.create', { name, cadence });
  revalidateReserveSurfaces();
  return { ok: true };
}

export async function deleteReserve(goalId: string): Promise<void> {
  const userId = await requireUserId();
  // Scoped by kind as well as owner: this action may not delete a savings goal
  // even if a caller hands it one's id.
  await prisma.goal.deleteMany({ where: { id: goalId, userId, kind: RESERVE_KIND } });
  await auditLog(userId, 'reserve.delete', { goalId });
  revalidateReserveSurfaces();
}
