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
import {
  FROZEN_CALENDAR_TESTID,
  type FrozenCalendarRow,
  frozenCalendarNotice,
} from '@/lib/engine/account/feed-dropped-view';
import { addMonthsClamped, formatISODate, formatMonth, holidayTable, isoDate } from '@/lib/dates';
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
    input,
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
  // Painted ONCE, then used both to build the grid and to name the frozen disclosure below
  // (TASKS L.19). Two separate applications of `withOwner` would be two expressions for one card's
  // name, which is the #297/#298 drift this repo keeps paying for: the disclosure would be free to
  // call an account something the row beside it does not.
  //
  // `cycleBasisCents` (TASKS C.8): months after the current one repeat each card's FULL statement
  // basis, not this cycle's post-mid-cycle-payment residual — the exact basis the radar's
  // `projectCardDues` prices future cycles at (server/radar.ts builds this same map), so the two
  // surfaces cannot quote different amounts for the same future payment.
  const statementBasisByCard = new Map(
    input.cards
      .filter((c) => c.statement)
      .map((c) => [c.id, c.statement!.statementBalanceCents] as const),
  );
  const paintedCards = result.cards.map((c) => ({
    ...c,
    cardName: withOwner(c.cardId, c.cardName),
    cycleBasisCents: statementBasisByCard.get(c.cardId),
  }));
  const paintedLoans = loanObligations.map((l) => ({
    ...l,
    accountName: withOwner(l.accountId, l.accountName),
  }));
  // The table must span BOTH `today` (synthesized occurrences strictly after it) and the DISPLAYED
  // month, which is a free query param — a reader twelve clicks into next year still gets real
  // holiday roll-backs, not weekend-only ones.
  const todayYear = +today.slice(0, 4);
  const monthYear = +month.slice(0, 4);
  const calendar = buildCashFlowCalendar({
    month,
    scheduled: snap.scheduled.map((s) => ({ ...s, description: withOwner(s.accountId, s.description) })),
    cardObligations: paintedCards,
    loanObligations: paintedLoans,
    today,
    holidays: holidayTable(
      Math.min(todayYear, monthYear) - 1,
      Math.max(todayYear, monthYear) + 1,
    ),
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

  // TASKS L.19 — the frozen-account disclosure, resolved against the due events THIS MONTH actually
  // paints, exactly as the duplicate view above is. An obligation whose effective due date falls in
  // another month emits no event, so naming it here would qualify a row the reader cannot find.
  //
  // `frozenSince` is looked up per ACCOUNT (it is a fact about the connection), while
  // `amountSource` is read off the EVENT — a card can hold both a current statement and a
  // synthesized repeat of it, and the claim must describe the amount actually printed on this row,
  // not the account's other one (C.8 critic F-1: a boolean `isEstimated` cannot tell a repeated
  // STATEMENT from a balance estimate, and the disclosure's sentence changes with the difference).
  const frozenCardSource = new Map(
    paintedCards.filter((c) => c.frozenSince != null).map((c) => [c.cardId, c] as const),
  );
  const frozenLoanSource = new Map(
    paintedLoans.filter((l) => l.frozenSince != null).map((l) => [l.accountId, l] as const),
  );
  const frozen = frozenCalendarNotice(
    calendar.days
      .flatMap((d) => d.events)
      .flatMap((e): FrozenCalendarRow[] => {
        // amountSource rides the EVENT (the engine knows which branch painted it). A due event
        // without one is a scheduled flow misread as a due; refuse rather than default (C.8 F-1).
        if (e.accountId === undefined || e.amountSource === undefined) return [];
        const card = e.kind === 'card-due' ? frozenCardSource.get(e.accountId) : undefined;
        const loan = e.kind === 'loan-due' ? frozenLoanSource.get(e.accountId) : undefined;
        if (card) {
          return [
            {
              accountId: e.accountId,
              label: card.cardName,
              frozenSince: card.frozenSince as string,
              ownership: (accountOwnerLabel[e.accountId] ? 'partner' : 'reader') as
                | 'partner'
                | 'reader',
              kind: 'card' as const,
              amountSource: e.amountSource,
            },
          ];
        }
        if (loan) {
          return [
            {
              accountId: e.accountId,
              label: loan.accountName,
              frozenSince: loan.frozenSince as string,
              ownership: (accountOwnerLabel[e.accountId] ? 'partner' : 'reader') as
                | 'partner'
                | 'reader',
              kind: 'loan' as const,
              // A loan's payment is the issuer-reported fixed amount; `frozenLoanNote` never reads
              // this field, but it is REQUIRED, so it is stated rather than defaulted.
              amountSource: e.amountSource,
            },
          ];
        }
        return [];
      }),
    {
      nextStep: 'accounts-route',
      // TASKS L.19 critic P1-1. This page prints one dated instruction that no due row accounts
      // for — the "Projected low … transfer $X by DATE to stay covered" line below — and it is
      // walked forward from the funding balance. With every card and loan live but that balance
      // frozen, the notice used to render nothing at all, and the quiet direction is the costly
      // one: a balance frozen HIGH produces no dip line and reassures the reader into doing nothing.
      funding: result.fundingFrozen
        ? // The engine deliberately does not carry the funding account's NAME on its result (a
          // disclosure must name the row as the reader's own surface names it), and this page
          // prints no label of its own for it — so the name comes from the very input the
          // projection was computed from, which is the same row /accounts lists.
          { label: input.paymentAccount.name, frozenSince: result.fundingFrozen.frozenSince }
        : null,
      // Read from what this run actually rendered, never from a status enum — the dip paragraph
      // below is gated on exactly these two fields.
      shows:
        result.headline.shortfallDate && result.headline.recommendation
          ? 'a-transfer'
          : result.headline.shortfallDate
            ? 'a-dip'
            : 'no-dip',
    },
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
          {frozen && (
            // TASKS L.19. Same placement and the same reasoning as the duplicate banner directly
            // above: over the grid it qualifies, under the summary line whose money-out total and
            // payment count it names. This page's rows ARE instructions ("pay this much on this
            // day"), which is why the builder is called with role 'instruction' — but the page
            // itself hands out no transfer, so this is not role="alert" either.
            <div
              className="mb-3 rounded-lg border border-amber-900/50 bg-amber-950/20 px-3 py-2 text-sm"
              data-testid={FROZEN_CALENDAR_TESTID}
            >
              <p className="font-medium">{frozen.title}</p>
              <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                {frozen.lines.map((line, i) => (
                  // Index key, not the line itself (critic P2-2): two accounts that paint
                  // identically once produced two byte-identical lines and therefore duplicate
                  // React keys. The builder now collapses that case, and the key no longer
                  // depends on the strings being distinct.
                  <li key={i}>{line}</li>
                ))}
              </ul>
              {frozen.totalNote && (
                <p className="mt-1 text-xs text-muted-foreground">{frozen.totalNote}</p>
              )}
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
            the prior business day), and each repeats monthly in later months — future card amounts are
            estimates, repeating this cycle&apos;s amount (the current statement, or the balance estimate
            when no statement exists) until the issuer sends the real one, and each is labeled (est.).
            Each due day is badged here, the dashboard shows your upcoming payment reminders, and email
            reminders activate once an email provider is configured.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
