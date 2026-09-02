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
import { prisma, serializableTx } from '@/lib/db';
import { parseDollarInput } from '@/lib/money';
import { auditLog, requireUserId } from '@/server/authz';
import { monthlyRateCents } from '@/lib/engine/spending-plan/plan';
import {
  isReserveCadence,
  MAX_RESERVE_COST_CENTS,
  MAX_RESERVE_NAME,
  MAX_RESERVES_PER_USER,
  RESERVE_KIND,
  reserveNameError,
} from '@/lib/engine/spending-plan/reserves';
import { PAYMENT_ACCOUNT_TYPES } from '@/lib/engine/settings/dials';
import { DEMO_ENTRY_BLOCKED, isDemoUser } from '@/lib/demo-user';
import { getSpendingPlan } from '@/server/spending-plan';
import { activeSupersededPredecessorIds } from '@/server/reconciliation';
import { overrideKey } from '@/lib/engine/recurring/override';

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
  // C.23 / DECISIONS #431: the Fixed-costs settings card renders the same
  // figure (`reserveMonthlyCents` + the basis total), so the write moves it.
  revalidatePath('/settings');
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
  const nameErr = reserveNameError(name);
  if (nameErr) errors.name = nameErr;
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

  // Critic P2-6: the count cap and the create are check-then-act, so they run in
  // ONE serializable transaction — two concurrent submits (double-click, two
  // tabs) must not both pass the cap and store a 51st reserve. The convert path
  // already uses this idiom; the typed form joins it.
  const written = await serializableTx(async (tx): Promise<ReserveFormResult> => {
    const existing = await tx.goal.count({ where: { userId, kind: RESERVE_KIND } });
    if (existing >= MAX_RESERVES_PER_USER) {
      return {
        ok: false,
        error: `You can keep ${MAX_RESERVES_PER_USER} reserves at once — remove one to add another.`,
      };
    }
    await tx.goal.create({
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
    return { ok: true };
  });
  if (!written.ok) return written;
  await auditLog(userId, 'reserve.create', { name, cadence });
  revalidateReserveSurfaces();
  return { ok: true };
}


/**
 * Rename a reserve already on the plan. The dollars and cadence stay put —
 * this write is a NAME, never a money figure. Converted reserves keep the
 * merchant's spelling until the household types their own.
 *
 * Same fences as create: demo cannot learn, only `kind = reserve` rows of
 * the caller, empty / over-cap names refused in words.
 */
export async function renameReserve(
  goalId: string,
  formData: FormData,
): Promise<ReserveFormResult> {
  const userId = await requireUserId();
  if (isDemoUser(userId)) return { ok: false, error: DEMO_ENTRY_BLOCKED };
  const name = String(formData.get('name') ?? '').trim();
  const nameErr = reserveNameError(name);
  if (nameErr) return { ok: false, errors: { name: nameErr } };

  const updated = await prisma.goal.updateMany({
    where: { id: goalId, userId, kind: RESERVE_KIND },
    data: { name },
  });
  if (updated.count === 0) {
    return { ok: false, error: "That reserve isn't on your plan, so nothing changed." };
  }
  await auditLog(userId, 'reserve.rename', { goalId, name });
  revalidateReserveSurfaces();
  return { ok: true };
}

/**
 * Change a typed reserve's true cost. Name, cadence, and convert pairing
 * stay put. Converted (bill-paired) reserves are refused — the swap is
 * exact, so the cost stays with the bill. Demo cannot learn.
 */
export async function updateReserveCost(
  goalId: string,
  formData: FormData,
): Promise<ReserveFormResult> {
  const userId = await requireUserId();
  if (isDemoUser(userId)) return { ok: false, error: DEMO_ENTRY_BLOCKED };

  const id = typeof goalId === 'string' ? goalId.trim() : '';
  if (!id) {
    return { ok: false, error: "That reserve isn't on your plan, so nothing changed." };
  }

  const row = await prisma.goal.findFirst({
    where: { id, userId, kind: RESERVE_KIND },
    select: { cadence: true, merchantCanonical: true },
  });
  if (!row) {
    return { ok: false, error: "That reserve isn't on your plan, so nothing changed." };
  }
  if (row.merchantCanonical) {
    return {
      ok: false,
      error: 'This reserve is paired with a bill, so the cost stays with that bill. Remove it to start over.',
    };
  }

  const amount = String(formData.get('amount') ?? '').trim();
  const errors: NonNullable<ReserveFormResult['errors']> = {};
  const trueCostCents = parseDollarInput(amount);
  if (trueCostCents === null || trueCostCents <= 0) {
    errors.amount = 'Enter the whole cost, above $0 — like 1200 or $1,200.';
  } else if (trueCostCents > MAX_RESERVE_COST_CENTS) {
    errors.amount = 'That is larger than this field can hold — enter the cost of one item.';
  } else if (isReserveCadence(row.cadence) && monthlyRateCents(trueCostCents, row.cadence) === 0) {
    errors.amount = 'Spread over that period this comes to less than a cent a month — enter the whole cost.';
  }
  if (errors.amount) return { ok: false, errors };

  const updated = await prisma.goal.updateMany({
    where: { id, userId, kind: RESERVE_KIND, merchantCanonical: null },
    data: { targetCents: trueCostCents! },
  });
  if (updated.count === 0) {
    return { ok: false, error: "That reserve isn't on your plan, so nothing changed." };
  }
  await auditLog(userId, 'reserve.updateCost', { goalId: id, trueCostCents });
  revalidateReserveSurfaces();
  return { ok: true };
}

export async function deleteReserve(goalId: string): Promise<void> {
  const userId = await requireUserId();
  // The shared-demo fence, same rule as every reserve write (critic P2-3): the
  // demo row is ONE row for every visitor, so a delete here would act on
  // everyone's shared data. Dormant today (the demo can never create a reserve
  // — both creators are fenced and the seed writes none), stated because the
  // fence belongs to the write, not to what it happens to match right now.
  if (isDemoUser(userId)) return;

  // Critic P1-2 — deleting a reserve created by the convert lever is the UNDO
  // of the conversion, and the undo is the WHOLE pair: the reserve row AND the
  // NOT_BILL override it was created with, in ONE transaction. Leaving the
  // override standing would keep the bill out of detection forever — the bill
  // is real, but it would sit in NO figure (Fixed understates, guilt-free
  // overshoots by the bill's rate: the dangerous direction). The override
  // removal resolves the FOLDED key (overrideKey), so a case-differing legacy
  // row (the O.13c residual) cannot survive to outvote the restored detection.
  // A crash mid-way is impossible: both rows commit or neither does.
  const result = await serializableTx(async (tx) => {
    // Scoped by kind as well as owner: this action may not touch a savings
    // goal even if a caller hands it one's id.
    const goal = await tx.goal.findFirst({
      where: { id: goalId, userId, kind: RESERVE_KIND },
      select: { id: true, merchantCanonical: true },
    });
    if (goal === null) return null;
    if (goal.merchantCanonical !== null) {
      const allOverrides = await tx.recurringOverride.findMany({
        where: { userId },
        select: { merchantCanonical: true },
      });
      const toRemove = allOverrides
        .map((r) => r.merchantCanonical)
        .filter((c) => overrideKey(c) === overrideKey(goal.merchantCanonical as string));
      if (toRemove.length > 0) {
        await tx.recurringOverride.deleteMany({
          where: { userId, merchantCanonical: { in: toRemove } },
        });
      }
    }
    await tx.goal.deleteMany({ where: { id: goalId, userId, kind: RESERVE_KIND } });
    return goal;
  });
  if (result === null) return; // not the caller's reserve — nothing to undo, nothing to log
  await auditLog(userId, 'reserve.delete', { goalId });
  // The override removal also moves /recurring — detection re-runs there too.
  revalidateReserveSurfaces();
  revalidatePath('/recurring');
}

// ---------------------------------------------------------------------------
// C.23 guided half (DECISIONS #431) — the convert lever and the holding home.
// ---------------------------------------------------------------------------

/**
 * Name the account the monthly reserve set-aside lives in (" — set aside in
 * Checking"). A NAME, never a transfer: no write in this path moves money.
 *
 * The same eligibility the Settings page's own pickers apply (CHECKING/SAVINGS
 * only — a card is a liability and an investment account is a different
 * commitment; PAYMENT_ACCOUNT_TYPES) plus the reconciliation fence: a superseded
 * predecessor is remapped to its successor by the boundary, so naming the folded
 * twin invites the reader to "set aside in" an account that no longer carries
 * their balance. Cleared with `null` — the clause then prints nothing.
 */
export interface HoldingAccountResult {
  ok: boolean;
  error?: string;
}

// File-local, never `export`ed: Next's "use server" contract allows only async
// functions and types to leave this file, and nothing outside it reads these —
// the same idiom as `MAX_MERCHANT_KEY_LEN` below (refusal copy rides with the
// action that returns it; the repo's shared-const homes are plain modules).
const HOLDING_ACCOUNT_INVALID =
  'Choose one of your checking or savings accounts — that one is no longer available.';

export async function setReserveHoldingAccount(
  accountId: string | null,
): Promise<HoldingAccountResult> {
  const userId = await requireUserId();
  // Shared-demo fence (same rule as every reserve write): the demo account is
  // one row for every visitor, and the home they named would read as the next
  // visitor's own.
  if (isDemoUser(userId)) return { ok: false, error: DEMO_ENTRY_BLOCKED };

  if (accountId === null || accountId.trim() === '') {
    await prisma.user.update({ where: { id: userId }, data: { reserveHoldingAccountId: null } });
    await auditLog(userId, 'reserve.holdingAccount.clear', {});
    revalidatePath('/settings');
    return { ok: true };
  }

  // Critic P2-4: the validity read and the write are check-then-act, so they run
  // in ONE serializable transaction. The account read sits INSIDE the tx: an
  // account delete committing mid-flight then conflicts with this tx's read
  // (P2034 → retry re-reads a gone account → refused), where the old shape
  // could write a dangling id after the delete committed.
  const written = await serializableTx(async (tx): Promise<boolean> => {
    const account = await tx.account.findFirst({
      // Spread out of the readonly tuple: Prisma's `in` takes a mutable array.
      where: { id: accountId, userId, type: { in: [...PAYMENT_ACCOUNT_TYPES] } },
      select: { id: true },
    });
    if (!account) return false;
    const superseded = await activeSupersededPredecessorIds([userId]);
    if (superseded.has(accountId)) return false;
    await tx.user.update({ where: { id: userId }, data: { reserveHoldingAccountId: accountId } });
    return true;
  });
  if (!written) return { ok: false, error: HOLDING_ACCOUNT_INVALID };
  await auditLog(userId, 'reserve.holdingAccount.set', { accountId });
  revalidatePath('/settings');
  return { ok: true };
}

/**
 * THE CONVERT LEVER (DECISIONS #431): "turn this yearly bill into a monthly
 * reserve" — the owner's own case, verbatim: *"The way I personally categorize
 * yearly membership dues is I divide by 12 and put that cash aside."*
 *
 * The write is TWO things committed together, so a crash cannot leave the
 * money counted twice:
 *   1. a reserve row holding the series' OWN true cost and cadence (the app
 *      divides — never a retyped monthly figure), and
 *   2. a `RecurringOverride NOT_BILL` for the series' canonical, which removes
 *      it from detection output entirely (`detect.ts:399-403`), so the union
 *      stops emitting its row.
 * The swap is EXACT by construction (see `proposeFixedSetup`): in-basis series
 * leave the union at the same `monthlyRateCents` the reserve enters at, and
 * genuinely-out series add exactly their smoothed rate.
 *
 * WHY THE COUNT NEVER HAPPENS TWICE, EVEN AS TIME PASSES (critic P1-1): the
 * series' own charges would otherwise re-enter the category ROLLUP the moment
 * one lands inside the 3-month window (a taxonomy-fixed category keeps the rows
 * fixed-classified after the demote), and the category average would count the
 * money AND the reserve would — the exact "covered → would count it twice"
 * state the lever exists to avoid, reached by time instead of by state. The
 * reserve row carries `merchantCanonical`, and `getSpendingPlan` excludes those
 * canonicals from the rollup (and its /budgets re-derivation) entirely — the
 * reserve is the money's only count, for as long as the reserve exists. The
 * undo is the whole pair too: `deleteReserve` withdraws the override with the
 * goal, so the bill returns to detection and every figure with it.
 *
 * WHY THE LOOKUP GOES THROUGH THE PLAN: the lever's exactness was verified with
 * the loader's own arrays and sets, so the write re-derives the verdict from
 * the SAME `getSpendingPlan` the settings card rendered — a client-asserted
 * "this is convertible" is never trusted. The proposal row carries the prefill;
 * a missing or non-convertible row refuses in words.
 */
export interface ReserveFromSeriesResult {
  ok: boolean;
  error?: string;
}

const RESERVE_SERIES_GONE =
  'That payee is no longer detected as a repeating bill, so nothing changed.';
// One refusal for every absent state, but ONE honest sentence (critic P2-2):
// the same message previously said "already counted in your fixed costs" — true
// for a covered row, FALSE for a row the loader offered but a drift guard then
// refused (a cost whose monthly share rounds to $0, a name past the reserve
// limit). A refusal that names the wrong reason teaches the reader to distrust
// every refusal; say what is true of all of them: the swap cannot be made.
const RESERVE_SERIES_NOT_CONVERTIBLE =
  "That payee can't become a reserve right now, so nothing changed.";
const RESERVE_SERIES_DUPLICATE =
  'A reserve with this name and amount already exists — that would count the money twice.';
const RESERVE_SERIES_ALREADY_RESERVED =
  'This payee is already set aside as a reserve — remove it on your plan page to start over.';

/** The same accepted-key length `setRecurringOverride` enforces, checked before
 *  the write so a forged client cannot pass a key the override store would then
 *  refuse. */
const MAX_MERCHANT_KEY_LEN = 200;

export async function createReserveFromSeries(
  merchantCanonical: string,
): Promise<ReserveFromSeriesResult> {
  const userId = await requireUserId();
  if (isDemoUser(userId)) return { ok: false, error: DEMO_ENTRY_BLOCKED };
  const canonical = typeof merchantCanonical === 'string' ? merchantCanonical.trim() : '';
  if (canonical === '' || canonical.length > MAX_MERCHANT_KEY_LEN) {
    return { ok: false, error: RESERVE_SERIES_GONE };
  }

  const plan = await getSpendingPlan(userId);
  const proposal = plan.fixedSetup.bills.find((b) => b.merchantCanonical === canonical);
  if (
    proposal === undefined ||
    proposal.convertibleToReserve !== true ||
    proposal.convertInput === null
  ) {
    // One refusal for every absent state, named once: a row that does not exist,
    // a row that is not convertible (covered / loan / MONTHLY / no name), and a
    // row that WAS convertible on the page but is no longer (a concurrent
    // convert) all mean the same thing here — the swap would not be exact.
    return { ok: false, error: RESERVE_SERIES_NOT_CONVERTIBLE };
  }
  const { name, trueCostCents, cadence } = proposal.convertInput;
  if (
    name.length > MAX_RESERVE_NAME ||
    trueCostCents <= 0 ||
    trueCostCents > MAX_RESERVE_COST_CENTS ||
    !isReserveCadence(cadence) ||
    monthlyRateCents(trueCostCents, cadence) === 0
  ) {
    // The loader produced the prefill, so this is a guard against a future
    // engine drift — refused the same way the form refuses, never written
    // around (a reserve the plan cannot count must not be creatable at all).
    return { ok: false, error: RESERVE_SERIES_NOT_CONVERTIBLE };
  }

  // Check-then-act in ONE serializable transaction (the `serializableTx`
  // idiom, household-actions.ts): the count cap and the duplicate triple are
  // re-checked here, and the reserve + the NOT_BILL demotion commit together —
  // a partial write would count the series' money twice.
  const written = await serializableTx(async (tx): Promise<ReserveFromSeriesResult> => {
    const existing = await tx.goal.count({ where: { userId, kind: RESERVE_KIND } });
    if (existing >= MAX_RESERVES_PER_USER) {
      return {
        ok: false,
        error: `You can keep ${MAX_RESERVES_PER_USER} reserves at once — remove one to add another.`,
      };
    }
    const duplicate = await tx.goal.findFirst({
      where: { userId, kind: RESERVE_KIND, name, targetCents: trueCostCents, cadence },
    });
    if (duplicate) return { ok: false, error: RESERVE_SERIES_DUPLICATE };
    // Critic round-2 P2-3: one canonical may carry ONE reserve. Two detected
    // series can share a canonical (two accounts, two cadences — the union key
    // comment says so), and the demotion pair is keyed on the canonical alone:
    // a second converted reserve would share the one NOT_BILL, and deleting
    // either would sever the other's pair — the double count this design
    // exists to forbid. The detection suppression makes the SEQUENTIAL second
    // convert unreachable (the NOT_BILL kills both proposals); this closes the
    // CONCURRENT race inside the same tx as the other check-then-acts.
    const sameCanonical = await tx.goal.findFirst({
      where: { userId, kind: RESERVE_KIND, merchantCanonical: canonical },
      select: { id: true },
    });
    if (sameCanonical) return { ok: false, error: RESERVE_SERIES_ALREADY_RESERVED };
    await tx.goal.create({
      data: {
        userId,
        name,
        kind: RESERVE_KIND,
        // The WHOLE cost, once per cadence — the app divides, never the reader.
        targetCents: trueCostCents,
        cadence,
        savedCents: 0,
        // NEVER a contribution: a reserve inside `goalContributionsCents` would
        // be committed once as savings and again as Fixed.
        monthlyContributionCents: null,
        // Critic P1-1/P1-2: the convert link. The rollup excludes this
        // canonical (the reserve is the money's only count) and deleteReserve
        // uses it to withdraw the paired override (the undo is the WHOLE pair).
        merchantCanonical: canonical,
      },
    });
    // The demotion, written the same shape `setRecurringOverride` stores (same
    // key, same columns) — a NOT_BILL instruction has no cadence by definition.
    //
    // Critic P1-3 (the O.13c residual): the table's unique constraint keys
    // EXACT bytes, while the engine's override map keys the FOLDED spelling
    // (overrideKey) and keeps the FIRST row by createdAt. A case-differing
    // legacy row for this payee would make this exact-bytes upsert MINT a
    // second, contradictory row — and the older BILL row would outvote the new
    // NOT_BILL, so the series would keep detecting while the reserve counts it:
    // a silent, permanent double count with `ok: true` reported. Collision rows
    // are removed FIRST (same tx), then the one exact-bytes row is upserted —
    // after this write, one row states the reader's intent and it is the row
    // every folded-key read resolves.
    const allOverrides = await tx.recurringOverride.findMany({
      where: { userId },
      select: { merchantCanonical: true },
    });
    const collisionRows = allOverrides
      .map((r) => r.merchantCanonical)
      .filter((c) => c !== canonical && overrideKey(c) === overrideKey(canonical));
    if (collisionRows.length > 0) {
      await tx.recurringOverride.deleteMany({
        where: { userId, merchantCanonical: { in: collisionRows } },
      });
    }
    await tx.recurringOverride.upsert({
      where: { userId_merchantCanonical: { userId, merchantCanonical: canonical } },
      create: { userId, merchantCanonical: canonical, decision: 'NOT_BILL', cadence: null },
      update: { decision: 'NOT_BILL', cadence: null },
    });
    return { ok: true };
  });

  if (!written.ok) return written;
  await auditLog(userId, 'reserve.createFromSeries', { merchantCanonical: canonical, name, cadence });
  // The demotion also moves /recurring — every other surface the write moves
  // is covered by revalidateReserveSurfaces (incl. /settings, C.23).
  revalidateReserveSurfaces();
  revalidatePath('/recurring');
  return { ok: true };
}
