'use server';

/**
 * H.9 — the reader names the payee whose checking/savings/card charges pay a
 * LOAN/MORTGAGE down. Never inferred. Demo fenced (shared row must not learn).
 */
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { DEMO_ENTRY_BLOCKED, isDemoUser } from '@/lib/demo-user';
import { ACCOUNT_NOT_FOUND } from '@/lib/engine/account/display-name';
import {
  isLoanPaymentHistoryAccount,
  PAYMENT_MERCHANT_ACCOUNT_NOT_ELIGIBLE,
  PAYMENT_MERCHANT_NOT_IN_ACTIVITY,
} from '@/lib/engine/account/loan-payment-history';
import { resolveRegisterPayee } from '@/server/transactions';
import { auditLog, rateLimitDurable, requireUserId } from '@/server/authz';

export interface SetPaymentMerchantResult {
  ok: boolean;
  errors?: string[];
}

export async function setAccountPaymentMerchant(input: {
  accountId: string;
  /** Painted payee name as it appears in activity. Null / empty clears. */
  payee: string | null;
}): Promise<SetPaymentMerchantResult> {
  const userId = await requireUserId();
  if (isDemoUser(userId)) return { ok: false, errors: [DEMO_ENTRY_BLOCKED] };
  if (!(await rateLimitDurable(`payment-merchant:${userId}`, 20, 60_000))) {
    return { ok: false, errors: ['Too many updates just now — try again in a minute.'] };
  }
  if (typeof input.accountId !== 'string' || (input.payee !== null && typeof input.payee !== 'string')) {
    return { ok: false, errors: [ACCOUNT_NOT_FOUND] };
  }

  const account = await prisma.account.findFirst({
    where: { id: input.accountId, userId },
    select: { id: true, type: true },
  });
  if (!account) return { ok: false, errors: [ACCOUNT_NOT_FOUND] };
  if (!isLoanPaymentHistoryAccount(account.type)) {
    return { ok: false, errors: [PAYMENT_MERCHANT_ACCOUNT_NOT_ELIGIBLE] };
  }

  const trimmed = input.payee?.trim() ?? '';
  if (trimmed === '') {
    await prisma.account.update({ where: { id: account.id }, data: { paymentMerchantId: null } });
    await auditLog(userId, 'account.paymentMerchant.clear', { id: account.id });
    revalidatePath('/accounts');
    return { ok: true };
  }

  const exact = await resolveRegisterPayee(userId, trimmed);
  if (exact === null) {
    return { ok: false, errors: [PAYMENT_MERCHANT_NOT_IN_ACTIVITY] };
  }

  const merchant = await prisma.merchant.upsert({
    where: { canonical: exact },
    create: { canonical: exact },
    update: {},
    select: { id: true },
  });
  await prisma.account.update({
    where: { id: account.id },
    data: { paymentMerchantId: merchant.id },
  });
  await auditLog(userId, 'account.paymentMerchant.set', { id: account.id, merchantId: merchant.id });
  revalidatePath('/accounts');
  return { ok: true };
}
