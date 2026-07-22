import { PieChart } from 'lucide-react';
import { cents, formatCents } from '@/lib/money';
import type { SpendingBreakdown } from '@/lib/engine/reports/reports';
import { TrackedActedLink } from '@/components/engagement/tracked-acted-link';
import { SURFACE_LINK_CARD_CLASS } from '@/components/finance/surface-card-styles';

const PALETTE = ['#34d399', '#60a5fa', '#fbbf24', '#f87171', '#a78bfa'];

/**
 * Dashboard summary of this month's top spending categories (DECISIONS #67),
 * linking through to the full Reports view. Tappable card.
 */
export function TopSpendingCard({ breakdown }: { breakdown: SpendingBreakdown }) {
  const top = breakdown.byCategory.slice(0, 4);
  const max = Math.max(1, ...top.map((c) => c.amountCents));
  return (
    <TrackedActedLink
      href="/reports"
      subjectKey="top-spending"
      data-testid="dashboard-top-spending"
      className={SURFACE_LINK_CARD_CLASS}
    >
      <div className="flex items-baseline justify-between">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <PieChart className="size-3.5" aria-hidden /> Top spending
        </div>
        <span className="tabular-nums text-xs text-muted-foreground">
          {formatCents(cents(breakdown.totalCents))} this month
        </span>
      </div>
      {top.length === 0 ? (
        <p className="py-5 text-center text-xs text-muted-foreground">No spending yet this month.</p>
      ) : (
        <div className="mt-3 space-y-2">
          {top.map((c, i) => (
            <div key={c.categoryId}>
              <div className="flex items-baseline justify-between text-xs">
                <span className="truncate">{c.name}</span>
                <span className="ml-2 shrink-0 tabular-nums text-muted-foreground">
                  {formatCents(cents(c.amountCents))}
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-1.5 rounded-full"
                  style={{ width: `${(c.amountCents / max) * 100}%`, backgroundColor: PALETTE[i % PALETTE.length] }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </TrackedActedLink>
  );
}
