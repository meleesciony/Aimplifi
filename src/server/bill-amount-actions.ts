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

export interface BillAmountResult {
  ok: boolean;
  error?: string;
  errors?: { amount?: string };
}

function revalidateBillAmountSurfaces(): void {
  revalidatePath('/spending-plan');
  revalidatePath('/settings');
  revalidatePath('/budgets');
  revalidatePath('/dashboard');
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

  const plan = await getSpendingPlan(userId);
  const line = plan.fixedList.lines.find(
    (l) => l.kind === 'recurring-bill' && l.billKey === key,
  );
  if (!line) {
    return { ok: false, error: "That bill isn't on your plan, so nothing changed." };
  }
  if (line.loanPayment) {
    return { ok: false, error: 'A loan payment stays at the amount the plan lists.' };
  }
  const row = plan.fixedLineItems.find((r) => billRenameKey(r) === key);
  if (!row) {
    return { ok: false, error: "That bill isn't on your plan, so nothing changed." };
  }

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
