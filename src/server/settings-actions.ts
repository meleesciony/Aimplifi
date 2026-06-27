'use server';

/**
 * Money Dials mutation (per-user settings / onboarding). Session + row-ownership
 * verified, validated through the pure engine, audit-logged. Changing these
 * dials re-derives the FI numbers, the life-energy view, and — when the payment
 * account changes — the entire cash-needed answer, so every page that reads them
 * is revalidated.
 */
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { auditLog, requireUserId } from '@/server/authz';
import {
  PAYMENT_ACCOUNT_TYPES,
  encodeDials,
  validateDials,
  type FieldErrors,
  type RawDials,
} from '@/lib/engine/settings/dials';

export interface DialsResult {
  ok: boolean;
  /** Per-field messages when validation failed. */
  errors?: FieldErrors;
}

const PAYMENT_TYPES: readonly string[] = PAYMENT_ACCOUNT_TYPES;

export async function updateMoneyDials(
  _prev: DialsResult | null,
  formData: FormData,
): Promise<DialsResult> {
  const userId = await requireUserId();

  // Eligible payment sources: the user's own checking/savings accounts. Built
  // from a row-ownership-scoped query so validateDials' membership check is also
  // the ownership check (an id outside this set is rejected).
  const owned = await prisma.account.findMany({
    where: { userId },
    select: { id: true, type: true },
  });
  const eligible = owned.filter((a) => PAYMENT_TYPES.includes(a.type));

  const raw: RawDials = {
    wage: String(formData.get('wage') ?? ''),
    swr: String(formData.get('swr') ?? ''),
    expectedReturn: String(formData.get('expectedReturn') ?? ''),
    moneyDials: String(formData.get('moneyDials') ?? ''),
    paymentAccountId: String(formData.get('paymentAccountId') ?? ''),
    currentAge: String(formData.get('currentAge') ?? ''),
    retirementAge: String(formData.get('retirementAge') ?? ''),
    endAge: String(formData.get('endAge') ?? ''),
    inflation: String(formData.get('inflation') ?? ''),
  };

  const result = validateDials(raw, eligible);
  if (!result.ok) return { ok: false, errors: result.errors };

  const {
    hourlyWageCents,
    swrBps,
    expectedReturnBps,
    moneyDials,
    paymentAccountId,
    currentAge,
    retirementAge,
    endAge,
    inflationBps,
  } = result.value;
  await prisma.user.update({
    where: { id: userId },
    data: {
      hourlyWageCents,
      swrBps,
      expectedReturnBps,
      // Empty list stored as null (the "unset" state parseStoredDials reads as []).
      moneyDials: encodeDials(moneyDials),
      paymentAccountId,
      // Null = "unset, use the default" (DECISIONS #123) — keeps demo/golden unchanged.
      currentAge,
      retirementAge,
      endAge,
      inflationBps,
    },
  });

  await auditLog(userId, 'settings.dials.update', {
    swrBps,
    expectedReturnBps,
    hasWage: hourlyWageCents !== null,
    dialCount: moneyDials.length,
    paymentAccountId,
    hasRetirementPlan:
      currentAge !== null || retirementAge !== null || endAge !== null || inflationBps !== null,
  });

  // Re-derive everything that depends on these dials.
  revalidatePath('/settings');
  revalidatePath('/dashboard');
  revalidatePath('/coach');
  revalidatePath('/cards');
  revalidatePath('/accounts');
  revalidatePath('/investments'); // the retirement outlook reads the planning dials

  return { ok: true };
}
