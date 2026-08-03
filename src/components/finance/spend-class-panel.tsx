'use client';

/**
 * Fixed vs guilt-free category classes on /budgets (DECISIONS #376/#377).
 * Each filed category's transactions inherit this class for Plan guilt-free.
 * Display-only since 2026-08-03: the class is deterministic (the taxonomy's
 * discretionary flag), never typed in — the manual designation dial is gone.
 */
import Link from 'next/link';
import { useEffect } from 'react';
import { cents, formatCents } from '@/lib/money';
import type { SpendClassCategoryRow } from '@/lib/engine/spending-plan/spend-class';
import {
  fixedAmountBasisClause,
  type FixedAmountBasis,
} from '@/lib/engine/spending-plan/fixed-category-amounts';
import { SPEND_CLASS_PANEL_ID } from '@/lib/engine/spending-plan/fixed-review';
import {
  CATEGORY_NAME_LINK_CLASS,
  spendClassMonthRegisterHref,
} from '@/lib/engine/transactions/links';

export type SpendClassFixedRow = SpendClassCategoryRow & {
  /** Monthly amount in the Plan rollup (budget target else typical). */
  planAmountCents?: number;
  planAmountBasis?: FixedAmountBasis;
  /** Divisor behind a typical amount (C.5/#393): months observed, ≤ window. */
  planAmountMonths?: number;
};

export function SpendClassPanel({
  fixed,
  guiltFree,
  month,
}: {
  fixed: SpendClassFixedRow[];
  guiltFree: SpendClassCategoryRow[];
  /** Calendar month ("YYYY-MM") for heading → register deep links (W.7). */
  month: string;
}) {
  // Deep link /budgets#spend-class (Plan "Review Fixed on Spending") — scroll after
  // soft nav; same-path hash clicks are handled by PlanRowActionLink.
  useEffect(() => {
    if (window.location.hash !== `#${SPEND_CLASS_PANEL_ID}`) return;
    requestAnimationFrame(() => {
      document
        .getElementById(SPEND_CLASS_PANEL_ID)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  return (
    <section
      id={SPEND_CLASS_PANEL_ID}
      className="scroll-mt-20 rounded-2xl border bg-card p-5 shadow-sm"
      data-testid="spend-class-panel"
    >
      <h2 className="text-sm font-semibold">Fixed vs guilt-free</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Every filed transaction inherits its category&apos;s class. Fixed costs
        (utilities, groceries, rent…) come out before guilt-free. Set a monthly
        target under By category to lock a Fixed line&apos;s amount; otherwise we
        use typical spend.
      </p>

      <ClassList
        title="Fixed expenses"
        testId="spend-class-fixed"
        rows={fixed}
        empty="No fixed spending this month yet — file groceries, bills, and rent and they land here by default."
        registerHref={spendClassMonthRegisterHref({
          spendClass: 'fixed',
          month,
          amountCents: 0,
        })}
      />
      <ClassList
        title="Guilt-free (not fixed)"
        testId="spend-class-guilt-free"
        rows={guiltFree}
        empty="No discretionary spending this month yet — dining out, entertainment, and shopping land here by default."
        registerHref={spendClassMonthRegisterHref({
          spendClass: 'guilt-free',
          month,
          amountCents: 0,
        })}
      />
    </section>
  );
}

function ClassList({
  title,
  testId,
  rows,
  empty,
  registerHref,
}: {
  title: string;
  testId: string;
  rows: SpendClassFixedRow[];
  empty: string;
  registerHref: string;
}) {
  return (
    <div className="mt-4" data-testid={testId}>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Link
          href={registerHref}
          className={CATEGORY_NAME_LINK_CLASS}
          data-testid={`${testId}-heading`}
        >
          {title}
        </Link>
      </h3>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y text-sm">
          {rows.map((row) => (
            <SpendClassRow key={row.categoryId} row={row} />
          ))}
        </ul>
      )}
    </div>
  );
}

function SpendClassRow({ row }: { row: SpendClassFixedRow }) {
  return (
    <li
      className="flex items-center justify-between gap-3 py-2"
      data-testid={`spend-class-row-${row.categoryId}`}
      data-fixed={row.isFixed ? 'true' : 'false'}
    >
      <div className="min-w-0">
        <p className="truncate font-medium">{row.name}</p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {formatCents(cents(row.spentCents))} this month
        </p>
        {row.isFixed && row.planAmountCents != null && row.planAmountCents > 0 ? (
          <p
            className="text-xs text-muted-foreground tabular-nums"
            data-testid={`spend-class-plan-amount-${row.categoryId}`}
          >
            Plan uses {formatCents(cents(row.planAmountCents))}
            {fixedAmountBasisClause({
              basis: row.planAmountBasis ?? 'typical-spend',
              typicalMonths: row.planAmountMonths ?? 0,
            })}
          </p>
        ) : null}
      </div>
    </li>
  );
}
