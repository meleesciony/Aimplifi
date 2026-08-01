/**
 * Parse user-set Plan figures (DECISIONS #372). Empty clears the override so the
 * suggested pattern returns. Money is dollars-in → integer cents-out.
 */
import { parseDollarInput } from '@/lib/money';

/** Cap: $500,000/month — generous for high earners; stops garbage/paste mistakes. */
export const PLAN_OVERRIDE_MAX_CENTS = 50_000_000;

export type PlanOverrideField = 'income' | 'fixed' | 'savingsTarget';

export interface PlanOverrideFieldErrors {
  income?: string;
  fixed?: string;
  savingsTarget?: string;
}

export interface ParsedPlanOverrides {
  /** null = clear / use suggestion. */
  incomeOverrideCents: number | null;
  fixedOverrideCents: number | null;
  /** null = leave savings dial unchanged when this form omits it; see parse flag. */
  savingsTargetBps: number | null;
  /** True when the savings field was present in the submit (empty = clear). */
  savingsTargetProvided: boolean;
}

/**
 * Parse dollar strings for income/fixed overrides and an optional savings % .
 * All-or-nothing errors (report every field).
 */
export function parsePlanOverrides(raw: {
  income: string;
  fixed: string;
  savingsTarget?: string;
}): { ok: true; value: ParsedPlanOverrides } | { ok: false; errors: PlanOverrideFieldErrors } {
  const errors: PlanOverrideFieldErrors = {};

  const income = parseOptionalDollars(raw.income, 'Monthly income');
  if (!income.ok) errors.income = income.error;
  const fixed = parseOptionalDollars(raw.fixed, 'Fixed costs');
  if (!fixed.ok) errors.fixed = fixed.error;

  let savingsTargetBps: number | null = null;
  let savingsTargetProvided = false;
  if (raw.savingsTarget !== undefined) {
    savingsTargetProvided = true;
    const st = String(raw.savingsTarget).trim();
    if (st === '') {
      savingsTargetBps = null;
    } else {
      const n = Number(st);
      if (!Number.isFinite(n) || n < 0 || n > 90) {
        errors.savingsTarget = 'Savings target must be between 0 and 90.';
      } else {
        savingsTargetBps = Math.round(n * 100); // percent → bps
        if (savingsTargetBps > 9000) errors.savingsTarget = 'Savings target must be between 0 and 90.';
      }
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      incomeOverrideCents: income.ok ? income.cents : null,
      fixedOverrideCents: fixed.ok ? fixed.cents : null,
      savingsTargetBps,
      savingsTargetProvided,
    },
  };
}

function parseOptionalDollars(
  raw: string,
  label: string,
): { ok: true; cents: number | null } | { ok: false; error: string } {
  const t = raw.trim();
  if (t === '') return { ok: true, cents: null };
  const c = parseDollarInput(t);
  if (c == null) {
    return { ok: false, error: `${label} must look like dollars (e.g. 30000 or 30,000.00).` };
  }
  if (c < 0) return { ok: false, error: `${label} can’t be negative.` };
  if (c > PLAN_OVERRIDE_MAX_CENTS) {
    return { ok: false, error: `${label} must be at most $500,000.00.` };
  }
  return { ok: true, cents: c };
}
