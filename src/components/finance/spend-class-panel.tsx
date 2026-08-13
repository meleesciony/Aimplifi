'use client';

/**
 * Fixed vs guilt-free spending on /budgets (DECISIONS #376/#377; per
 * transaction as of #397, 2026-08-03).
 *
 * Every transaction is classified individually — the reader's verdict on the
 * row, else the app's guess (recurring-bill merchant → fixed, else the
 * category's taxonomy flag). A category whose rows split appears in BOTH
 * lists with that side's subtotal. There is no category-level designation:
 * the dial lives on each register row and the transaction detail page.
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
  loanPaymentNotes,
  handoverNote,
}: {
  fixed: SpendClassFixedRow[];
  guiltFree: SpendClassCategoryRow[];
  /** Calendar month ("YYYY-MM") for heading → register deep links (W.7). */
  month: string;
  /**
   * C.13 critic P1-1: the loan payments that count HERE and not in the By-category
   * list below (C.25 / #403 excludes them there so those figures still sum to
   * their own register link; this split keeps them so ITS link still matches).
   * REQUIRED, not optional — the whole defect was one of the two lists carrying
   * the explanation while the other printed a contradicting figure in silence,
   * and an optional prop reads as "nothing to say" at exactly the caller that
   * forgot to pass it. Empty array = nothing moved, and the panel says nothing.
   */
  loanPaymentNotes: readonly string[];
  /**
   * U.29: `breakdownHandoverDayCopy(count, false)` from the caller, or `null`
   * when this reader has no released handover row in either list this month
   * (the common case). REQUIRED for the same reason `loanPaymentNotes` is —
   * an optional prop reads as "nothing to disclose" at exactly the caller
   * that forgot to compute it, and this panel is the one surface U.16's
   * sweep never reached.
   */
  handoverNote: string | null;
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
        Each transaction is classed on its own: recurring bills land in Fixed,
        everything else follows its category — and a category can appear in
        both lists when its rows split. Change any row from its Fixed /
        Discretionary selector in Transactions. Set a monthly target under By
        category to lock a Fixed line&apos;s amount; otherwise we use typical
        spend.
      </p>
      {loanPaymentNotes.map((note) => (
        <p
          key={note}
          className="mt-2 text-xs text-muted-foreground"
          data-testid="spend-class-loan-payment-basis"
        >
          {note}
        </p>
      ))}
      {handoverNote != null && (
        <p className="mt-2 text-xs text-muted-foreground" data-testid="spend-class-handover-note">
          {handoverNote}
        </p>
      )}

      <ClassList
        title="Fixed expenses"
        testId="spend-class-fixed"
        rows={fixed}
        empty="No fixed spending this month yet — recurring bills land here by default, and you can mark any transaction Fixed in Transactions."
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
