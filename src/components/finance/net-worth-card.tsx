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

export interface NetWorthPoint {
  date: string;
  netWorthCents: number;
}

export function NetWorthCard({
  current,
  trend,
}: {
  current: number;
  trend: NetWorthPoint[];
}) {
  const data = trend.map((p) => ({
    date: p.date.slice(2, 7), // YY-MM tick
    fullDate: p.date,
    dollars: p.netWorthCents / 100,
    label: formatCents(cents(p.netWorthCents)),
  }));

  return (
    <Card data-testid="net-worth-card">
      <CardHeader className="pb-2">
        <CardDescription>Net worth (assets − liabilities)</CardDescription>
        <CardTitle className="text-2xl sm:text-3xl" data-testid="net-worth-amount">
          {formatCents(cents(current))}
        </CardTitle>
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
          Trend uses month-end balances across all accounts. Wealth is what you
          don&apos;t see — steady beats flashy.
        </p>
      </CardContent>
    </Card>
  );
}
