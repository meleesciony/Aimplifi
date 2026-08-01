import Link from 'next/link';
import { ListOrdered } from 'lucide-react';
import { cents, formatCents } from '@/lib/money';
import type { DashboardRecentResult } from '@/server/dashboard-recent';
import { SURFACE_CARD_CLASS } from '@/components/finance/surface-card-styles';

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
            <p className="mt-1 text-sm text-amber-700 dark:text-amber-400" data-testid="dashboard-needs-file">
              <Link href="/triage" className="underline underline-offset-2 hover:text-foreground">
                {needsFileCount === 1
                  ? '1 merchant needs filing'
                  : `${needsFileCount} merchants need filing`}
              </Link>
              {' — '}
              guilt-free depends on getting categories right.
            </p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">Latest activity across your accounts.</p>
          )}
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
                href={`/transactions/${r.id}`}
                className={`flex items-center justify-between gap-3 py-2.5 text-sm transition hover:bg-muted/40 ${
                  r.needsFile ? 'bg-amber-50/80 dark:bg-amber-950/30' : ''
                }`}
                data-testid="dashboard-recent-row"
                data-needs-file={r.needsFile ? 'true' : 'false'}
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">{r.merchantName}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {r.date}
                    {' · '}
                    {r.needsFile ? (
                      <span className="font-medium text-amber-700 dark:text-amber-400">Needs category</span>
                    ) : (
                      r.categoryName
                    )}
                  </p>
                </div>
                <span
                  className={`shrink-0 tabular-nums ${
                    r.amountCents < 0 ? 'text-foreground' : 'text-emerald-600 dark:text-emerald-400'
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
