'use server';

/**
 * Name a repeating bill on the spending plan. Overlay only: dollars, cadence,
 * merchantCanonical (exclusion / convert) stay put. Demo cannot learn.
 */
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { auditLog, requireUserId } from '@/server/authz';
import { DEMO_ENTRY_BLOCKED, isDemoUser } from '@/lib/demo-user';
import {
  MAX_BILL_KEY,
  billNameError,
  billRenameKey,
} from '@/lib/engine/spending-plan/bill-rename';
import { getSpendingPlan } from '@/server/spending-plan';
import { markMerchantNotABill } from '@/server/recurring-override-actions';

export interface BillRenameResult {
  ok: boolean;
  error?: string;
  errors?: { name?: string };
}

function revalidateBillNameSurfaces(): void {
  revalidatePath('/spending-plan');
  revalidatePath('/settings');
  revalidatePath('/budgets');
  revalidatePath('/dashboard');
}

export async function renameBill(
  billKey: string,
  formData: FormData,
): Promise<BillRenameResult> {
  const userId = await requireUserId();
  if (isDemoUser(userId)) return { ok: false, error: DEMO_ENTRY_BLOCKED };

  const key = typeof billKey === 'string' ? billKey.trim() : '';
  if (!key || key.length > MAX_BILL_KEY) {
    return { ok: false, error: "That bill isn't on your plan, so nothing changed." };
  }

  const name = String(formData.get('name') ?? '');
  const nameErr = billNameError(name);
  if (nameErr) return { ok: false, errors: { name: nameErr } };
  const trimmed = name.trim();

  const plan = await getSpendingPlan(userId);
  const line = plan.fixedList.lines.find(
    (l) => l.kind === 'recurring-bill' && l.billKey === key,
  );
  if (!line) {
    return { ok: false, error: "That bill isn't on your plan, so nothing changed." };
  }
  // The key the engine would mint for this line must match what the page sent,
  // so a forged key cannot write an overlay that later attaches to a different bill.
  const row = plan.fixedLineItems.find((r) => billRenameKey(r) === key);
  if (!row) {
    return { ok: false, error: "That bill isn't on your plan, so nothing changed." };
  }

  await prisma.billRename.upsert({
    where: { userId_billKey: { userId, billKey: key } },
    create: { userId, billKey: key, name: trimmed },
    update: { name: trimmed },
  });
  await auditLog(userId, 'bill.rename', { billKey: key, name: trimmed });
  revalidateBillNameSurfaces();
  return { ok: true };
}

export type TakeBillOffPlanResult = { ok: true } | { ok: false; error: string };

/**
 * Take a repeating bill off the spending plan. Payee bills store NOT_BILL so
 * detection stops projecting them. Unnamed bills (no merchantCanonical) store
 * a billKey overlay — detection cannot match them. Transactions stay. Loan
 * payments are refused. Demo cannot learn.
 */
export async function takeRepeatingBillOffPlan(
  billKey: string,
): Promise<TakeBillOffPlanResult> {
  const userId = await requireUserId();
  if (isDemoUser(userId)) return { ok: false, error: DEMO_ENTRY_BLOCKED };

  const key = typeof billKey === 'string' ? billKey.trim() : '';
  if (!key || key.length > MAX_BILL_KEY) {
    return { ok: false, error: "That bill isn't on your plan, so nothing changed." };
  }

  const plan = await getSpendingPlan(userId);
  const line = plan.fixedList.lines.find(
    (l) => l.kind === 'recurring-bill' && l.billKey === key,
  );
  if (!line) {
    return { ok: false, error: "That bill isn't on your plan, so nothing changed." };
  }
  if (line.loanPayment) {
    return { ok: false, error: 'A loan payment stays on the plan. That is how it is listed.' };
  }
  const row = plan.fixedLineItems.find((r) => billRenameKey(r) === key);
  if (!row) {
    return { ok: false, error: "That bill isn't on your plan, so nothing changed." };
  }
  const canonical = (row.merchantCanonical ?? '').trim();
  if (canonical) {
    const res = await markMerchantNotABill({ merchantCanonical: canonical });
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true };
  }

  await prisma.billOffPlan.upsert({
    where: { userId_billKey: { userId, billKey: key } },
    create: { userId, billKey: key },
    update: {},
  });
  await auditLog(userId, 'bill.takeOffPlan', { billKey: key });
  revalidateBillNameSurfaces();
  return { ok: true };
}
