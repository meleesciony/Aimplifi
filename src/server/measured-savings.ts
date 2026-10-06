/**
 * Loader for "Money you set aside" (DECISIONS #790): the measured-savings engine on the
 * exact inputs "Money you put in" reads (`loadDepositInputs` — the finance snapshot's
 * rows with the reconciliation boundary applied, live accounts, institution names and
 * record coverage), against the plan's savings line the caller already holds.
 */
import { measureSavings, type MeasuredSavings } from '@/lib/engine/savings/measured';
import { loadDepositInputs } from '@/server/investment-deposits';

export async function getMeasuredSavings(userId: string, plannedSavingsCents: number): Promise<MeasuredSavings> {
  return measureSavings({ deposit: await loadDepositInputs(userId), plannedSavingsCents });
}
