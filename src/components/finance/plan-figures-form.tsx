'use client';

/**
 * Plan intention dials (DECISIONS #372/#373).
 *
 * What you need to set: savings %. Income and fixed come from categorized
 * transactions. Optionally lock either as intention — when categories later
 * differ, that difference is a slide (overspend vs intention), not a silent
 * rewrite of the plan.
 */
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { cents, formatCents } from '@/lib/money';
import { updatePlanFigures } from '@/server/plan-override-actions';
import { PlanSlideNotice } from '@/components/finance/plan-slide';

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
  patternFixedCents,
  reserveMonthlyCents,
  incomeOverrideCents,
  fixedOverrideCents,
  savingsTargetBps,
  incomeSlideCents,
  fixedSlideCents,
  hasSlide,
  canEdit,
}: {
  suggestedIncomeCents: number;
  /** The pattern half of the suggestion — what this form's input replaces (C.23/H.4). */
  patternFixedCents: number;
  /** Declared reserves, added on top of any locked figure. 0 for most readers. */
  reserveMonthlyCents: number;
  incomeOverrideCents: number | null;
  fixedOverrideCents: number | null;
  savingsTargetBps: number | null;
  incomeSlideCents: number;
  fixedSlideCents: number;
  hasSlide: boolean;
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
        <h2 className="mb-1 text-sm font-semibold">Your plan</h2>
        <p className="text-xs text-muted-foreground">
          Create your own free account to set a savings % and optionally lock income or
          fixed costs — the demo is shared, so those dials stay read-only here.
        </p>
      </section>
    );
  }

  return (
    <section
      className="rounded-2xl border bg-card p-5 shadow-sm"
      data-testid="plan-figures-form"
    >
      <h2 className="mb-1 text-sm font-semibold">Your plan</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Set your savings %. Income and fixed costs already come from categorized
        transactions — you do not retype them. Lock a figure only if you want that
        intention kept when the data later differs; the difference shows as a slide
        (overspend vs intention), not a new plan.
      </p>

      <PlanSlideNotice
        hasSlide={hasSlide}
        incomeSlideCents={incomeSlideCents}
        fixedSlideCents={fixedSlideCents}
        suggestedIncomeCents={suggestedIncomeCents}
        dataFixedCents={patternFixedCents}
        incomeLocked={incomeOverrideCents != null}
        fixedLocked={fixedOverrideCents != null}
      />

      <form
        className="mt-4 space-y-3"
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
          <span className="font-medium text-foreground">Savings target (%) — set this</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            Pay yourself first before guilt-free. Not discretionary spend. Empty clears it
            (goals only).
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

        <label className="block text-sm">
          <span className="font-medium text-foreground">Monthly income — lock intention (optional)</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            From categorized paychecks: {formatCents(cents(suggestedIncomeCents))}
            {incomeOverrideCents != null
              ? ' · locked — data differences show as a slide'
              : ' · in use (no lock)'}
          </span>
          <input
            name="income"
            type="text"
            inputMode="decimal"
            defaultValue={dollarsInput(incomeOverrideCents)}
            placeholder="Leave blank to follow categories"
            className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm tabular-nums"
            data-testid="plan-income-override"
            disabled={pending}
          />
          {fieldErrors.income ? (
            <span className="mt-1 block text-xs text-rose-600">{fieldErrors.income}</span>
          ) : null}
        </label>

        <label className="block text-sm">
          <span className="font-medium text-foreground">Fixed costs — lock intention (optional)</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            From non-discretionary categories: {formatCents(cents(patternFixedCents))} —
            groceries, housing, bills; not dining out or golf
            {/* C.23/H.4: the figure above is the PATTERN half, which is all this
                input replaces. Reserves are a separate declaration and stay
                added on top of whatever is locked here — so the sentence names
                them rather than letting the reader lock a number and watch the
                fixed line come out higher. */}
            {reserveMonthlyCents > 0
              ? ` · plus ${formatCents(cents(reserveMonthlyCents))} a month you set aside, which stays added on top of any figure you lock here`
              : ''}
            {fixedOverrideCents != null
              ? ' · locked — data above this is a slide / overspend vs intention'
              : ' · in use (no lock)'}
          </span>
          <input
            name="fixed"
            type="text"
            inputMode="decimal"
            defaultValue={dollarsInput(fixedOverrideCents)}
            placeholder="Leave blank to follow categories"
            className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm tabular-nums"
            data-testid="plan-fixed-override"
            disabled={pending}
          />
          {fieldErrors.fixed ? (
            <span className="mt-1 block text-xs text-rose-600">{fieldErrors.fixed}</span>
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
          {pending ? 'Saving…' : 'Save'}
        </button>
      </form>
    </section>
  );
}
