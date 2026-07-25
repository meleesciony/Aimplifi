'use client';

/**
 * Per-card breakdown with the pay-in-full ⇄ minimum toggle. Both scenarios are
 * computed server-side by the engine; this component only switches between them.
 */
import { useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { HOUSEHOLD_COPY } from '@/lib/copy/household-copy';
import type { CashNeededResult } from '@/lib/engine/cash-needed/types';
import { CARD_IDENTITY_TESTID, cardIdentityLabels } from '@/components/finance/card-identity-view';
import {
  CARD_DUPLICATE_PAIR_TESTID,
  CARD_DUPLICATE_TESTID,
  type CardDuplicatePairInput,
  type CardMoneyRole,
  cardDuplicateView,
} from '@/lib/engine/account/card-duplicate-view';
import { formatISODate, formatRelativeDays, isoDate } from '@/lib/dates';
import { formatCents } from '@/lib/money';

export function CardsBreakdown({
  payInFull,
  minimum,
  paymentAccountName,
  today,
  accountOwnerLabel = {},
  householdName = null,
  cardMask = {},
  cardDuplicates = [],
}: {
  payInFull: CashNeededResult;
  minimum: CashNeededResult;
  paymentAccountName: string;
  today: string;
  /** cardId → the account's last-4, for the identity line under each card name
   *  (#298). Absent/empty is safe: a card simply renders no identity. */
  cardMask?: Record<string, string | null>;
  /** cardId → owning partner's name, for cards folded in from household scope
   *  (TASKS 4.2 slice 5). Empty for solo/'mine' scope — no badge renders. */
  accountOwnerLabel?: Record<string, string>;
  /** Suspected duplicate pairs among the viewer's own displayed cards (TASKS L.6).
   *  Ids only — every string comes from `cardDuplicateView`, built from the labels
   *  painted below, so the disclosure cannot name a card differently from the card. */
  cardDuplicates?: CardDuplicatePairInput[];
  /** Set ONLY at household scope (slice-8 critic F-3): the joint total is
   *  needed ACROSS the household — attributing it to the viewer's own funding
   *  account would claim a partner's autopay draft must sit there. */
  householdName?: string | null;
}) {
  const [scenario, setScenario] = useState<'PAY_IN_FULL' | 'MINIMUM'>('PAY_IN_FULL');
  const result = scenario === 'PAY_IN_FULL' ? payInFull : minimum;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="group" aria-label="Payment scenario" className="inline-flex rounded-lg border p-0.5">
          <Button
            variant={scenario === 'PAY_IN_FULL' ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={scenario === 'PAY_IN_FULL'}
            onClick={() => setScenario('PAY_IN_FULL')}
            data-testid="toggle-pay-in-full"
          >
            Pay in full
          </Button>
          <Button
            variant={scenario === 'MINIMUM' ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={scenario === 'MINIMUM'}
            onClick={() => setScenario('MINIMUM')}
            data-testid="toggle-minimum"
          >
            Minimum payments
          </Button>
        </div>
        <div className="text-sm text-muted-foreground" aria-live="polite" data-testid="scenario-summary">
          {result.headline.byDate ? (
            <>
              Needs{' '}
              <span className="font-semibold text-foreground" data-testid="scenario-required">
                {formatCents(result.headline.requiredCents)}
              </span>{' '}
              {householdName
                ? HOUSEHOLD_COPY.headlineAcrossHousehold(householdName)
                : `in ${paymentAccountName}`}{' '}
              by {formatISODate(isoDate(result.headline.byDate))}
            </>
          ) : result.unknownDueDateCards.length > 0 ? (
            // Not "nothing due" — we simply cannot date these cards. See
            // CashNeededResult.unknownDueDateCards.
            <span data-testid="scenario-unknown">
              No due dates available — {result.unknownDueDateCards.length} card
              {result.unknownDueDateCards.length === 1 ? '' : 's'} below have no statement yet
            </span>
          ) : (
            'Nothing due this cycle'
          )}
        </div>
      </div>

      {scenario === 'MINIMUM' && result.minimumPathInterestCents !== null && (
        <p className="text-sm text-amber-500" data-testid="minimum-interest">
          Minimum path costs ≈ {formatCents(result.minimumPathInterestCents)} in interest
          next cycle (estimated by the average-daily-balance method at each card&apos;s APR;
          new purchases aren&apos;t included).
        </p>
      )}

      {(() => {
        // urgency order: soonest effective due date first, manual action before autopay
        const ordered = [...result.cards].sort(
          (a, b) =>
            a.effectiveDueDate.localeCompare(b.effectiveDueDate) ||
            b.userActionCents - a.userActionCents,
        );
        const firstAction = ordered.find((c) => c.userActionCents > 0);
        // ONE identity pass over EVERY card the page paints — the dated grid first, then the
        // "No due date yet" panel, i.e. exactly the order they appear down the page.
        //
        // The undated cards are a separate engine list (engine.ts keeps them out of `cards`) and
        // #298 gave them their own `cardIdentityLabels` call so they were not left bare (critic F4).
        // Two SEPARATE passes each guarantee distinctness only within themselves, so a dated
        // "CREDIT CARD" and an undated "CREDIT CARD" with no last-4 between them painted two
        // identical headings and neither was numbered — and the L.6 disclosure below names cards by
        // those headings. Computing both lists together restores the #298 guarantee across the
        // whole page. The number is a within-view marker, re-assigned if the toggle reorders the
        // list, which is why nothing else ever refers to it.
        const displayedCards = [
          ...ordered.map((c) => ({ cardId: c.cardId, cardName: c.cardName })),
          ...result.unknownDueDateCards.map((c) => ({ cardId: c.cardId, cardName: c.cardName })),
        ];
        const identity = cardIdentityLabels(displayedCards, cardMask);
        const painted = (cardId: string, cardName: string) =>
          identity[cardId] ? `${cardName} ${identity[cardId]}` : cardName;
        // Which rows are ACTUALLY inside `headline.requiredCents`. The engine's own selection,
        // read off its own output rather than re-implemented here: `requiredCents` sums
        // `cycleObligations` filtered to `cashRequiredCents > 0`, and `cycleObligations` is
        // precisely `cards` minus `upcoming` — `upcoming` holds the estimated obligations that are
        // dropped wholesale the moment any card has a real statement (engine.ts:214-223). A critic
        // running the engine caught the first cut claiming two estimated $6,679.68 rows inflated a
        // $217.99 headline that contained neither.
        const upcomingIds = new Set(result.upcoming.map((c) => c.cardId));
        // The disclosure is computed from the SCENARIO CURRENTLY ON SCREEN, so the amounts it
        // quotes are the amounts beside the cards — the pay-in-full and minimum figures differ.
        const duplicates = cardDuplicateView(
          cardDuplicates,
          displayedCards.map((c) => {
            const obligation = ordered.find((o) => o.cardId === c.cardId);
            const role: CardMoneyRole = !obligation
              ? { counted: false, reason: 'no-statement' }
              : upcomingIds.has(c.cardId)
                ? { counted: false, reason: 'next-cycle' }
                : obligation.cashRequiredCents > 0
                  ? { counted: true, cents: obligation.cashRequiredCents }
                  : { counted: false, reason: 'nothing-due' };
            return { cardId: c.cardId, label: painted(c.cardId, c.cardName), role };
          }),
        );
        return (
          <>
            {duplicates && (
              // Above the instruction it qualifies (TASKS L.6): "Do this first: pay CREDIT CARD
              // $6,679.68" is the sentence a double-counted card corrupts, so the reader must meet
              // the caveat before the imperative, not three screens below it.
              <div
                // Announced like the /accounts warning it mirrors: without this a screen-reader
                // user meets the payment instruction with no signal that it is qualified.
                role="alert"
                className="rounded-lg border border-amber-900/50 bg-amber-950/20 px-3 py-2 text-sm"
                data-testid={CARD_DUPLICATE_TESTID}
              >
                <p className="font-medium">{duplicates.title}</p>
                <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                  {duplicates.pairs.map((p) => (
                    <li key={p.key} data-testid={`${CARD_DUPLICATE_PAIR_TESTID}-${p.key}`}>
                      {p.sentence} {p.impact}{' '}
                      {/* The basis, never hidden: this is a heuristic sitting directly above a
                          payment instruction, and /accounts shows its strength and reasons too. */}
                      <span className="italic">{p.basis}</span>
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
            {firstAction && (
              <p
                className="rounded-lg border border-emerald-900/50 bg-emerald-950/30 px-3 py-2 text-sm"
                data-testid="do-this-first"
              >
                {accountOwnerLabel[firstAction.cardId] ? (
                  // A PARTNER's card is never an imperative to the reader
                  // (slice-8 critic F-2): it's on the partner's account, and
                  // Aimplifi doesn't decide who pays.
                  HOUSEHOLD_COPY.cardsDueFirstPartner({
                    // The identity rides INTO the partner sentence as well (#298 critic F3):
                    // "Sam should pay Venture $9,250.93" is exactly the reported defect when the
                    // household holds two Ventures.
                    cardName: identity[firstAction.cardId]
                      ? `${firstAction.cardName} ${identity[firstAction.cardId]}`
                      : firstAction.cardName,
                    ownerLabel: accountOwnerLabel[firstAction.cardId],
                    amountCents: firstAction.userActionCents,
                    dateLong: formatISODate(isoDate(firstAction.effectiveDueDate)),
                    when: formatRelativeDays(isoDate(today), isoDate(firstAction.effectiveDueDate)),
                  })
                ) : (
                  <>
                    {/* The identity rides along here too (#298): this is THE instruction, and
                        "pay Venture" is not actionable for a reader who holds two Ventures. */}
                    <span className="font-medium">Do this first:</span> pay {firstAction.cardName}
                    {identity[firstAction.cardId] ? ` ${identity[firstAction.cardId]}` : ''}{' '}
                    {formatCents(firstAction.userActionCents)} by{' '}
                    {formatISODate(isoDate(firstAction.effectiveDueDate))} (
                    {formatRelativeDays(isoDate(today), isoDate(firstAction.effectiveDueDate))}).
                  </>
                )}
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              {ordered.map((card) => {
                const owner = accountOwnerLabel[card.cardId];
                return (
                <Card key={card.cardId} data-testid={`card-${card.cardId}`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="min-w-0 break-words text-base">
                        {card.cardName}
                        {/* A real space, not just the margin: the heading's TEXT content is what a
                            reader copies and what assistive tech reads, and "CREDIT CARD····0977"
                            runs the two together (#298 critic F7). */}
                        {identity[card.cardId] ? ' ' : ''}
                        {identity[card.cardId] && (
                          <span
                            data-testid={`${CARD_IDENTITY_TESTID}-${card.cardId}`}
                            className="ml-2 text-xs font-normal text-muted-foreground"
                          >
                            {identity[card.cardId]}
                          </span>
                        )}
                      </CardTitle>
                      <div className="flex gap-1">
                        {owner && (
                          <Badge variant="outline" data-testid={`card-owner-${card.cardId}`}>
                            {owner}
                          </Badge>
                        )}
                        {card.isEstimated && <Badge variant="outline">est.</Badge>}
                        {card.autopayCents > 0 && <Badge variant="secondary">autopay</Badge>}
                      </div>
                    </div>
                    <CardDescription>
                      Due {formatISODate(isoDate(card.effectiveDueDate))} (
                      {formatRelativeDays(isoDate(today), isoDate(card.effectiveDueDate))})
                      {card.effectiveDueDate !== card.dueDate &&
                        ` · issuer date ${formatISODate(isoDate(card.dueDate))}`}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-1 text-sm">
                    {/* THE answer for this card, biggest thing on it. "You must
                        pay" is true only for the reader's OWN card — a partner's
                        card gets the neutral label (slice-8 critic F-2). */}
                    <div className="flex items-baseline justify-between">
                      <span className="text-muted-foreground">
                        {owner ? HOUSEHOLD_COPY.cardsPartnerToPayLabel() : 'You must pay'}
                      </span>
                      <span
                        className="text-xl font-semibold tabular-nums"
                        data-testid={`user-action-${card.cardId}`}
                      >
                        {formatCents(card.userActionCents)}
                      </span>
                    </div>
                    {card.userActionCents === 0 && card.autopayCents > 0 && (
                      <p className="text-xs text-emerald-500">
                        {owner
                          ? HOUSEHOLD_COPY.cardsPartnerAutopayCovered(owner)
                          : 'Autopay handles it — just keep the cash in place.'}
                      </p>
                    )}
                    <div className="flex justify-between pt-1">
                      <span className="text-muted-foreground">Cash required</span>
                      <span className="tabular-nums">{formatCents(card.cashRequiredCents)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Remaining statement due</span>
                      <span className="tabular-nums">{formatCents(card.remainingDueCents)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Minimum due</span>
                      <span className="tabular-nums">{formatCents(card.minimumDueCents)}</span>
                    </div>
                    {card.autopayCents > 0 && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Autopay will move</span>
                        <span className="tabular-nums">{formatCents(card.autopayCents)}</span>
                      </div>
                    )}
                    {/* Engine notes are second-person by construction ("you must
                        pay the remaining … yourself") — on a PARTNER's card they
                        are replaced with owner-attributed equivalents built from
                        the same structured amounts (slice-8 critic F-2). */}
                    {owner ? (
                      <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                        {card.autopayCents > 0 && card.userActionCents > 0 && (
                          <li>
                            {HOUSEHOLD_COPY.cardsPartnerPartialAutopay(
                              owner,
                              card.autopayCents,
                              card.userActionCents,
                            )}
                          </li>
                        )}
                        <li>{HOUSEHOLD_COPY.cardsPartnerDueNote(owner)}</li>
                      </ul>
                    ) : (
                      card.notes.length > 0 && (
                        <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                          {card.notes.map((n) => (
                            <li key={n}>{n}</li>
                          ))}
                        </ul>
                      )
                    )}
                  </CardContent>
                </Card>
                );
              })}
            </div>
            {result.unknownDueDateCards.length > 0 && (
              // These carry a real balance but nothing datable, so they are excluded
              // from every total above. Listing them is the difference between "you
              // owe nothing" and "we can't tell you when this is due" — the second is
              // the truth, and hiding the card entirely told the first.
              <div
                className="rounded-lg border border-amber-900/50 bg-amber-950/20 px-3 py-2 text-sm"
                data-testid="cards-unknown-due"
              >
                <p className="font-medium">No due date yet</p>
                {/* Deliberately not an instruction: "+ Add statement" exists only on
                    MANUALLY added cards, so it is unfollowable for the connected ones
                    this panel mostly holds (cycle-2 critic P1-1). */}
                <p className="mt-1 text-xs text-muted-foreground">
                  The bank hasn’t sent a statement for these, so they aren’t counted in
                  any figure above. They’ll appear as soon as one arrives. A card you
                  added by hand can carry a statement you enter yourself, from{' '}
                  <Link href="/accounts" className="underline hover:text-foreground">
                    Accounts
                  </Link>
                  .
                </p>
                <ul className="mt-2 space-y-0.5 text-xs">
                  {result.unknownDueDateCards.map((c) => {
                    // Owner-attributed exactly like every other row in this component
                    // (slice-8 critic F-2): a partner's card is never rendered as the
                    // reader's to go and fix.
                    const owner = accountOwnerLabel[c.cardId];
                    return (
                      <li key={c.cardId} data-testid={`card-unknown-${c.cardId}`}>
                        {c.cardName}
                        {/* These are the cards MOST likely to be unnamed — no statement often
                            means a thin issuer feed — so the identity matters more here, not
                            less (#298 critic F4). They are deliberately kept out of
                            `result.cards`, hence their own label pass. */}
                        {identity[c.cardId] ? ` ${identity[c.cardId]}` : ''}
                        {owner ? ` (${owner})` : ''} — balance{' '}
                        {formatCents(c.currentBalanceCents)}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </>
        );
      })()}
    </div>
  );
}
