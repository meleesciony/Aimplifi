/**
 * THE answer, above the fold: how much must be in checking, and by when,
 * to pay every card in full this cycle. Server component — all math comes
 * from the cash-needed engine; nothing is recomputed here. The headline is
 * a Glass-Box number (DECISIONS #178): tap it to see the rows it's made of,
 * reconciled to the penny.
 */
import Link from 'next/link';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { GlassBoxNumber } from '@/components/finance/glass-box';
import {
  CARD_DUPLICATE_PAIR_TESTID,
  CARD_DUPLICATE_TESTID,
  type CardDuplicatePairInput,
  type CardDuplicateView,
  cardDuplicateBalanceView,
  cardDuplicateView,
  paintedHeroCards,
} from '@/lib/engine/account/card-duplicate-view';
import { HOUSEHOLD_COPY } from '@/lib/copy/household-copy';
import { type CashNeededResult, undatedCardsWithBalance } from '@/lib/engine/cash-needed/types';
import { traceCashNeeded } from '@/lib/engine/glass-box/trace';
import { formatISODate, formatRelativeDays, isoDate, type ISODate } from '@/lib/dates';
import { cents, formatCents } from '@/lib/money';

export function CashNeededCard({
  result,
  paymentAccountName,
  today,
  transferSource,
  householdName = null,
  accountOwnerLabel = {},
  cardDuplicates = [],
  cardIdentity = {},
}: {
  result: CashNeededResult;
  paymentAccountName: string;
  today: string;
  /** The real account the transfer can come from (name + live balance). */
  transferSource?: { name: string; balanceCents: number } | null;
  /**
   * Suspected same-card-twice pairs among the viewer's own cards (TASKS L.8). Ids only — every
   * rendered string is built by `card-duplicate-view.ts` from the labels painted below, so the
   * disclosure can never name a card differently from the card.
   *
   * This is the surface #299 deliberately left open: the dashboard reads the very obligations
   * /cards reads, so a both-live duplicate inflates THIS headline too, and until now only /cards
   * said so — a reader who never opened it met the inflated number and nothing else.
   */
  cardDuplicates?: CardDuplicatePairInput[];
  /**
   * cardId → the identity line this PAGE assigned that card (#298 / TASKS L.8). Without one, two
   * duplicate rows paint the same heading and a disclosure naming both of them twice tells the
   * reader nothing. Computed ONCE for the whole dashboard and handed down, never re-derived here:
   * a second pass numbers from 1 over its own list, so "1." would mean a different account here
   * than on the reminders card below (the #299 residual, reproduced across components by a critic).
   */
  cardIdentity?: Record<string, string>;
  /** Set ONLY at household scope (slice-8 critic F-3): a partner's autopay
   *  drafts from THEIR account, so the joint total is needed ACROSS the
   *  household — never claimed to belong in the viewer's funding account. */
  householdName?: string | null;
  /** accountId → owning partner's name at household scope (empty for 'mine').
   *  Without it a partner's undatable card was named here unattributed —
   *  reading as the viewer's own (#277 P2, the slice-8 F-1 class). */
  accountOwnerLabel?: Record<string, string>;
}) {
  const { headline } = result;
  /** A card name, owner-attributed at household scope (payment-reminders idiom). */
  const ownedName = (c: { cardId: string; cardName: string }) => {
    const owner = accountOwnerLabel[c.cardId];
    return owner ? `${c.cardName} (${owner}'s)` : c.cardName;
  };

  if (headline.byDate === null) {
    // "Nothing is due" and "we cannot date anything" are different facts, and only
    // one of them is a claim about the user's money. A card whose issuer never sent
    // a statement (and that has no cycle days to estimate from) carries a real
    // balance the user still owes — saying nothing is due would be false.
    // A card carrying NO balance owes nothing, so "nothing is due" is true for it —
    // raising the amber alert over a closed or paid-off card would be a false alarm,
    // the mirror of the false all-clear this branch exists to prevent. Those cards
    // are still listed on /cards; they just don't take over the hero.
    const unknown = undatedCardsWithBalance(result);
    if (unknown.length > 0) {
      const owed = unknown.reduce((sum, c) => sum + c.currentBalanceCents, 0);
      // This branch sums BALANCES, so a duplicate is counted twice in a figure that is not the
      // cash-needed total — its own claim, hence `cardDuplicateBalanceView` rather than the
      // cycle-total wording. `totalStated` is this branch's own condition, repeated once below:
      // where the balances disagree in sign no total is printed, and claiming one is inflated
      // would send the reader looking for a number that is not on screen.
      const totalStated = unknown.every((c) => c.currentBalanceCents > 0);
      // ONE expression for what this branch paints, so the disclosure's labels and the list below
      // can never drift apart — the label a banner quotes must be the string on screen.
      const paintedUndated = (c: { cardId: string; cardName: string }) =>
        cardIdentity[c.cardId] ? `${ownedName(c)} ${cardIdentity[c.cardId]}` : ownedName(c);
      const duplicates = cardDuplicateBalanceView(
        cardDuplicates,
        unknown.map((c) => ({ cardId: c.cardId, label: paintedUndated(c) })),
        totalStated,
      );
      return (
        <Card data-testid="cash-needed-card" className="border-amber-900/40">
          <CardHeader>
            <CardTitle>Cards: due dates missing</CardTitle>
            <CardDescription data-testid="cash-needed-unknown">
              {unknown.length === 1
                ? `We don’t have a statement or due date for ${ownedName(unknown[0]!)}, so it isn’t in this cycle’s total.`
                : `We don’t have a statement or due date for ${unknown.length} cards, so they aren’t in this cycle’s total.`}{' '}
              {/* Only state a total when every balance points the same way. A set
                  mixing a balance owed with a credit can net to a number that
                  describes neither, so we say nothing rather than something wrong. */}
              {totalStated
                ? `${unknown.length === 1 ? 'Its balance is' : 'Their balances add up to'} ${formatCents(cents(owed))} — that is a balance, not an amount we can say is due.`
                : 'A balance on one of these is not an amount we can say is due.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-xs text-muted-foreground">
            {unknown.length > 1 && (
              // NAMES the cards this branch is about. Without this the branch says "2 cards" and
              // names none — and a fresh-context critic showed that made the disclosure below
              // dishonest by construction: a pair only resolves when BOTH sides are in the list, so
              // the singular sentence above is unreachable whenever the disclosure renders, and the
              // plural one names nobody. The banner would have quoted two headings that appear
              // nowhere on screen, with ordinals indexing a list the reader is never shown — the
              // exact failure the module's "both sides must be displayed" rule exists to prevent.
              // It is also the branch most likely to hold a duplicate (server/finance.ts:445-447).
              <p data-testid="cash-needed-unknown-names">
                No due date yet:{' '}
                {unknown.map((c) => paintedUndated(c)).join(', ')}.
              </p>
            )}
            {duplicates && <DuplicateDisclosure view={duplicates} />}
            {/* No instruction here. The "+ Add statement" control exists ONLY for
                manually-added cards (server/transactions.ts builds cardBilling for
                provider === 'manual', and card-actions.ts refuses anything else), so
                telling the owner of a CONNECTED card to add one sends them looking
                for a button that isn't on their row — cycle-2 critic P1-1. What is
                true for every card is that we re-check daily. */}
            {/* No cadence claim: the daily sweep depends on the deployment's cron
                actually firing, which is UNVERIFIED (docs/STATUS.md Wave 0.3). This
                sentence is true either way. */}
            <p>
              The bank hasn’t sent a statement for{' '}
              {unknown.length === 1 ? 'this card' : 'these cards'} yet. The due date
              appears here as soon as one arrives — there’s nothing to do in the
              meantime.
            </p>
            <p>
              <Link href="/cards" className="underline hover:text-foreground">
                See all cards →
              </Link>
            </p>
          </CardContent>
        </Card>
      );
    }
    return (
      <Card data-testid="cash-needed-card">
        <CardHeader>
          <CardTitle>Cards: nothing due</CardTitle>
          <CardDescription>No card payments are due this cycle.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const covered = headline.shortfallCents === 0;
  // Same fence as the byDate-null branch and the nudge: a $0 paid-off undatable
  // card owes nothing, so it neither retracts the "pay all N cards" claim nor
  // gets named as a withheld balance (L.4 #277-critic P2 — this branch used the
  // raw list and disagreed with the hero/nudge/reminders on one dashboard).
  const unknownWithBalance = undatedCardsWithBalance(result);
  const unknownById = new Map(unknownWithBalance.map((c) => [c.cardId, c]));

  // ── TASKS L.8: identity, then the duplicate disclosure ──────────────────────────────────────
  //
  // ONE identity pass over EVERY card this card paints, in PAINT ORDER: the "Not included" note,
  // then the due-date list, then the estimated next-cycle rows. Two passes would each guarantee
  // distinctness only within themselves — the #298 residual #299 had to fix on /cards — and the
  // disclosure below names cards by exactly these strings, so a heading that repeats makes the
  // sentence name the same card twice and say nothing.
  //
  // Every row here is a row the reader can see. A dated card needing $0 is in neither list (the
  // engine's `due` filter drops it) and is deliberately NOT passed: naming a row this card does
  // not paint would send the reader looking for an entry that is not on screen. /cards lists it,
  // and discloses it there.
  // The row/role derivation is a PURE, separately-tested function (`paintedHeroCards`) because it
  // is the computation that produced #299's P0; inline here it would have been reachable only
  // through Playwright, which the default gate skips. The owner attribution is applied here,
  // where the JSX that paints it lives.
  const paintedRows = paintedHeroCards(result).map((r) => ({
    ...r,
    name: unknownById.has(r.cardId) ? ownedName(unknownById.get(r.cardId)!) : r.cardName,
  }));
  const painted = (cardId: string, name: string) =>
    cardIdentity[cardId] ? `${name} ${cardIdentity[cardId]}` : name;
  const duplicates = cardDuplicateView(
    cardDuplicates,
    paintedRows.map((r) => ({
      cardId: r.cardId,
      label: painted(r.cardId, r.name),
      role: r.role,
    })),
  );

  return (
    <Card data-testid="cash-needed-card" className="border-emerald-900/40">
      <CardHeader className="pb-2">
        <CardDescription>Cash needed for cards this cycle</CardDescription>
        <GlassBoxNumber
          // TASKS L.15 (f): the tapped breakdown lists both rows of the pair inside the very
          // number the disclosure below qualifies — and reconciles to the penny, which reads as
          // confirmation that both belong unless the trace says otherwise.
          trace={traceCashNeeded(
            result,
            cardDuplicates,
            // This card renders the HOUSEHOLD-merged result at household scope, so a row here may
            // be a partner's — and the panel is the one a reader opens to audit the figure (critic
            // P1-1). The same map that keeps the rows above out of second-person copy.
            new Set(Object.keys(accountOwnerLabel)),
          )}
          amountTestId="cash-needed-amount"
          amountClassName="text-3xl font-semibold tracking-tight tabular-nums sm:text-4xl"
          engagementSubjectKey="cash-needed"
        >
          <p className="text-sm text-muted-foreground" data-testid="cash-needed-headline">
            needed{' '}
            {householdName
              ? HOUSEHOLD_COPY.headlineAcrossHousehold(householdName)
              : `in ${paymentAccountName}`}{' '}
            by{' '}
            <span className="font-medium text-foreground">
              {formatISODate(isoDate(headline.byDate))}
            </span>{' '}
            {/* "all" is a claim about EVERY card. It is false the moment one card
                has no due date we can place, so it only survives when there are
                none — otherwise this figure covers the datable cards only. */}
            {unknownWithBalance.length > 0
              ? `to pay the ${headline.cardsDueCount} cards we have due dates for.`
              : `to pay all ${headline.cardsDueCount} cards in full this cycle.`}
          </p>
        </GlassBoxNumber>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Below the figure it qualifies and ABOVE the transfer instruction derived from it
            (the /cards placement rule): "Transfer $X by Friday" is the sentence a double-counted
            card corrupts, so the reader must meet the caveat before the imperative. */}
        {duplicates && <DuplicateDisclosure view={duplicates} />}
        {unknownWithBalance.length > 0 && (
          // The mixed case: a real total for the datable cards, plus at least one
          // balance-carrying card we cannot date. Without this line the figure
          // reads as complete.
          <p className="text-xs text-amber-500" data-testid="cash-needed-unknown-note">
            Not included:{' '}
            {unknownWithBalance.map((c) => painted(c.cardId, ownedName(c))).join(', ')} — no statement or
            due date yet, so {unknownWithBalance.length === 1 ? 'its' : 'their'}{' '}
            balance isn’t in this figure.
          </p>
        )}
        {covered ? (
          <Alert data-testid="covered-alert">
            <AlertTitle>You&apos;re covered</AlertTitle>
            <AlertDescription>
              Projected low point is{' '}
              {result.intraPeriodMinimum
                ? `${formatCents(result.intraPeriodMinimum.balanceCents)} on ${formatISODate(isoDate(result.intraPeriodMinimum.date))}`
                : 'above zero'}{' '}
              — every due date clears without a transfer.
            </AlertDescription>
          </Alert>
        ) : (
          <Alert variant="destructive" data-testid="shortfall-alert">
            <AlertTitle>
              Shortfall of {formatCents(headline.shortfallCents)}
              {headline.shortfallDate
                ? ` on ${formatISODate(isoDate(headline.shortfallDate))}`
                : ''}
            </AlertTitle>
            <AlertDescription>
              {result.intraPeriodMinimum && (
                <span>
                  Projected balance dips to{' '}
                  {formatCents(result.intraPeriodMinimum.balanceCents)} on{' '}
                  {formatISODate(isoDate(result.intraPeriodMinimum.date))}.{' '}
                </span>
              )}
              {headline.recommendation && (
                <span className="font-medium text-foreground" data-testid="transfer-recommendation">
                  Transfer {formatCents(headline.recommendation.amountCents)}
                  {transferSource
                    ? ` from ${transferSource.name} (${formatCents(cents(transferSource.balanceCents))} available)`
                    : ' (e.g. from savings)'}{' '}
                  by {formatISODate(isoDate(headline.recommendation.byDate))} —{' '}
                  {formatRelativeDays(today as ISODate, headline.recommendation.byDate)}.
                  {transferSource &&
                    transferSource.balanceCents < headline.recommendation.amountCents && (
                      <span className="font-normal">
                        {' '}
                        That account alone doesn&apos;t cover it — combine sources or move what you can.
                      </span>
                    )}
                </span>
              )}
              {headline.recommendation && (
                <span className="mt-1.5 block">
                  <Link
                    href={`/calendar?month=${headline.recommendation.byDate.slice(0, 7)}`}
                    className="underline underline-offset-2 hover:no-underline"
                    data-testid="shortfall-calendar-link"
                  >
                    See it on the calendar →
                  </Link>
                </span>
              )}
            </AlertDescription>
          </Alert>
        )}

        <ul className="space-y-1.5" data-testid="due-date-list">
          {result.perDueDate.map((point) => (
            <li
              key={point.date}
              className="grid grid-cols-[auto_1fr_auto] items-baseline gap-x-3 text-sm"
            >
              <span className="whitespace-nowrap text-muted-foreground">
                {formatISODate(isoDate(point.date))}
                <span className="ml-1 text-xs">({formatRelativeDays(today as ISODate, point.date)})</span>
              </span>
              <span className="min-w-0 break-words">
                {point.cards
                  .map(
                    (c) =>
                      `${painted(c.cardId, c.cardName)} ${formatCents(c.amountCents)}${c.autopayCents > 0 ? ' (autopay)' : ''}`,
                  )
                  .join(' + ')}
              </span>
              <span className="font-medium tabular-nums">{formatCents(point.dayTotalCents)}</span>
            </li>
          ))}
          {result.upcoming.map((u) => (
            <li
              key={u.cardId}
              className="grid grid-cols-[auto_1fr_auto] items-baseline gap-x-3 text-sm text-muted-foreground"
            >
              <span className="whitespace-nowrap">{formatISODate(isoDate(u.effectiveDueDate))}</span>
              <span className="min-w-0 break-words">
                {painted(u.cardId, u.cardName)} {formatCents(u.cashRequiredCents)}{' '}
                <Badge variant="outline" className="ml-1 align-middle">
                  est.
                </Badge>
              </span>
              <span className="tabular-nums">next cycle</span>
            </li>
          ))}
        </ul>

        <div className="flex justify-between pt-1">
          <Link
            href="/forecast"
            className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
            data-testid="see-forecast"
          >
            90-day forecast →
          </Link>
          <Link
            href="/cards"
            className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
            data-testid="see-card-breakdown"
          >
            Per-card breakdown →
          </Link>
        </div>

        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">
            Assumptions ({result.assumptions.length})
          </summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-4" data-testid="assumptions-list">
            {result.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </details>
      </CardContent>
    </Card>
  );
}

/**
 * The duplicate disclosure, identical in both branches of this card (TASKS L.8) — and deliberately
 * the same shape /cards renders, because it is the same fact about the same two rows and a reader
 * moving between the two pages should not have to recognise it twice.
 *
 * `role="alert"`: without it a screen-reader user meets the figure, and the transfer instruction
 * under it, with no signal that either is qualified.
 *
 * No dismiss control here, on purpose. The pair is dismissable on /accounts ("not duplicates"), and
 * that answer is honoured server-side before this ever renders — so the way out exists, on the page
 * that owns the decision, rather than being duplicated onto every surface that reports it.
 */
function DuplicateDisclosure({ view }: { view: CardDuplicateView }) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-amber-900/50 bg-amber-950/20 px-3 py-2 text-sm"
      data-testid={CARD_DUPLICATE_TESTID}
    >
      <p className="font-medium">{view.title}</p>
      <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
        {view.pairs.map((p) => (
          <li key={p.key} data-testid={`${CARD_DUPLICATE_PAIR_TESTID}-${p.key}`}>
            {p.sentence} {p.impact} <span className="italic">{p.basis}</span>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-xs text-muted-foreground">
        {view.howTo}{' '}
        <Link href="/accounts" className="underline hover:text-foreground">
          Go to Accounts
        </Link>
        .
      </p>
    </div>
  );
}
