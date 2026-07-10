/**
 * /transactions → "Shared with you" (TASKS 4.2 slice 3). READ-ONLY partner
 * rows: owner badge, category as plain text (no pencil / picker / Always),
 * no triage affordances. Mutations stay owner-scoped until slice 6 (T3).
 *
 * Rendered ONLY when getSharedTransactionsView returns kind 'member' with
 * rows — solo and demo users never see this section (T6).
 */
import { Badge } from '@/components/ui/badge';
import { formatISODate, isoDate } from '@/lib/dates';
import { cents, formatCents } from '@/lib/money';
import type { SharedTxnRow } from '@/server/household';

function amountClass(t: SharedTxnRow): string {
  if (t.isTransfer) return 'text-muted-foreground';
  return t.amountCents > 0 ? 'text-emerald-500' : 'text-foreground';
}

export function SharedTransactionList({
  householdName,
  rows,
  truncated,
}: {
  householdName: string;
  rows: SharedTxnRow[];
  truncated: boolean;
}) {
  if (rows.length === 0) return null;

  const groups: { date: string; items: SharedTxnRow[] }[] = [];
  for (const t of rows) {
    const last = groups[groups.length - 1];
    if (last && last.date === t.date) last.items.push(t);
    else groups.push({ date: t.date, items: [t] });
  }

  return (
    <section className="space-y-3" data-testid="shared-txn-section">
      <div>
        <h2 className="text-base font-semibold">Shared with you — {householdName}</h2>
        <p className="text-xs text-muted-foreground">
          Read-only transactions from accounts your partner chose to share.
          Categories and amounts are theirs; your own register above is unchanged.
          {truncated && <> Showing the most recent {rows.length}.</>}
        </p>
      </div>

      {groups.map((g) => (
        <div key={g.date}>
          <div className="sticky top-0 bg-background/95 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
            {formatISODate(isoDate(g.date), 'long')}
          </div>
          <ul className="divide-y rounded-md border">
            {g.items.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between gap-3 px-3 py-2"
                data-testid="shared-txn-row"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{t.merchantName}</span>
                    <span
                      className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-[10px] text-muted-foreground"
                      data-testid="shared-txn-owner"
                    >
                      {t.ownerLabel}
                    </span>
                    {t.status === 'PENDING' && (
                      <Badge variant="outline" className="shrink-0 text-[10px]">
                        Pending
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <span data-testid="shared-txn-category">{t.categoryName}</span>
                    {' · '}
                    <span className="break-all">{t.accountName}</span>
                  </div>
                </div>
                <div className={`shrink-0 tabular-nums ${amountClass(t)}`}>
                  {formatCents(cents(t.amountCents), { signDisplay: 'always' })}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
