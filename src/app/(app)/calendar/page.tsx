import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { buildCashFlowCalendar } from '@/lib/engine/calendar/build';
import { addMonthsClamped, formatISODate, isoDate } from '@/lib/dates';
import { cents, formatCents } from '@/lib/money';
import { getCashNeeded } from '@/server/finance';

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  const { today, snap, result } = await getCashNeeded(session.user.id);
  const params = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(params.month ?? '') ? params.month! : today.slice(0, 7);

  const calendar = buildCashFlowCalendar({
    month,
    scheduled: snap.scheduled,
    cardObligations: [...result.cards, ...result.upcoming],
  });

  const prev = addMonthsClamped(isoDate(`${month}-01`), -1).slice(0, 7);
  const next = addMonthsClamped(isoDate(`${month}-01`), 1).slice(0, 7);
  const eventDays = calendar.days.filter((d) => d.events.length > 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Cash-flow calendar</h1>
        <div className="flex items-center gap-2 text-sm">
          <Link href={`/calendar?month=${prev}`} className="rounded-md border px-2 py-1 hover:bg-accent" data-testid="cal-prev">
            ←
          </Link>
          <span className="font-medium tabular-nums" data-testid="cal-month">
            {month}
          </span>
          <Link href={`/calendar?month=${next}`} className="rounded-md border px-2 py-1 hover:bg-accent" data-testid="cal-next">
            →
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardDescription>
            In {formatCents(calendar.totalInCents)} · out {formatCents(calendar.totalOutCents)} ·{' '}
            {calendar.reminderDates.length} card due date{calendar.reminderDates.length === 1 ? '' : 's'}
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
                          {e.kind === 'card-due' ? '💳' : e.amountCents >= 0 ? '↓' : '↑'} {e.label}
                          {e.kind === 'card-due' && (
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
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Card amounts shown on their effective due dates (weekend/holiday dates roll back to the
            prior business day). In-app reminders mark each due day.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
