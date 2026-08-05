'use client';

/**
 * Declare a reserve (C.23 / H.4) — the owner's third source of fixed money:
 * *"money being reserved every month for home repair"*, and yearly dues he
 * divides by 12 by hand.
 *
 * THE READER TYPES THE WHOLE COST, NOT THE MONTHLY SHARE. That is the one design
 * decision this form embodies: removing the division IS the feature, and a
 * stored monthly figure would also lose the fact that $100 is a twelfth of
 * something — which is the only way its line can explain itself beside a real
 * bill on the Fixed list.
 *
 * Same mutation recipe as `GoalForm` (#164/#166, `mutation-form-recipe`):
 * explicit `onSubmit` into the server action, own busy flag, deadline-bounded
 * await, full reload on success. Here the recipe is load-bearing rather than
 * merely conventional — this form has a `<select>`, and React 19's form-action
 * auto-reset would snap it back to its first option (MONTHLY) on a validation
 * failure, so a reader fixing a typo on a YEARLY reserve would resubmit it at
 * twelve times its true monthly cost without seeing the control move.
 */
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { createReserve, type ReserveFormResult } from '@/server/reserve-actions';
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

export function ReserveForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ReserveFormResult | null>(null);
  const [serial, setSerial] = useState(0);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const res = await withDeadline(createReserve(null, fd), FORM_ACTION_DEADLINE_MS);
      setResult(res);
      setSerial((n) => n + 1);
      if (res.ok) {
        // The re-rendered Fixed list is the confirmation that cannot lie: the
        // reserve either appears as a line inside the total, or it does not.
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

  const err = result?.errors;
  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-2" data-testid="reserve-form">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          What it&apos;s for
          <input
            name="name"
            required
            aria-invalid={err?.name ? true : undefined}
            aria-describedby={err?.name ? 'reserve-error-name' : undefined}
            className={`w-44 ${inputCls}`}
            placeholder="Home repair"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Whole cost $
          <input
            name="amount"
            required
            inputMode="decimal"
            aria-invalid={err?.amount ? true : undefined}
            aria-describedby={err?.amount ? 'reserve-error-amount' : undefined}
            className={`w-28 ${inputCls}`}
            placeholder="1200"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          How often
          <select
            name="cadence"
            defaultValue="ANNUAL"
            aria-invalid={err?.cadence ? true : undefined}
            aria-describedby={err?.cadence ? 'reserve-error-cadence' : undefined}
            className={`w-40 ${inputCls}`}
            data-testid="reserve-cadence"
          >
            <option value="MONTHLY">Every month</option>
            <option value="QUARTERLY">Every 3 months</option>
            <option value="SEMIANNUAL">Twice a year</option>
            <option value="ANNUAL">Once a year</option>
          </select>
        </label>
        <Button type="submit" size="sm" disabled={busy} data-testid="reserve-create">
          {busy ? 'Adding…' : 'Add reserve'}
        </Button>
      </div>
      {/* A whole-form refusal (the demo fence) is not a typo — it gets its own
          line rather than being pinned to a field the reader filled correctly. */}
      {result?.error ? (
        <p className="text-xs text-red-500" role="alert" data-testid="reserve-form-error">
          {result.error}
        </p>
      ) : null}
      <FieldError id="reserve-error-name" message={err?.name} />
      <FieldError id="reserve-error-amount" message={err?.amount} />
      <FieldError id="reserve-error-cadence" message={err?.cadence} />
      <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
        {result?.ok ? `Reserve added — it's in your fixed costs above.${serial % 2 ? '​' : ''}` : ''}
      </p>
    </form>
  );
}
