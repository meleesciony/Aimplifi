import Link from 'next/link';
import { ListOrdered } from 'lucide-react';
import { HANDOVER_DAY_ROW_MARKER } from '@/lib/engine/glass-box/category-breakdown';
import { cents, formatCents } from '@/lib/money';
import type { DashboardRecentResult } from '@/server/dashboard-recent';
import { SURFACE_CARD_CLASS } from '@/components/finance/surface-card-styles';
import { namedPageBack, withForwardedReturn } from '@/lib/engine/transactions/links';

/**
 * Home strip: latest spending rows, with needs-file rows highlighted.
 * Deep-links to the transaction detail / Inbox — categorization is the product loop.
 */
export function RecentTransactionsCard({ recent }: { recent: DashboardRecentResult }) {
  const { rows, needsFileCount } = recent;
  return (
    <section data-testid="dashboard-recent-transactions" className={SURFACE_CARD_CLASS}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <ListOrdered className="size-3.5 shrink-0" aria-hidden />
            Recent transactions
          </div>
          {needsFileCount > 0 ? (
            <p className="mt-1 text-sm text-warning-700 dark:text-warning-400" data-testid="dashboard-needs-file">
              <Link href="/triage" className="underline underline-offset-2 hover:text-foreground">
                {needsFileCount === 1
                  ? '1 merchant needs filing'
                  : `${needsFileCount} merchants need filing`}
              </Link>
            </p>
          ) : null}
        </div>
        <Link
          href="/transactions"
          className="shrink-0 text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          All activity
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground" data-testid="dashboard-recent-empty">
          No transactions yet. Link an account or add one by hand.
        </p>
      ) : (
        <ul className="mt-3 divide-y" data-testid="dashboard-recent-list">
          {rows.map((r) => (
            <li key={r.id}>
              <Link
                /* C.15 (audit F3): this was a bare /transactions/<id> — the
                   reader landed on a detail page whose way back said "Activity".
                   The return now names the dashboard he came from. */
                href={withForwardedReturn(
                  `/transactions/${encodeURIComponent(r.id)}`,
                  namedPageBack('dashboard', null),
                )}
                className={`flex items-center justify-between gap-3 py-2.5 text-sm transition hover:bg-muted/40 ${
                  r.needsFile ? 'bg-warning-50/80 dark:bg-warning-950/30' : ''
                }`}
                data-testid="dashboard-recent-row"
                data-needs-file={r.needsFile ? 'true' : 'false'}
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">
                    {r.merchantName}
                    {/* U.30 — same marker, same vocabulary, as every panel since
                        U.16/U.20/U.24: a fact about the row's DATE, not a claim
                        that it is the duplicate. This is the first screen a
                        reader sees, and until now it carried no reconciliation
                        vocabulary at all. */}
                    {r.onHandoverDay && (
                      <span
                        className="ml-1.5 text-xs font-normal text-muted-foreground"
                        data-testid="dashboard-recent-handover-row"
                      >
                        {HANDOVER_DAY_ROW_MARKER}
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {r.date}
                    {' · '}
                    {r.needsFile ? (
                      <span className="font-medium text-warning-700 dark:text-warning-400">Needs category</span>
                    ) : (
                      r.categoryName
                    )}
                  </p>
                </div>
                <span
                  className={`shrink-0 tabular-nums ${
                    r.amountCents < 0 ? 'text-foreground' : 'text-positive-600 dark:text-positive-400'
                  }`}
                >
                  {formatCents(cents(r.amountCents))}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
