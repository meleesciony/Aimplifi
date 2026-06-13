/**
 * Presentational transaction register: groups rows by date (rows arrive
 * pre-sorted most-recent-first) and renders each with merchant, category,
 * account, status, and signed amount. Inflows are green; transfers are muted.
 */
import { Receipt } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatISODate, isoDate } from '@/lib/dates';
import { cents, formatCents } from '@/lib/money';
import type { TxnSummary, TxnView } from '@/lib/engine/transactions/query';

function amountClass(t: TxnView): string {
  if (t.isTransfer) return 'text-muted-foreground';
  return t.amountCents > 0 ? 'text-emerald-500' : 'text-foreground';
}

export function TransactionList({ rows, summary }: { rows: TxnView[]; summary: TxnSummary }) {
  // Group consecutive rows by date (input is already date-desc sorted).
  const groups: { date: string; items: TxnView[] }[] = [];
  for (const t of rows) {
    const last = groups[groups.length - 1];
    if (last && last.date === t.date) last.items.push(t);
    else groups.push({ date: t.date, items: [t] });
  }

  return (
    <div className="space-y-4" data-testid="txn-list">
      {/* summary strip */}
      <div className="grid grid-cols-3 gap-2 text-sm" data-testid="txn-summary">
        <div className="rounded-md border p-2">
          <div className="text-xs text-muted-foreground">Money in</div>
          <div className="tabular-nums text-emerald-500" data-testid="summary-in">
            {formatCents(summary.inflowCents)}
          </div>
        </div>
        <div className="rounded-md border p-2">
          <div className="text-xs text-muted-foreground">Money out</div>
          <div className="tabular-nums" data-testid="summary-out">
            {formatCents(summary.outflowCents)}
          </div>
        </div>
        <div className="rounded-md border p-2">
          <div className="text-xs text-muted-foreground">Net</div>
          <div
            className={`tabular-nums ${summary.netCents >= 0 ? 'text-emerald-500' : 'text-red-400'}`}
            data-testid="summary-net"
          >
            {formatCents(summary.netCents, { signDisplay: 'always' })}
          </div>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {summary.count} transaction{summary.count === 1 ? '' : 's'}. Totals exclude
        transfers between your own accounts.
      </p>

      {rows.length === 0 ? (
        <div
          className="flex flex-col items-center gap-2 rounded-md border border-dashed py-10 text-center text-sm text-muted-foreground"
          data-testid="txn-empty"
        >
          <Receipt className="size-6" aria-hidden />
          No transactions match these filters.
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.date}>
            <div className="sticky top-0 bg-background/95 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
              {formatISODate(isoDate(g.date))}
            </div>
            <ul className="divide-y rounded-md border">
              {g.items.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center justify-between gap-3 px-3 py-2"
                  data-testid="txn-row"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{t.merchantName}</span>
                      {t.status === 'PENDING' && (
                        <Badge variant="outline" className="shrink-0 text-[10px]">
                          Pending
                        </Badge>
                      )}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {t.categoryName} · {t.accountName}
                    </div>
                  </div>
                  <div className={`shrink-0 tabular-nums ${amountClass(t)}`}>
                    {formatCents(cents(t.amountCents), { signDisplay: 'always' })}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </div>
  );
}
