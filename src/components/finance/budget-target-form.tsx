'use client';

/**
 * Set-a-monthly-target form (#166). A typo'd amount ("abc") renders an inline
 * error instead of crashing to the app error boundary (the old plain
 * form-action threw), and "$500" / "1,200" parse leniently.
 *
 * Deliberately NOT useActionState/form-action: (a) React 19 auto-resets a
 * form-action form after EVERY dispatch, snapping the category select back to
 * the first option — a user retyping a corrected amount could silently target
 * the WRONG category (critic P1); (b) useActionState's pending rides the
 * router's transition lanes, which the Next action-application race can wedge
 * forever — the #164 triage stall, reproduced on this very form
 * (scripts/audit-probes/budget-mutation.ts: "Setting…" forever with the action fully returned
 * server-side). Instead: explicit onSubmit → direct server-action call, own
 * useState busy flag, deadline-bounded await, and a full reload on
 * success (see the onSubmit comment). Uncontrolled fields persist through failure (category and
 * amount stay put); on success the amount clears and the category stays for
 * the natural set-several-targets flow.
 */
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { setBudget, type BudgetFormResult } from '@/server/budget-actions';
import { withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';

export function BudgetTargetForm({
  categoryOptions,
}: {
  categoryOptions: { id: string; name: string }[];
}) {
  const amountRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BudgetFormResult | null>(null);
  const [serial, setSerial] = useState(0);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const res = await withDeadline(setBudget(null, fd), FORM_ACTION_DEADLINE_MS);
      setResult(res);
      setSerial((n) => n + 1);
      if (res.ok) {
        // Full reload, not router.refresh(): refresh()'s RSC application was
        // a coin-flip in probes (~50% silently never landed — the row just
        // didn't appear; scripts/audit-probes/budget-mutation.ts, Next 16, transition-wrapped
        // or not). A set target is infrequent; the freshly-rendered row is
        // the one confirmation that can't lie.
        window.location.reload();
        return;
      }
    } catch {
      // Deadline: the write usually COMMITTED and only the confirmation was
      // lost — re-sync rather than report a false failure (#164 recovery rule).
      window.location.reload();
      return;
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2" data-testid="budget-target-form">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Category
          <select
            name="categoryId"
            required
            data-testid="budget-category"
            className="h-9 w-44 rounded-md border border-input bg-background px-2 text-sm text-foreground"
          >
            {categoryOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Monthly $
          <input
            ref={amountRef}
            name="amount"
            required
            inputMode="decimal"
            placeholder="500"
            data-testid="budget-amount"
            aria-invalid={result?.amountError ? true : undefined}
            aria-describedby={result?.amountError ? 'budget-amount-error' : undefined}
            className="h-9 w-28 rounded-md border border-input bg-background px-2 text-sm text-foreground"
          />
        </label>
        <Button type="submit" size="sm" disabled={busy} data-testid="budget-set">
          {busy ? 'Setting…' : 'Set target'}
        </Button>
      </div>
      {result?.amountError && (
        <p id="budget-amount-error" className="text-xs text-red-500" role="alert">
          {result.amountError}
        </p>
      )}
      <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
        {result?.ok ? `Target set — the progress bar above tracks it.${serial % 2 ? '​' : ''}` : ''}
      </p>
    </form>
  );
}
