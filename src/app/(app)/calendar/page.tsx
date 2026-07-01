import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowDownLeft, ArrowUpRight, CreditCard, Landmark } from 'lucide-react';
import { auth } from '@/auth';
import { EmptyDashboard } from '@/components/onboarding/empty-dashboard';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { prisma } from '@/lib/db';
import { buildCashFlowCalendar } from '@/lib/engine/calendar/build';
import { addMonthsClamped, formatISODate, formatMonth, isoDate } from '@/lib/dates';
import { cents, formatCents } from '@/lib/money';
import { getCashNeeded } from '@/server/finance';

export const metadata = { title: "Calendar" };

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  // No accounts yet → onboarding; getCashNeeded throws on empty (DECISIONS #44).
  if ((await prisma.account.count({ where: { userId: session.user.id, OR: [{ currency: null }, { currency: 'USD' }] } })) === 0) return <EmptyDashboard />;
  const { today, snap, result, loanObligations } = await getCashNeeded(session.user.id);
  const params = await searchParams;
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(params.month ?? '')
    ? params.month!
    : today.slice(0, 7);

  // result.cards already contains every obligation (estimates included);
  // upcoming is a SUBSET of it — spreading both double-counted (cycle-3 H1).
  // loanObligations adds the next LOAN/MORTGAGE payments as their own due events (#134).
  const calendar = buildCashFlowCalendar({
    month,
    scheduled: snap.scheduled,
    cardObligations: result.cards,
    loanObligations,
  });

  const prev = addMonthsClamped(isoDate(`${month}-01`), -1).slice(0, 7);
  const next = addMonthsClamped(isoDate(`${month}-01`), 1).slice(0, 7);
  const eventDays = calendar.days.filter((d) => d.events.length > 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Cash-flow calendar</h1>
        <div className="flex items-center gap-2 text-sm">
          <Link href={`/calendar?month=${prev}`} aria-label="Previous month" className="rounded-md border px-2 py-1 hover:bg-accent" data-testid="cal-prev">
            ←
          </Link>
          <span className="font-medium" data-testid="cal-month" data-month={month}>
            {formatMonth(month)}
          </span>
          <Link href={`/calendar?month=${next}`} aria-label="Next month" className="rounded-md border px-2 py-1 hover:bg-accent" data-testid="cal-next">
            →
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardDescription>
            {(() => {
              const dueCount = calendar.days.reduce(
                (n, d) => n + d.events.filter((e) => e.kind === 'card-due' || e.kind === 'loan-due').length,
                0,
              );
              const dates = calendar.reminderDates.length;
              return `In ${formatCents(calendar.totalInCents)} · out ${formatCents(calendar.totalOutCents)} · ${dueCount} payment${dueCount === 1 ? '' : 's'} due across ${dates} date${dates === 1 ? '' : 's'}`;
            })()}
          </CardDescription>
          <CardTitle className="text-base">Inflows, outflows, and card due dates</CardTitle>
        </CardHeader>
        <CardContent>
          {eventDays.length === 0 ? (
            <p className="text-sm text-muted-foreground">No scheduled activity this month.</p>
          ) : (
            <ul className="space-y-2" data-testid="calendar-list">
              {eventDays.map((day) => (
                <li key={day.date} className="rounded-lg border p-2">
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="font-medium">
                      {formatISODate(isoDate(day.date))}
                      {day.date === today && (
                        <Badge variant="secondary" className="ml-2">
                          today
                        </Badge>
                      )}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      net {formatCents(day.netCents, { signDisplay: 'always' })}
                    </span>
                  </div>
                  <ul className="mt-1 space-y-0.5">
                    {day.events.map((e, i) => (
                      <li key={i} className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="flex items-center gap-1.5">
                          {e.kind === 'card-due' ? (
                            <CreditCard className="size-3.5 text-muted-foreground" aria-hidden />
                          ) : e.kind === 'loan-due' ? (
                            <Landmark className="size-3.5 text-muted-foreground" aria-hidden />
                          ) : e.amountCents >= 0 ? (
                            <ArrowDownLeft className="size-3.5 text-emerald-500" aria-hidden />
                          ) : (
                            <ArrowUpRight className="size-3.5 text-muted-foreground" aria-hidden />
                          )}
                          {e.label}
                          {(e.kind === 'card-due' || e.kind === 'loan-due') && (
                            <Badge variant="destructive" className="text-[10px]">
                              due
                            </Badge>
                          )}
                        </span>
                        <span className={`tabular-nums ${e.amountCents >= 0 ? 'text-emerald-500' : ''}`}>
                          {formatCents(cents(e.amountCents), { signDisplay: 'always' })}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {/* the day the account is projected to go below $0 — the whole
                      point of the dashboard warning, now visible where dates live */}
                  {result.headline.shortfallDate === day.date && result.headline.recommendation && (
                    <p
                      className="mt-1.5 rounded-md border border-red-900/50 bg-red-950/40 px-2 py-1 text-xs text-red-300"
                      data-testid="calendar-dip"
                    >
                      Projected low: {formatCents(result.intraPeriodMinimum?.balanceCents ?? cents(0))} —
                      transfer {formatCents(result.headline.recommendation.amountCents)} by{' '}
                      {formatISODate(isoDate(result.headline.recommendation.byDate))} to stay covered.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Card and loan amounts shown on their effective due dates (weekend/holiday dates roll back to
            the prior business day). Each due day is badged here, the dashboard shows your upcoming payment
            reminders, and email reminders activate once an email provider is configured.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
