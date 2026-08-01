'use client';

/**
 * Fixed vs guilt-free category designations on /budgets (DECISIONS #376/#377).
 * Each filed category's transactions inherit this class for Plan guilt-free.
 */
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { cents, formatCents } from '@/lib/money';
import type { SpendClassCategoryRow } from '@/lib/engine/spending-plan/spend-class';
import type { FixedAmountBasis } from '@/lib/engine/spending-plan/fixed-category-amounts';
import { setCategoryFixed } from '@/server/category-fixed-actions';

export type SpendClassFixedRow = SpendClassCategoryRow & {
  /** Monthly amount in the Plan rollup (budget target else typical). */
  planAmountCents?: number;
  planAmountBasis?: FixedAmountBasis;
};

export function SpendClassPanel({
  fixed,
  guiltFree,
  canEdit,
}: {
  fixed: SpendClassFixedRow[];
  guiltFree: SpendClassCategoryRow[];
  canEdit: boolean;
}) {
  return (
    <section
      className="rounded-2xl border bg-card p-5 shadow-sm"
      data-testid="spend-class-panel"
    >
      <h2 className="text-sm font-semibold">Fixed vs guilt-free</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Every filed transaction inherits its category&apos;s class. Fixed costs
        (utilities, groceries, rent…) come out before guilt-free. Set a monthly
        target under By category to lock a Fixed line&apos;s amount; otherwise we
        use typical spend.
      </p>
      {!canEdit ? (
        <p className="mt-2 text-xs text-muted-foreground" data-testid="spend-class-demo-note">
          Create your own free account to change these — the demo is shared, so
          designations stay as suggestions here.
        </p>
      ) : null}

      <ClassList
        title="Fixed expenses"
        testId="spend-class-fixed"
        rows={fixed}
        empty="No fixed spending this month yet — file groceries, bills, and rent and they land here by default."
        canEdit={canEdit}
        makeFixed={true}
      />
      <ClassList
        title="Guilt-free (not fixed)"
        testId="spend-class-guilt-free"
        rows={guiltFree}
        empty="No discretionary spending this month yet — dining out, entertainment, and shopping land here by default."
        canEdit={canEdit}
        makeFixed={false}
      />
    </section>
  );
}

function ClassList({
  title,
  testId,
  rows,
  empty,
  canEdit,
  makeFixed,
}: {
  title: string;
  testId: string;
  rows: SpendClassFixedRow[];
  empty: string;
  canEdit: boolean;
  /** True when this list is the Fixed column (move action → guilt-free). */
  makeFixed: boolean;
}) {
  return (
    <div className="mt-4" data-testid={testId}>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y text-sm">
          {rows.map((row) => (
            <SpendClassRow
              key={row.categoryId}
              row={row}
              canEdit={canEdit}
              /** Button moves OUT of this list. */
              moveToFixed={!makeFixed}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function SpendClassRow({
  row,
  canEdit,
  moveToFixed,
}: {
  row: SpendClassFixedRow;
  canEdit: boolean;
  moveToFixed: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <li
      className="flex items-center justify-between gap-3 py-2"
      data-testid={`spend-class-row-${row.categoryId}`}
      data-fixed={row.isFixed ? 'true' : 'false'}
      data-overridden={row.overridden ? 'true' : 'false'}
    >
      <div className="min-w-0">
        <p className="truncate font-medium">{row.name}</p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {formatCents(cents(row.spentCents))} this month
          {row.overridden ? (
            <span className="ml-1" data-testid={`spend-class-overridden-${row.categoryId}`}>
              · you set this
            </span>
          ) : (
            <span className="ml-1">· suggested</span>
          )}
        </p>
        {row.isFixed && row.planAmountCents != null && row.planAmountCents > 0 ? (
          <p
            className="text-xs text-muted-foreground tabular-nums"
            data-testid={`spend-class-plan-amount-${row.categoryId}`}
          >
            Plan uses {formatCents(cents(row.planAmountCents))}
            {row.planAmountBasis === 'budget-target' ? ' (your target)' : ' (typical)'}
          </p>
        ) : null}
        {error ? (
          <p className="text-xs text-rose-500" data-testid="spend-class-error">
            {error}
          </p>
        ) : null}
      </div>
      {canEdit ? (
        <button
          type="button"
          disabled={pending}
          data-testid={`spend-class-move-${row.categoryId}`}
          className="shrink-0 rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const res = await setCategoryFixed(row.categoryId, moveToFixed);
              if (!res.ok) {
                setError(res.error);
                return;
              }
              router.refresh();
            });
          }}
        >
          {moveToFixed ? 'Mark fixed' : 'Mark guilt-free'}
        </button>
      ) : null}
    </li>
  );
}
