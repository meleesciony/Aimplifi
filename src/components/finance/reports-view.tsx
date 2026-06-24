'use client';

/**
 * Reports view (DECISIONS #67): income vs. expense over 6 months + this month's
 * spending by category with parent-group rollup. Recharts for the bars; inline
 * bars for the category breakdown (crisp, no axis clutter).
 */
import Link from 'next/link';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { cents, formatCents } from '@/lib/money';
import type { ReportsData } from '@/server/reports';

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7))] ?? ym}`;

// Palette cycled across categories/groups (kept consistent within a render).
const PALETTE = ['#34d399', '#60a5fa', '#fbbf24', '#f87171', '#a78bfa', '#fb923c', '#22d3ee', '#f472b6', '#4ade80', '#94a3b8'];

export function ReportsView({ data }: { data: ReportsData }) {
  const chartData = data.months.map((m) => ({
    name: monthLabel(m.month),
    income: m.incomeCents / 100,
    expense: m.expensesCents / 100,
  }));
  const top = data.breakdown.byCategory.slice(0, 12);
  const max = Math.max(1, ...top.map((c) => c.amountCents));
  const hasFlows = data.months.some((m) => m.incomeCents !== 0 || m.expensesCents !== 0);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">Reports</h1>
        <Link href="/trends" className="text-xs text-muted-foreground hover:text-foreground hover:underline">
          See trends →
        </Link>
      </div>

      {/* Income vs Expense */}
      <section className="rounded-2xl border bg-card p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Income vs. spending</h2>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-full bg-emerald-400" /> Income
            </span>
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-full bg-rose-400" /> Spending
            </span>
          </div>
        </div>
        {hasFlows ? (
          <div className="h-48" data-testid="income-expense-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                <CartesianGrid vertical={false} strokeOpacity={0.15} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={11} />
                <Tooltip
                  cursor={{ fillOpacity: 0.06 }}
                  formatter={(v) => formatCents(cents(Math.round(Number(v) * 100)))}
                  contentStyle={{ borderRadius: 8, fontSize: 12 }}
                />
                <Bar dataKey="income" fill="#34d399" radius={[3, 3, 0, 0]} />
                <Bar dataKey="expense" fill="#fb7185" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground" data-testid="income-expense-empty">
            No income or spending recorded in the last 6 months.
          </p>
        )}
      </section>

      {/* Spending by category */}
      <section className="rounded-2xl border bg-card p-5 shadow-sm">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Spending by category</h2>
          <span className="text-xs text-muted-foreground">
            {monthLabel(data.ym)} · {formatCents(cents(data.breakdown.totalCents))} total
          </span>
        </div>
        {top.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No spending this month yet.</p>
        ) : (
          <div className="space-y-2.5" data-testid="category-breakdown">
            {top.map((c, i) => (
              <div key={c.categoryId}>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="truncate">
                    {c.name} <span className="text-xs text-muted-foreground">· {c.group}</span>
                  </span>
                  <span className="ml-2 shrink-0 tabular-nums">{formatCents(cents(c.amountCents))}</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-2 rounded-full"
                    style={{ width: `${(c.amountCents / max) * 100}%`, backgroundColor: PALETTE[i % PALETTE.length] }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
