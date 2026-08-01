'use client';

/**
 * Set Plan figures by hand (DECISIONS #372). Suggestions from the engine stay
 * visible; empty fields clear an override so the suggestion returns.
 */
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { cents, formatCents } from '@/lib/money';
import { updatePlanFigures } from '@/server/plan-override-actions';

function dollarsInput(centsValue: number | null | undefined): string {
  if (centsValue == null) return '';
  return (centsValue / 100).toFixed(2);
}

function bpsToPercent(bps: number | null | undefined): string {
  if (bps == null) return '';
  return (bps / 100).toFixed(bps % 100 === 0 ? 0 : 2);
}

export function PlanFiguresForm({
  suggestedIncomeCents,
  suggestedFixedCents,
  incomeOverrideCents,
  fixedOverrideCents,
  savingsTargetBps,
  canEdit,
}: {
  suggestedIncomeCents: number;
  suggestedFixedCents: number;
  incomeOverrideCents: number | null;
  fixedOverrideCents: number | null;
  savingsTargetBps: number | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{
    income?: string;
    fixed?: string;
    savingsTarget?: string;
  }>({});

  if (!canEdit) {
    return (
      <section
        className="rounded-2xl border bg-card p-5 shadow-sm"
        data-testid="plan-figures-form"
      >
        <h2 className="mb-1 text-sm font-semibold">Your plan figures</h2>
        <p className="text-xs text-muted-foreground">
          Create your own free account to set monthly income, fixed costs, and savings % —
          the demo is shared, so those dials stay read-only here.
        </p>
      </section>
    );
  }

  return (
    <section
      className="rounded-2xl border bg-card p-5 shadow-sm"
      data-testid="plan-figures-form"
    >
      <h2 className="mb-1 text-sm font-semibold">Your plan figures</h2>
      <p className="mb-4 text-xs text-muted-foreground">
        We suggest figures from your transactions. Set your own anytime — empty a field and
        save to go back to the suggestion. Savings % is not discretionary spend; it is pay
        yourself first.
      </p>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          setFieldErrors({});
          const fd = new FormData(e.currentTarget);
          startTransition(async () => {
            const r = await updatePlanFigures(null, fd);
            if (!r.ok) {
              if (r.errors) setFieldErrors(r.errors);
              setError(r.error ?? 'Could not save — check the fields and try again.');
              return;
            }
            router.refresh();
          });
        }}
      >
        <label className="block text-sm">
          <span className="font-medium text-foreground">Monthly income</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            Suggested {formatCents(cents(suggestedIncomeCents))}
            {incomeOverrideCents != null ? ' · using your figure' : ''}
          </span>
          <input
            name="income"
            type="text"
            inputMode="decimal"
            defaultValue={dollarsInput(incomeOverrideCents)}
            placeholder={dollarsInput(suggestedIncomeCents)}
            className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm tabular-nums"
            data-testid="plan-income-override"
            disabled={pending}
          />
          {fieldErrors.income ? (
            <span className="mt-1 block text-xs text-rose-600">{fieldErrors.income}</span>
          ) : null}
        </label>

        <label className="block text-sm">
          <span className="font-medium text-foreground">Fixed costs (non-discretionary)</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            Suggested {formatCents(cents(suggestedFixedCents))} — groceries, housing, bills;
            not dining out or golf
            {fixedOverrideCents != null ? ' · using your figure' : ''}
          </span>
          <input
            name="fixed"
            type="text"
            inputMode="decimal"
            defaultValue={dollarsInput(fixedOverrideCents)}
            placeholder={dollarsInput(suggestedFixedCents)}
            className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm tabular-nums"
            data-testid="plan-fixed-override"
            disabled={pending}
          />
          {fieldErrors.fixed ? (
            <span className="mt-1 block text-xs text-rose-600">{fieldErrors.fixed}</span>
          ) : null}
        </label>

        <label className="block text-sm">
          <span className="font-medium text-foreground">Savings target (%)</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            Share of income reserved before guilt-free. Empty clears it (goals only).
          </span>
          <input
            name="savingsTarget"
            type="text"
            inputMode="decimal"
            defaultValue={bpsToPercent(savingsTargetBps)}
            placeholder="25"
            className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm tabular-nums"
            data-testid="plan-savings-target"
            disabled={pending}
          />
          {fieldErrors.savingsTarget ? (
            <span className="mt-1 block text-xs text-rose-600">{fieldErrors.savingsTarget}</span>
          ) : null}
        </label>

        {error ? (
          <p className="text-xs text-rose-600" data-testid="plan-figures-error">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background disabled:opacity-60"
          data-testid="plan-figures-save"
        >
          {pending ? 'Saving…' : 'Save plan figures'}
        </button>
      </form>
    </section>
  );
}
