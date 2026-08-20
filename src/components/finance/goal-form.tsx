'use client';

/**
 * New-goal form (#166). Validation problems ("$10,000", "abc", a missing name)
 * render as inline field errors instead of throwing to the app error boundary.
 *
 * Deliberately NOT useActionState/form-action: (a) React 19 auto-resets a
 * form-action form to its defaultValues after EVERY dispatch, wiping the
 * user's input on the very validation failure this form exists to soothe
 * (critic P1); (b) useActionState's pending rides the router's transition
 * lanes, which the Next action-application race can wedge forever — the #164
 * triage stall, reproduced here (scripts/audit-probes/budget-mutation.ts: button stuck at
 * "Setting…" with the action fully returned server-side). Instead: explicit
 * onSubmit calling the server action directly, own useState busy flag, a
 * deadline-bounded await, and a full reload on success (see onSubmit).
 * Uncontrolled inputs are untouched on failure (nothing to restore) and reset
 * explicitly on success.
 */
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { createGoal, type GoalFormResult } from '@/server/goal-actions';
import { withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';

const inputCls = 'rounded-md border bg-background px-2 py-1.5 text-sm text-foreground';

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-xs text-red-500" role="alert">
      {message}
    </p>
  );
}

export function GoalForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GoalFormResult | null>(null);
  const [serial, setSerial] = useState(0);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setBusy(true);
    try {
      const res = await withDeadline(createGoal(null, fd), FORM_ACTION_DEADLINE_MS);
      setResult(res);
      setSerial((n) => n + 1);
      if (res.ok) {
        // Full reload, not router.refresh() — see BudgetTargetForm (#166):
        // refresh()'s application was a coin-flip; the re-rendered goal card
        // is the confirmation that can't lie.
        window.location.reload();
        return;
      }
    } catch {
      // Deadline: the create usually COMMITTED and only the confirmation was
      // lost — re-sync rather than report a false failure (#164 recovery rule).
      window.location.reload();
      return;
    } finally {
      setBusy(false);
    }
  }

  const err = result?.errors;
  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-2" data-testid="goal-form">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Name
          <input
            name="name"
            required
            aria-invalid={err?.name ? true : undefined}
            aria-describedby={err?.name ? 'goal-error-name' : undefined}
            className={`w-40 ${inputCls}`}
            placeholder="Path2College"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Target $
          <input
            name="target"
            required
            inputMode="decimal"
            aria-invalid={err?.target ? true : undefined}
            aria-describedby={err?.target ? 'goal-error-target' : undefined}
            className={`w-28 ${inputCls}`}
            placeholder="8000"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Monthly $ (optional)
          <input
            name="monthly"
            inputMode="decimal"
            aria-invalid={err?.monthly ? true : undefined}
            aria-describedby={err?.monthly ? 'goal-error-monthly' : undefined}
            className={`w-28 ${inputCls}`}
            placeholder="667"
          />
        </label>
        <Button type="submit" size="sm" disabled={busy} data-testid="goal-create">
          {busy ? 'Adding…' : 'Add goal'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground" data-testid="kids-save-goal-hints">
        Kids-save targets (confirm when ready — not money already saved): Path2College
        $8,000/yr, Trump $5,000/yr, 529. Yearly ÷ 12 ≈ $667 / $417 / mo. Leave blank until
        you mean it; createGoal needs a positive target.
      </p>
      <FieldError id="goal-error-name" message={err?.name} />
      <FieldError id="goal-error-target" message={err?.target} />
      <FieldError id="goal-error-monthly" message={err?.monthly} />
      {/* Stable live region; the alternating zero-width space makes a repeat,
          textually-identical success a DOM mutation that re-announces. */}
      <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
        {result?.ok ? `Goal added — its FI effect is shown above.${serial % 2 ? '​' : ''}` : ''}
      </p>
    </form>
  );
}
