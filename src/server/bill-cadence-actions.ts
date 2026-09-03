'use server';

/**
 * Change a repeating bill's cadence. Overlay only: name, amount, detection,
 * and loan identity stay put. Demo cannot learn. Loans refused.
 */
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { auditLog, requireUserId } from '@/server/authz';
import { DEMO_ENTRY_BLOCKED, isDemoUser } from '@/lib/demo-user';
import {
  MAX_BILL_KEY,
  billCadenceError,
  billRenameKey,
} from '@/lib/engine/spending-plan/bill-rename';
import { getSpendingPlan } from '@/server/spending-plan';

export interface BillCadenceResult {
  ok: boolean;
  error?: string;
  errors?: { cadence?: string };
}

function revalidateBillCadenceSurfaces(): void {
  revalidatePath('/spending-plan');
  revalidatePath('/settings');
  revalidatePath('/budgets');
  revalidatePath('/dashboard');
}

export async function updateBillCadence(
  billKey: string,
  formData: FormData,
): Promise<BillCadenceResult> {
  const userId = await requireUserId();
  if (isDemoUser(userId)) return { ok: false, error: DEMO_ENTRY_BLOCKED };

  const key = typeof billKey === 'string' ? billKey.trim() : '';
  if (!key || key.length > MAX_BILL_KEY) {
    return { ok: false, error: "That bill isn't on your plan, so nothing changed." };
  }

  const raw = String(formData.get('cadence') ?? '');
  const cadenceErr = billCadenceError(raw);
  if (cadenceErr) return { ok: false, errors: { cadence: cadenceErr } };
  const cadence = raw.trim();

  const plan = await getSpendingPlan(userId);
  const line = plan.fixedList.lines.find(
    (l) => l.kind === 'recurring-bill' && l.billKey === key,
  );
  if (!line) {
    return { ok: false, error: "That bill isn't on your plan, so nothing changed." };
  }
  if (line.loanPayment) {
    return { ok: false, error: 'A loan payment stays at the cadence the plan lists.' };
  }
  const row = plan.fixedLineItems.find((r) => billRenameKey(r) === key);
  if (!row) {
    return { ok: false, error: "That bill isn't on your plan, so nothing changed." };
  }

  await prisma.billCadence.upsert({
    where: { userId_billKey: { userId, billKey: key } },
    create: { userId, billKey: key, cadence },
    update: { cadence },
  });
  await auditLog(userId, 'bill.updateCadence', { billKey: key, cadence });
  revalidateBillCadenceSurfaces();
  return { ok: true };
}

export async function clearBillCadence(billKey: string): Promise<BillCadenceResult> {
  const userId = await requireUserId();
  if (isDemoUser(userId)) return { ok: false, error: DEMO_ENTRY_BLOCKED };

  const key = typeof billKey === 'string' ? billKey.trim() : '';
  if (!key || key.length > MAX_BILL_KEY) {
    return { ok: false, error: 'That rhythm is already what the app detected.' };
  }

  const deleted = await prisma.billCadence.deleteMany({ where: { userId, billKey: key } });
  if (deleted.count === 0) {
    return { ok: false, error: 'That rhythm is already what the app detected.' };
  }
  await auditLog(userId, 'bill.clearCadence', { billKey: key });
  revalidateBillCadenceSurfaces();
  return { ok: true };
}
