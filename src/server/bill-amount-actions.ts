'use server';

/**
 * Change or clear a repeating bill's monthly amount. Overlay only: name,
 * cadence, detection, and loan identity stay put. Clear deletes the overlay
 * (back to detection), not a zero. Demo cannot learn. Loans refused.
 */
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { parseDollarInput } from '@/lib/money';
import { auditLog, requireUserId } from '@/server/authz';
import { DEMO_ENTRY_BLOCKED, isDemoUser } from '@/lib/demo-user';
import {
  MAX_BILL_KEY,
  billMonthlyCentsError,
  billRenameKey,
} from '@/lib/engine/spending-plan/bill-rename';
import { getSpendingPlan } from '@/server/spending-plan';
import { getRecurring } from '@/server/recurring';

export interface BillAmountResult {
  ok: boolean;
  error?: string;
  errors?: { amount?: string };
}

function revalidateBillAmountSurfaces(): void {
  revalidatePath('/spending-plan');
  revalidatePath('/recurring');
  revalidatePath('/settings');
  revalidatePath('/budgets');
  revalidatePath('/dashboard');
}

/**
 * A billKey the household may price: on the spending-plan Fixed list, OR a
 * live expense series on Recurring / Subscriptions (same BillAmount overlay).
 * Loans stay refused when they appear on the Fixed list.
 */
async function householdOwnsBillAmountKey(
  userId: string,
  key: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const plan = await getSpendingPlan(userId);
  const line = plan.fixedList.lines.find(
    (l) => l.kind === 'recurring-bill' && l.billKey === key,
  );
  if (line) {
    if (line.loanPayment) {
      return { ok: false, error: 'A loan payment stays at the amount the plan lists.' };
    }
    if (plan.fixedLineItems.some((r) => billRenameKey(r) === key)) {
      return { ok: true };
    }
  }
  const recurring = await getRecurring(userId);
  const item = recurring.summary.items.find((i) => billRenameKey(i) === key);
  if (item && !item.isIncome) return { ok: true };
  return { ok: false, error: "That bill isn't on your plan, so nothing changed." };
}

export async function updateBillAmount(
  billKey: string,
  formData: FormData,
): Promise<BillAmountResult> {
  const userId = await requireUserId();
  if (isDemoUser(userId)) return { ok: false, error: DEMO_ENTRY_BLOCKED };

  const key = typeof billKey === 'string' ? billKey.trim() : '';
  if (!key || key.length > MAX_BILL_KEY) {
    return { ok: false, error: "That bill isn't on your plan, so nothing changed." };
  }

  const raw = String(formData.get('amount') ?? '');
  const parsed = parseDollarInput(raw);
  const amountErr = billMonthlyCentsError(parsed);
  if (amountErr) return { ok: false, errors: { amount: amountErr } };
  const monthlyCents = parsed as number;

  const owned = await householdOwnsBillAmountKey(userId, key);
  if (!owned.ok) return { ok: false, error: owned.error };

  await prisma.billAmount.upsert({
    where: { userId_billKey: { userId, billKey: key } },
    create: { userId, billKey: key, monthlyCents },
    update: { monthlyCents },
  });
  await auditLog(userId, 'bill.updateAmount', { billKey: key, monthlyCents });
  revalidateBillAmountSurfaces();
  return { ok: true };
}

export async function clearBillAmount(billKey: string): Promise<BillAmountResult> {
  const userId = await requireUserId();
  if (isDemoUser(userId)) return { ok: false, error: DEMO_ENTRY_BLOCKED };

  const key = typeof billKey === 'string' ? billKey.trim() : '';
  if (!key || key.length > MAX_BILL_KEY) {
    return { ok: false, error: 'That amount is already what the app detected.' };
  }

  const deleted = await prisma.billAmount.deleteMany({ where: { userId, billKey: key } });
  if (deleted.count === 0) {
    return { ok: false, error: 'That amount is already what the app detected.' };
  }
  await auditLog(userId, 'bill.clearAmount', { billKey: key });
  revalidateBillAmountSurfaces();
  return { ok: true };
}
