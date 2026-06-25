'use client';

/**
 * Net worth + 18-month trend. Values come from the server (snapshots +
 * netWorthCents helper); this component only renders.
 */
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cents, formatCents } from '@/lib/money';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';

export interface NetWorthPoint {
  date: string;
  netWorthCents: number;
}

export function NetWorthCard({
  current,
  trend,
  runwayMonths,
}: {
  current: number;
  trend: NetWorthPoint[];
  /** Months of expenses held in cash (from getCoachData); optional so other call sites need not supply it. */
  runwayMonths?: number;
}) {
  // Housel/Babylon "room for error" — banded against the classic 3–6 month range.
  // Engine returns Infinity when there are no expenses, so guard for finiteness.
  const hasRunway = runwayMonths !== undefined && Number.isFinite(runwayMonths);
  const runwayBand: 'below' | 'in' | 'above' | null = hasRunway
    ? runwayMonths! < 3
      ? 'below'
      : runwayMonths! <= 6
        ? 'in'
        : 'above'
    : null;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const tick = (date: string) => `${MONTHS[+date.slice(5, 7) - 1]} '${date.slice(2, 4)}`;
  const data = trend.map((p) => ({
    date: tick(p.date),
    fullDate: p.date,
    dollars: p.netWorthCents / 100,
    label: formatCents(cents(p.netWorthCents)),
  }));
  const prev = trend.length >= 2 ? trend[trend.length - 2] : null;
  const deltaCents = prev ? current - prev.netWorthCents : null;

  return (
    <Card data-testid="net-worth-card">
      <CardHeader className="pb-2">
        <CardDescription>Net worth (assets − liabilities)</CardDescription>
        <CardTitle as="div" className="text-2xl tabular-nums sm:text-3xl" data-testid="net-worth-amount">
          {formatCents(cents(current))}
        </CardTitle>
        {deltaCents !== null && (
          <p
            className={`text-xs ${deltaCents >= 0 ? 'text-emerald-500' : 'text-red-400'}`}
            data-testid="net-worth-delta"
          >
            {formatCents(cents(deltaCents), { signDisplay: 'always' })} vs last month-end
          </p>
        )}
        {runwayBand !== null && (
          <p
            className={`mt-1 inline-flex w-fit rounded-full px-2 py-0.5 text-[11px] ${
              runwayBand === 'below'
                ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                : 'bg-muted text-muted-foreground'
            }`}
            data-testid="room-for-error"
          >
            {COACH_COPY.runwayBanded(runwayMonths!, runwayBand)}
          </p>
        )}
      </CardHeader>
      <CardContent>
        <div className="h-36 w-full sm:h-44">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
              <defs>
                <linearGradient id="nw" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" tickLine={false} axisLine={false} />
              <YAxis hide domain={['dataMin - 5000', 'dataMax + 5000']} />
              <Tooltip
                formatter={(value) => [
                  formatCents(cents(Math.round((value as number) * 100))),
                  'Net worth',
                ]}
                labelFormatter={(_, payload) => payload?.[0]?.payload?.fullDate ?? ''}
                contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
              />
              <Area type="monotone" dataKey="dollars" stroke="#10b981" strokeWidth={2} fill="url(#nw)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Trend uses month-end balances across all accounts.
        </p>
      </CardContent>
    </Card>
  );
}
