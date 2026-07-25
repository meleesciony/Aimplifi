import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowDownLeft, ArrowUpRight, CreditCard, Landmark } from 'lucide-react';
import { auth } from '@/auth';
import { HouseholdScopeToggle } from '@/components/dashboard/household-scope-toggle';
import { EmptyCalendar } from '@/components/onboarding/route-empty';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { prisma } from '@/lib/db';
import { buildCashFlowCalendar } from '@/lib/engine/calendar/build';
import {
  CARD_DUPLICATE_PAIR_TESTID,
  CARD_DUPLICATE_TESTID,
  cardDuplicateCalendarView,
} from '@/lib/engine/account/card-duplicate-view';
import { addMonthsClamped, formatISODate, formatMonth, isoDate } from '@/lib/dates';
import { cents, formatCents } from '@/lib/money';
import { getCashNeeded } from '@/server/finance';

export const metadata = { title: "Calendar" };

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; scope?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  // No accounts yet → route-framed onboarding; getCashNeeded throws on empty (DECISIONS #44).
  if ((await prisma.account.count({ where: { userId: session.user.id, OR: [{ currency: null }, { currency: 'USD' }] } })) === 0) return <EmptyCalendar />;
  const params = await searchParams;
  // Household scope toggle (TASKS 4.2 slice 5) — same contract as /dashboard,
  // /cards: getCashNeeded re-derives the EFFECTIVE scope (falls back to 'mine'
  // without live partners), so a stale `?scope=household` link never errors.
  const requestedScope = params.scope === 'household' ? 'household' : 'mine';
  const {
    today,
    snap,
    result,
    loanObligations,
    scope,
    household,
    accountOwnerLabel,
    householdWithheldCount,
    householdDuplicates,
    cardDuplicates,
  } = await getCashNeeded(session.user.id, 'PAY_IN_FULL', requestedScope);
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(params.month ?? '')
    ? params.month!
    : today.slice(0, 7);

  // Owner attribution at household scope (slice-8 critic F-10): a partner's
  // due/scheduled event is labeled with whose account it is, applied to the
  // INPUT labels here so the calendar engine stays free of any user concept.
  // 'mine' scope: the map is empty, every label byte-identical (T6).
  const withOwner = (id: string, label: string) =>
    accountOwnerLabel[id] ? `${label} (${accountOwnerLabel[id]}'s)` : label;

  // result.cards already contains every obligation (estimates included);
  // upcoming is a SUBSET of it — spreading both double-counted (cycle-3 H1).
  // loanObligations adds the next LOAN/MORTGAGE payments as their own due events (#134).
  const calendar = buildCashFlowCalendar({
    month,
    scheduled: snap.scheduled.map((s) => ({ ...s, description: withOwner(s.accountId, s.description) })),
    cardObligations: result.cards.map((c) => ({ ...c, cardName: withOwner(c.cardId, c.cardName) })),
    loanObligations: loanObligations.map((l) => ({ ...l, accountName: withOwner(l.accountId, l.accountName) })),
  });

  // TASKS L.15 (a). Resolved against the card-due events THIS MONTH actually holds, under the exact
  // label the grid paints (owner suffix and "(est.)" included) — so it can never name a card the
  // reader cannot find below, and a pair whose other side falls in a different month is dropped.
  // `getCashNeeded` computes the pairs from the viewer's OWN snapshot even at household scope, so a
  // partner's card can never be paired with the reader's here.
  const duplicates = cardDuplicateCalendarView(
    cardDuplicates,
    calendar.days.flatMap((d) =>
      d.events
        .filter((e) => e.kind === 'card-due' && e.accountId !== undefined)
        .map((e) => ({ cardId: e.accountId!, label: e.label })),
    ),
  );

  const prev = addMonthsClamped(isoDate(`${month}-01`), -1).slice(0, 7);
  const next = addMonthsClamped(isoDate(`${month}-01`), 1).slice(0, 7);
  const eventDays = calendar.days.filter((d) => d.events.length > 0);
  // Month nav must carry the active scope too (TASKS 4.2 slice 5) — otherwise
  // paging months while in household scope silently drops back to 'mine'.
  const scopeQuery = scope === 'household' ? '&scope=household' : '';

  return (
    <div className="space-y-4">
      {household?.hasPartners && (
        <HouseholdScopeToggle
          scope={scope}
          householdName={household.name}
          basePath="/calendar"
          extraParams={{ month }}
          withheldCount={householdWithheldCount}
          duplicates={householdDuplicates}
        />
      )}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Cash-flow calendar</h1>
        <div className="flex items-center gap-2 text-sm">
          {/* #166: on Next 15.5.x these same-page searchParams navigations silently
              failed to commit whenever the TARGET month had events (deterministic:
              scripts/audit-probes/calendar-month-nav.ts, 5/7 failed) — an upstream client flight-application
              bug, unaffected by prefetch={false}, fixed by Next 16 (7/7 commit). If a
              future Next bump regresses month paging, re-run that probe first. */}
          <Link href={`/calendar?month=${prev}${scopeQuery}`} aria-label="Previous month" className="rounded-md border px-2 py-1 hover:bg-accent" data-testid="cal-prev">
            ←
          </Link>
          <span className="font-medium" data-testid="cal-month" data-month={month}>
            {formatMonth(month)}
          </span>
          <Link href={`/calendar?month=${next}${scopeQuery}`} aria-label="Next month" className="rounded-md border px-2 py-1 hover:bg-accent" data-testid="cal-next">
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
          {duplicates && (
            // Above the grid it qualifies, and directly under the summary line whose money-out
            // total and payment count it is about. Not role="alert", matching the reminders list:
            // this page hands the reader no transfer instruction, and the sentence is read in
            // document order, immediately before the events it names.
            <div
              className="mb-3 rounded-lg border border-amber-900/50 bg-amber-950/20 px-3 py-2 text-sm"
              data-testid={CARD_DUPLICATE_TESTID}
            >
              <p className="font-medium">{duplicates.title}</p>
              <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                {duplicates.pairs.map((p) => (
                  <li key={p.key} data-testid={`${CARD_DUPLICATE_PAIR_TESTID}-${p.key}`}>
                    {p.sentence} {p.impact} <span className="italic">{p.basis}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-muted-foreground">
                {duplicates.howTo}{' '}
                <Link href="/accounts" className="underline hover:text-foreground">
                  Go to Accounts
                </Link>
                .
              </p>
            </div>
          )}
          {eventDays.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No scheduled activity this month. The calendar tracks scheduled income, bills, and
              card due dates — day-to-day spending lives in Reports.
            </p>
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
