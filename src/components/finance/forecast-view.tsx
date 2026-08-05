'use client';

/**
 * Cash-flow forecast (DECISIONS #72): a day-by-day projected balance line over
 * the horizon, with 30/60/90-day milestones, the lowest-point / first-negative
 * warning, and the upcoming flows that drive it. Recharts area; colors flip to
 * rose if the balance is projected to dip below zero.
 */
import { Area, AreaChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { formatISODate, isoDate } from '@/lib/dates';
import { cents, formatCents } from '@/lib/money';
import type { CashFlowForecastData } from '@/server/forecast';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const tick = (d: string) => `${MONTHS[+d.slice(5, 7) - 1]} ${+d.slice(8, 10)}`;

export function ForecastView({ data }: { data: CashFlowForecastData }) {
  const f = data.forecast;
  const dips = f.firstNegativeDate !== null;
  const deltaCents = f.endingBalanceCents - f.startingBalanceCents;
  const color = dips ? '#f43f5e' : '#10b981';
  const chart = f.days.map((d) => ({ date: tick(d.date), full: d.date, dollars: d.balanceCents / 100 }));

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="sr-only">Cash-flow forecast</h1>
      {/* Hero */}
      <section
        data-testid="forecast-hero"
        className="rounded-2xl border bg-gradient-to-br from-card to-accent/30 p-6 shadow-sm"
      >
        {/* The scope caveat qualifies EVERY figure on this page, so the reader meets it
            before the first one (P1-18 / C.12 — the /cards placement rule: the caveat
            comes before the figure it qualifies, never three screens below it). */}
        <p
          className="mb-3 text-xs text-muted-foreground"
          data-testid="forecast-scope-note"
        >
          Projection of {data.accountName}{' '}from your recurring income and bills only — it
          doesn&apos;t include card payments (see the cash-needed card) or one-off spending, so
          treat it as a planning estimate.
        </p>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Projected balance in {data.horizonDays} days
        </p>
        <p
          data-testid="forecast-projected"
          className="mt-1 text-4xl font-bold tabular-nums tracking-tight sm:text-5xl"
        >
          {formatCents(cents(f.endingBalanceCents))}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          <span className={deltaCents >= 0 ? 'text-emerald-500' : 'text-rose-500'}>
            {formatCents(cents(deltaCents), { signDisplay: 'always' })}
          </span>{' '}
          from {formatCents(cents(f.startingBalanceCents))} in {data.accountName} today
        </p>
        {/* TASKS L.18 — beside the starting balance the whole projection walks from, because that
            is the number the sentence is about. Nothing else on this page qualifies it: unlike the
            dashboard, /forecast renders no assumptions block and no radar card. */}
        {data.frozenNote && (
          <p className="mt-2 text-xs text-amber-500" data-testid="forecast-frozen-note">
            {data.frozenNote}
          </p>
        )}
        <div
          data-testid="forecast-lowest"
          className={`mt-3 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
            dips
              ? 'border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400'
              : 'border-border bg-accent text-muted-foreground'
          }`}
        >
          {dips ? <TrendingDown className="size-3.5" aria-hidden /> : <TrendingUp className="size-3.5" aria-hidden />}
          {dips ? (
            <>Dips below $0 on {formatISODate(isoDate(f.firstNegativeDate as string))}</>
          ) : (
            <>
              Lowest point {formatCents(cents(f.lowest.balanceCents))} on{' '}
              {formatISODate(isoDate(f.lowest.date))}
            </>
          )}
        </div>
      </section>

      {/* 30 / 60 / 90 day milestones */}
      {f.milestones.length > 0 && (
        <div data-testid="forecast-milestones" className="grid grid-cols-3 gap-2">
          {f.milestones.map((m) => (
            <div key={m.dayOffset} className="min-w-0 rounded-2xl border bg-card p-3 text-center shadow-sm">
              <p className="text-xs text-muted-foreground">{m.dayOffset} days</p>
              <p className={`mt-0.5 break-words font-semibold tabular-nums ${m.balanceCents < 0 ? 'text-rose-500' : ''}`}>
                {formatCents(cents(m.balanceCents))}
              </p>
              <p className="text-[10px] text-muted-foreground">{formatISODate(isoDate(m.date))}</p>
            </div>
          ))}
        </div>
      )}

      {/* Balance line */}
      <section className="rounded-2xl border bg-card p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold">Projected balance</h2>
        <div className="h-56" data-testid="forecast-chart">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chart} margin={{ top: 4, right: 8, bottom: 0, left: 4 }}>
              <defs>
                <linearGradient id="fc" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.45} />
                  <stop offset="100%" stopColor={color} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={40} tickLine={false} axisLine={false} />
              <YAxis hide domain={[dips ? 'dataMin - 5000' : 0, 'dataMax + 5000']} />
              {dips && <ReferenceLine y={0} stroke="#f43f5e" strokeDasharray="3 3" />}
              <Tooltip
                formatter={(v) => [formatCents(cents(Math.round(Number(v) * 100))), 'Balance']}
                labelFormatter={(_, p) => p?.[0]?.payload?.full ?? ''}
                contentStyle={{
                  background: 'var(--popover)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Area type="monotone" dataKey="dollars" stroke={color} strokeWidth={2} fill="url(#fc)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Upcoming flows */}
      {f.upcoming.length > 0 && (
        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <h2 className="px-4 pt-4 text-sm font-semibold">Upcoming flows</h2>
          <ul className="mt-2 divide-y" data-testid="forecast-upcoming">
            {f.upcoming.map((e, i) => (
              <li
                key={`${e.date}:${i}`}
                className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
              >
                <div className="min-w-0">
                  <span className="truncate font-medium">{e.label}</span>
                  <div className="text-xs text-muted-foreground">{formatISODate(isoDate(e.date))}</div>
                </div>
                <span
                  className={`shrink-0 tabular-nums ${e.amountCents >= 0 ? 'text-emerald-500' : 'text-foreground'}`}
                >
                  {formatCents(cents(e.amountCents), { signDisplay: 'always' })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
