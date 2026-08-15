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
  type PostedCalendarDay,
  buildPostedCalendarMonth,
  postedZeroCopy,
} from '@/lib/engine/calendar/posted';
import { handoverDayAmountsNote } from '@/lib/engine/glass-box/category-breakdown';
import { splitLoanCarriedScheduled } from '@/lib/engine/loans/duplicate-projection';
import { getPostedCalendarRows } from '@/server/transactions';
import { isDemoUser } from '@/lib/demo-user';
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
import { addMonthsClamped, compareDates, daysInMonth, formatISODate, formatMonth, holidayTable, isoDate } from '@/lib/dates';
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
  // K.7: the obligation owns a loan payment. A scheduled row C.25 has PROVEN to be the same
  // payment as one of the obligations painted above is not ALSO painted as a scheduled outflow —
  // the grid would otherwise show one month's single contractual payment as two rows, on two
  // dates (the business-day-adjusted due date and the observed ACH date), which is the double
  // display `seed/build.ts:550` removed a hand-authored row to prevent and which no code
  // prevented for a real reader. Split on the RAW descriptions, BEFORE `withOwner` appends an
  // owner suffix: the suffix would change the canonical C.25 minted its fact with.
  const { kept: projectedScheduled } = splitLoanCarriedScheduled({
    scheduled: snap.scheduled,
    obligations: loanObligations,
    carried: snap.loanPaymentFlowExclusions?.excluded ?? [],
  });
  // The table must span BOTH `today` (synthesized occurrences strictly after it) and the DISPLAYED
  // month, which is a free query param — a reader twelve clicks into next year still gets real
  // holiday roll-backs, not weekend-only ones.
  const todayYear = +today.slice(0, 4);
  const monthYear = +month.slice(0, 4);
  const calendar = buildCashFlowCalendar({
    month,
    scheduled: projectedScheduled.map((s) => ({ ...s, description: withOwner(s.accountId, s.description) })),
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
      // Read from the same two fields that gate the dip paragraph below — and the paragraph's
      // day is guaranteed to render, because dayVMs keeps the shortfall day even when nothing
      // else paints it (K.1 critic F-2: a projection can go short TODAY on an already-low
      // balance, with no posted rows and no events on that day).
      shows:
        result.headline.shortfallDate && result.headline.recommendation
          ? 'a-transfer'
          : result.headline.shortfallDate
            ? 'a-dip'
            : 'no-dip',
    },
  );

  // K.1 — the posted half: real income/spend on the dates they posted, for days on or before
  // today. Read through the register's OWN basis and reconciliation keep (getPostedCalendarRows)
  // and totaled by the register's own summarize inside buildPostedCalendarMonth — so a day
  // printed here and the register filtered to that same day cannot disagree on a total.
  // Viewer-only even at household scope, deliberately: a partner shares scheduled flows and
  // dues, not their transaction rows (the register itself is viewer-only), and the note under
  // the grid says so rather than letting the two halves read as one basis.
  const canImportCsv = !isDemoUser(session.user.id);
  const monthLastDay = `${month}-${String(daysInMonth(+month.slice(0, 4), +month.slice(5, 7))).padStart(2, '0')}`;
  const postedRead = await getPostedCalendarRows(session.user.id, `${month}-01`, monthLastDay);
  const posted = buildPostedCalendarMonth({
    month,
    today,
    rows: postedRead.rows,
    oldestPostedDate: postedRead.oldestPostedDate ? isoDate(postedRead.oldestPostedDate) : null,
    newestPostedDate: postedRead.newestPostedDate ? isoDate(postedRead.newestPostedDate) : null,
  });

  const prev = addMonthsClamped(isoDate(`${month}-01`), -1).slice(0, 7);
  const next = addMonthsClamped(isoDate(`${month}-01`), 1).slice(0, 7);
  // One merged list: posted aggregates on past days, projected events ahead. A day's net is what
  // POSTED for days on or before today (a due event sitting there is a reminder of an unpaid
  // obligation, not a flow that happened — summing it into the day would mix fact with demand),
  // and the projection's net for days ahead (the pre-K.1 semantic, unchanged). A past day with
  // due events but no posted rows shows no net at all rather than a fabricated $0.00.
  const postedByDate = new Map<string, PostedCalendarDay>(posted.days.map((d) => [d.date, d]));
  const dayVMs = calendar.days
    .map((d) => {
      const p = postedByDate.get(d.date);
      const isPast = compareDates(isoDate(d.date), today) <= 0;
      const hasDue = d.events.some((e) => e.kind === 'card-due' || e.kind === 'loan-due');
      return {
        date: d.date,
        posted: p,
        events: d.events,
        netCents: isPast ? (p ? (p.netCents as number) : null) : (d.netCents as number),
        // A past day showing recorded rows AND a due says which arithmetic its net is (critic
        // F-2): the due beneath it is an unpaid demand, not a flow, and is not in this figure.
        netLabel: isPast && p && hasDue ? 'net (recorded)' : 'net',
      };
    })
    .filter(
      (d) =>
        d.posted !== undefined ||
        d.events.length > 0 ||
        // The dip paragraph anchors to the shortfall day (wiring critic F-2): a projection can go
        // short TODAY on an already-low balance with nothing else painting that day, and the
        // frozen notice's `shows` field promises the instruction really is on the page.
        (result.headline.shortfallDate === d.date && result.headline.recommendation != null),
    );
  const monthEmpty = dayVMs.length === 0;

  // Header lines: recorded fact and projections never share a sentence. When the grid below is
  // empty the body names the zero once, so the header stays quiet (critic F-10). "Posted +
  // pending" whenever pending rows sit inside the figures (critic F-1, both critics
  // independently): the money stays — the register's summary counts pending too, and the two
  // surfaces must agree — but the word "posted" alone would claim a finality a pending charge
  // does not have.
  const partialPast = posted.postedThrough !== null && posted.postedThrough !== monthLastDay;
  const postedZero =
    !monthEmpty && posted.postedThrough !== null && posted.emptyReason
      ? postedZeroCopy(posted.emptyReason)
      : null;
  const postedLine =
    posted.postedThrough === null || posted.rowCount === 0
      ? null
      // Audit P2: these totals span EVERY account (the reader's own at both scopes —
      // the household note below states the viewer-basis) — the line must say so, or
      // the figures read as one account's.
      : `${posted.pendingCount > 0 ? 'Posted + pending' : 'Posted'} across all your accounts${partialPast ? ` through ${formatISODate(posted.postedThrough)}` : ''}: in ${formatCents(posted.totalInCents)} · out ${formatCents(posted.totalOutCents)}${posted.pendingCount > 0 ? ` · ${posted.pendingCount} pending` : ''}${posted.excludedCount > 0 ? ` · ${posted.excludedCount} excluded row${posted.excludedCount === 1 ? '' : 's'} left out` : ''}`;
  const dueCount = calendar.days.reduce(
    (n, d) => n + d.events.filter((e) => e.kind === 'card-due' || e.kind === 'loan-due').length,
    0,
  );
  // Dues already at or past their date are not "scheduled" (critic F-7) — the line is named
  // "Expected" because it holds both kinds, and the already-due ones are counted out loud.
  const alreadyDueCount = calendar.days.reduce(
    (n, d) =>
      compareDates(isoDate(d.date), today) <= 0
        ? n + d.events.filter((e) => e.kind === 'card-due' || e.kind === 'loan-due').length
        : n,
    0,
  );
  const scheduledLine =
    partialPast || posted.postedThrough === null || dueCount > 0
      // Audit P2: the expected totals span every account in scope (viewer's at 'mine',
      // viewer + partners at household) — the line must say so, or the figures read
      // as one account's.
      ? `Expected across all accounts: in ${formatCents(calendar.totalInCents)} · out ${formatCents(calendar.totalOutCents)} · ${dueCount} payment${dueCount === 1 ? '' : 's'} due across ${calendar.reminderDates.length} date${calendar.reminderDates.length === 1 ? '' : 's'}${alreadyDueCount > 0 ? ` · ${alreadyDueCount} already due` : ''}`
      : null;
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
          <CardDescription data-testid="cal-summary">
            {postedLine && (
              <span className="block" data-testid="cal-posted-line">
                {postedLine}
              </span>
            )}
            {!postedLine && postedZero && (
              // The zero-with-a-grid case (future events below, nothing recorded): the reason
              // lives here, WITH its remedy when it has one (critic F-5 — the link used to
              // render only on a fully empty month, which is exactly when a stopped feed's
              // future dues keep the grid non-empty).
              <span className="block" data-testid="cal-posted-line">
                {postedZero.sentence}
                {postedZero.showAccountsLink && (
                  <>
                    {' '}
                    <Link href="/accounts" className="underline hover:text-foreground">
                      Check Accounts
                    </Link>
                    .
                  </>
                )}
              </span>
            )}
            {posted.countedOnHandoverDays > 0 && (
              // U.24: the released handover day (U.13) reaches this page's figures like every
              // other spending surface, and this was the last one that counted it in silence.
              //
              // Placed HERE — directly under the posted totals, and deliberately ABOVE
              // `scheduledLine` — because "these amounts" is a positional claim. Drafted one
              // level down as the first child of CardContent, the nearest figures above it were
              // the Expected/projected totals, which are built from scheduled series and card
              // dues and contain no transaction row, hence no released one: the sentence would
              // have qualified the two figures it is not about (`a-disclosure-written-for-a-
              // page-is-false-in-an-email`, failure mode 1, and #455 decision 9's antecedent
              // defect). `partialPast` makes that line render on nearly every day of the
              // current month, so it is the ordinary rendering, not an edge case.
              //
              // `handoverDayAmountsNote`, not the panel/answer/register authors: this surface
              // lists no transaction rows (each day links OUT to Activity for those), so
              // `breakdownHandoverDayCopy`'s "N rows here" and the register note's "it is
              // listed" are both false where the reader is standing. And the figures it
              // qualifies are an in AND an out — a doubled purchase and a doubled return move
              // those in opposite directions — so `handoverDayAnswerNote`'s single "this
              // figure … too high / too LOW" would be wrong about one of them. The amounts
              // author is the one that states the counting rule and claims neither
              // (U.16 decision 2, #455).
              //
              // Gated on the FACT (a released row is in these totals), never on a branch that
              // happens to render — gating on `postedLine` would repeat
              // `a-disclosure-gated-to-the-loudest-branch-misses-the-reachable-one`. The two
              // coincide anyway: a released row counted in the totals forces `rowCount > 0`,
              // so the note can never render without the figures it names.
              <span className="mt-1 block" data-testid="cal-handover-note">
                {handoverDayAmountsNote(posted.countedOnHandoverDays)}
              </span>
            )}
            {scheduledLine && (
              <span className="block" data-testid="cal-scheduled-line">
                {scheduledLine}
              </span>
            )}
          </CardDescription>
          <CardTitle className="text-base">Posted activity and upcoming payments</CardTitle>
        </CardHeader>
        <CardContent>
          {duplicates && (
            // Above the grid it qualifies, and directly under the summary line whose money-out
            // total and payment count it is about. Not role="alert", matching the reminders list:
            // this page hands the reader no transfer instruction, and the sentence is read in
            // document order, immediately before the events it names.
            <div
              className="mb-3 rounded-lg border border-warning-900/50 bg-warning-950/20 px-3 py-2 text-sm"
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
              className="mb-3 rounded-lg border border-warning-900/50 bg-warning-950/20 px-3 py-2 text-sm"
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
          {posted.floorNote && (
            // K.1: history begins INSIDE this month — the early blank days have a reason the
            // reader can see, named where the gap is (the K.3 lesson applied forward).
            <p className="mb-3 text-xs text-muted-foreground" data-testid="cal-floor-note">
              {posted.floorNote}
            </p>
          )}
          {posted.edgeNote && (
            // The trailing edge of the current month: blank-by-lag is not proven quiet.
            <p className="mb-3 text-xs text-muted-foreground" data-testid="cal-edge-note">
              {posted.edgeNote}
            </p>
          )}
          {scope === 'household' && posted.postedThrough !== null && (
            // Gated on the posted HALF existing, not on rows existing (critic F-11): a household
            // viewer with zero own rows still reads a viewer-basis zero above a partner's grid,
            // and that zero needs this scope note the most.
            <p className="mb-3 text-xs text-muted-foreground" data-testid="cal-household-posted-note">
              Recorded activity shows your accounts only — a partner shares scheduled flows and
              dues, not their transactions.
            </p>
          )}
          {dayVMs.length === 0 ? (
            // K.1: which zero? A wholly-future month has nothing scheduled yet; a month with a
            // posted half gets the reason computed from the history bounds this page holds —
            // never "no activity" over a window the data cannot see (the K.3 rule).
            <div className="text-sm text-muted-foreground" data-testid="cal-empty">
              {posted.postedThrough === null ? (
                <p>
                  No scheduled activity this month yet. Scheduled income, bills, and card or loan
                  dues appear here as they&apos;re detected.
                </p>
              ) : posted.emptyReason ? (
                <p>
                  {postedZeroCopy(posted.emptyReason).sentence}
                  {postedZeroCopy(posted.emptyReason).showAccountsLink && (
                    <>
                      {' '}
                      <Link href="/accounts" className="underline hover:text-foreground">
                        Check Accounts
                      </Link>
                      .
                    </>
                  )}
                  {posted.emptyReason.kind === 'before-history' && canImportCsv && (
                    // The register's own before-history state offers this exact remedy (critic
                    // F-3) — the two surfaces must agree on what is possible. Demo-fenced with
                    // the register's own predicate: the importer refuses the demo user (K.3
                    // critic P1), so the demo never gets a link that dead-ends.
                    <>
                      {' '}
                      <Link href="/transactions/import" className="underline hover:text-foreground">
                        Import a CSV from your bank
                      </Link>{' '}
                      to reach further back.
                    </>
                  )}
                </p>
              ) : null}
            </div>
          ) : (
            <ul className="space-y-2" data-testid="calendar-list">
              {dayVMs.map((day) => (
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
                    {day.netCents !== null && (
                      <span className="tabular-nums text-muted-foreground">
                        {day.netLabel} {formatCents(cents(day.netCents), { signDisplay: 'always' })}
                      </span>
                    )}
                  </div>
                  <ul className="mt-1 space-y-0.5">
                    {day.posted && (
                      <>
                        {day.posted.inCents > 0 && (
                          <li
                            className="flex items-baseline justify-between gap-2 text-sm"
                            data-testid="cal-posted-in"
                          >
                            <span className="flex items-center gap-1.5">
                              <ArrowDownLeft className="size-3.5 text-positive-500" aria-hidden />
                              Money in
                            </span>
                            <span className="tabular-nums text-positive-500">
                              {formatCents(day.posted.inCents, { signDisplay: 'always' })}
                            </span>
                          </li>
                        )}
                        {day.posted.outCents > 0 && (
                          <li
                            className="flex items-baseline justify-between gap-2 text-sm"
                            data-testid="cal-posted-out"
                          >
                            <span className="flex items-center gap-1.5">
                              <ArrowUpRight className="size-3.5 text-muted-foreground" aria-hidden />
                              Money out
                            </span>
                            <span className="tabular-nums">
                              {formatCents(cents(-day.posted.outCents), { signDisplay: 'always' })}
                            </span>
                          </li>
                        )}
                        {day.posted.inCents === 0 &&
                          day.posted.outCents === 0 &&
                          (day.posted.transferCount > 0 || day.posted.excludedCount > 0) && (
                            // A day where money visibly moved must not read "net $0.00"
                            // unexplained (critic F-6): say what the zero is made of.
                            <li className="text-xs text-muted-foreground" data-testid="cal-posted-nonmoney">
                              {[
                                day.posted.transferCount > 0
                                  ? `${day.posted.transferCount} transfer${day.posted.transferCount === 1 ? '' : 's'} between your accounts`
                                  : null,
                                day.posted.excludedCount > 0
                                  ? `${day.posted.excludedCount} row${day.posted.excludedCount === 1 ? '' : 's'} you excluded`
                                  : null,
                              ]
                                .filter(Boolean)
                                .join(' and ')}{' '}
                              — not counted as money in or out.
                            </li>
                          )}
                        {day.posted.handoverRowCount > 0 && (
                          // U.24, the same reason U.16 pairs its panel sentence with a per-ROW
                          // marker (#455 decision 5): the month sentence above states the rule
                          // and a count, and without this the reader has no way to tell WHICH
                          // of the month's days it is about — a bucket to scan rather than a
                          // fact. The unit here is the DAY because that is the unit this page
                          // renders.
                          //
                          // It states the KEEP, never the double. Both critics, independently:
                          // the first draft said "counted on both connections' records", which
                          // asserts the very thing all six sentence authors state as a
                          // CONDITION — whether both feeds reported a given charge is not
                          // knowable from the dates (#455 decision 3), and the keys are minted
                          // per link from the cutover alone, so a released day on which only
                          // one connection reported anything is marked too. On that day the
                          // flat claim is false, beside a specific amount, in the direction
                          // that makes a reader distrust a figure that is correct. The clause
                          // used here is the family's own, shipped in all six authors: both
                          // connections' records ARE kept for the day, unconditionally, which
                          // is what this marker knows.
                          //
                          // U.32: gated on `handoverRowCount` (every released row, unconditional
                          // of type), NOT `countedOnHandoverDays` (money-summed rows only) as the
                          // first draft had it. The narrower gate meant a day whose only released
                          // rows were transfers, reader-excluded or $0 printed a doubled COUNT —
                          // "N transactions in Activity →" below, and `cal-posted-nonmoney`'s own
                          // transfer/excluded tallies — with NO changeover vocabulary anywhere on
                          // the page, because this marker (the page's only source of that
                          // vocabulary per day) stayed silent. The marker's own claim is
                          // unconditionally true regardless of whether the released rows moved a
                          // tile, so nothing about widening the gate makes the sentence itself
                          // less true — it only makes it fire where it was silently owed. No
                          // longer mutually exclusive with `cal-posted-nonmoney`: a day can be
                          // BOTH all-transfer/excluded (zero explained there) AND released
                          // (doubling explained here) at once.
                          <li
                            className="text-xs text-muted-foreground"
                            data-testid="cal-posted-handover-day"
                          >
                            {/* `&rsquo;`, not `&apos;`: the six sentence authors this marker
                                stands beside all use the curly apostrophe, and a reader seeing
                                both forms on one screen reads two voices. */}
                            Both connections&rsquo; records are kept for this day.
                          </li>
                        )}
                        <li className="text-xs">
                          {/* The drill-down IS the register, pre-filtered to this one day — the
                              window rides the link so the rows and the figures above describe
                              the same basis (the O.16 borrowed-total lesson). */}
                          <Link
                            href={`/transactions?from=${day.date}&to=${day.date}`}
                            className="text-muted-foreground underline-offset-2 hover:underline"
                            data-testid="cal-posted-day-link"
                          >
                            {day.posted.count} transaction{day.posted.count === 1 ? '' : 's'}
                            {day.posted.pendingCount > 0
                              ? ` (${day.posted.pendingCount} pending)`
                              : ''}{' '}
                            in Activity →
                          </Link>
                        </li>
                      </>
                    )}
                    {day.events.map((e, i) => (
                      <li key={i} className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="flex items-center gap-1.5">
                          {e.kind === 'card-due' ? (
                            <CreditCard className="size-3.5 text-muted-foreground" aria-hidden />
                          ) : e.kind === 'loan-due' ? (
                            <Landmark className="size-3.5 text-muted-foreground" aria-hidden />
                          ) : e.amountCents >= 0 ? (
                            <ArrowDownLeft className="size-3.5 text-positive-500" aria-hidden />
                          ) : (
                            <ArrowUpRight className="size-3.5 text-muted-foreground" aria-hidden />
                          )}
                          {e.label}
                          {(e.kind === 'card-due' || e.kind === 'loan-due') && (
                            <Badge variant="destructive" className="text-[10px]">
                              due
                            </Badge>
                          )}
                          {(e.kind === 'inflow' || e.kind === 'outflow') && (
                            // K.1: every inflow/outflow event is a scheduled-series projection —
                            // the engine expands them strictly after today (build.ts) — and it
                            // must not read like posted data, which is the owner's exact trust
                            // complaint ("forward data" that is really a series replayed).
                            <Badge variant="outline" className="text-[10px]">
                              scheduled
                            </Badge>
                          )}
                        </span>
                        <span className={`tabular-nums ${e.amountCents >= 0 ? 'text-positive-500' : ''}`}>
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
                      {/* This cell is the FIRST short day, so the figure quoted here is this
                          day's own projected balance — the window's intra-period low belongs
                          to a later date and is named with that date, not implied to be today. */}
                      Projected balance:{' '}
                      {formatCents(result.headline.shortfallDateBalanceCents ?? cents(0))} —
                      {/* audit P2: this dated instruction concerns ONE account — the funding
                          account the projection walks from. The totals above span every
                          account, so the transfer must name its own. Same expression the
                          frozen disclosure uses for the same row (L.19). */}
                      transfer {formatCents(result.headline.recommendation.amountCents)} into{' '}
                      {input.paymentAccount.name} by{' '}
                      {formatISODate(isoDate(result.headline.recommendation.byDate))} to stay
                      covered.
                      {result.headline.worstDipDate &&
                        result.headline.worstDipDate !== day.date &&
                        result.intraPeriodMinimum &&
                        ` Lowest point: ${formatCents(result.intraPeriodMinimum.balanceCents)} on ${formatISODate(isoDate(result.intraPeriodMinimum.date))}.`}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Days up to today show recorded activity on the dates it was reported — open a day to
            see its transactions in Activity. Pending charges are counted and marked; they can
            still change or drop before they post. A due badge on a day that has passed is an
            unpaid amount carried forward, not money that moved — past days net their recorded
            activity only, while days ahead net their projected events.{' '}
            {/* U.32: this caption enumerates what the recorded half counts and, until now,
                omitted the one rule that lists a real transaction twice — the exact
                `closing-a-gap-shrinks-the-disclosure-that-described-it` shape U.20 fixed on the
                register's own caption. Unconditional, matching this paragraph's own voice
                (every other clause here — pending, due badges, estimates — states a RULE, not
                whether it applies to the reader today), and worded as the family's unconditional
                keep, never the double, for the same reason the day marker above is. */}
            <span data-testid="cal-basis-handover-note">
              A day both connections&rsquo; records are kept rather than dropping either — so a
              transaction either one reported is listed once for each, whether or not it moves
              the day&rsquo;s totals.
            </span>{' '}
            Days ahead are
            projections: scheduled income and bills replay at their detected cadence (labeled
            scheduled, from today until they post), and card and loan amounts appear on their
            effective due dates (weekend/holiday dates roll back to the prior business day),
            repeating monthly — future card amounts are estimates, repeating this cycle&apos;s
            amount (the current statement, or the balance estimate when no statement exists)
            until the issuer sends the real one, and each is labeled (est.). Each due day is
            badged here, the dashboard shows your upcoming payment reminders, and email reminders
            activate once an email provider is configured.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
