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
  compareCardUrgency,
  firstCountedActionCard,
} from '@/lib/engine/account/card-duplicate-view';
import {
  FROZEN_ALL_CLEAR_TESTID,
  FROZEN_CARD_TESTID,
  FROZEN_FIRST_ACTION_TESTID,
  currentCycleAmountSource,
  frozenCardsNote,
  frozenNothingDueNote,
  frozenQuotedBalanceNote,
} from '@/lib/engine/account/feed-dropped-view';
import { formatISODate, formatRelativeDays, isoDate } from '@/lib/dates';
import { formatCents, type Cents } from '@/lib/money';
import { AccountNameControl } from '@/components/finance/account-name-form';
import { CardStatementControl } from '@/components/finance/card-statement-control';

/**
 * The minimum-path interest sentence (audit P2). Names the set the estimate covers —
 * `cardsCount` is the engine's own count of cards with a carried balance AND a datable
 * cycle, never re-derived here — and the exclusions when any exist: undatable cards and
 * next-cycle cards are NOT in the figure, so the sentence says so instead of letting the
 * total read as a complete statement of what a minimum path costs.
 */
export function minimumInterestNote(
  interestCents: number,
  cardsCount: number,
  undatedCards: number,
  nextCycleCards: number,
): string {
  const cardWord = cardsCount === 1 ? 'card' : 'cards';
  const parts: string[] = [];
  if (undatedCards > 0) parts.push(`${undatedCards} card${undatedCards === 1 ? '' : 's'} with no statement date`);
  if (nextCycleCards > 0) parts.push(`${nextCycleCards} next-cycle card${nextCycleCards === 1 ? '' : 's'}`);
  const exclusion =
    parts.length > 0
      ? `; new purchases aren't included, and ${parts.join(' and ')} ${undatedCards + nextCycleCards === 1 ? "isn't" : "aren't"} counted`
      : "; new purchases aren't included";
  // Critic F5: with zero carried cards the "on the 0 cards that carry a balance"
  // clause reads as a fact about nothing — a paid-in-full cycle owes ≈ $0.00,
  // and the sentence should say so plainly, without a count clause.
  const balanceClause =
    cardsCount > 0
      ? ` on the ${cardsCount} ${cardWord} that ${cardsCount === 1 ? 'carries' : 'carry'} a balance`
      : ', because every card is paid in full';
  return `Minimum path costs ≈ ${formatCents(interestCents as Cents)} in interest next cycle${balanceClause} (estimated by the average-daily-balance method at each card's APR${exclusion}).`;
}

export function CardsBreakdown({
  payInFull,
  minimum,
  paymentAccountName,
  today,
  accountOwnerLabel = {},
  householdName = null,
  cardMask = {},
  cardDuplicates = [],
  canRenameCard = false,
  cardRenameById,
  canAddStatementById,
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
  /** Own CREDIT cards only; default false so other callers stay byte-identical. */
  canRenameCard?: boolean;
  cardRenameById?: Record<string, { feedName: string; hasOverlay: boolean }>;
  /** Own manual CREDIT cards only. Linked / demo / partner stay without a writer. */
  canAddStatementById?: Record<string, boolean>;
}) {
  const [scenario, setScenario] = useState<'PAY_IN_FULL' | 'MINIMUM'>('PAY_IN_FULL');
  const result = scenario === 'PAY_IN_FULL' ? payInFull : minimum;

  function renderCardName(cardId: string, cardName: string) {
    const meta = cardRenameById?.[cardId];
    const isPartner = Boolean(accountOwnerLabel[cardId]);
    if (canRenameCard && meta && !isPartner) {
      return (
        <AccountNameControl
          accountId={cardId}
          name={cardName}
          hasOverlay={meta.hasOverlay}
          feedName={meta.feedName}
        />
      );
    }
    return cardName;
  }

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
          {result.headline.firstDueDate ? (
            <>
              Needs{' '}
              <span className="font-semibold text-foreground" data-testid="scenario-required">
                {formatCents(result.headline.requiredCents)}
              </span>{' '}
              {householdName
                ? HOUSEHOLD_COPY.headlineAcrossHousehold(householdName)
                : `in ${paymentAccountName}`}{' '}
              {/* audit P2: the whole-cycle total is dated with the FIRST due — the
                  earliest payment draws first; the last due under-demands late. */}
              by {formatISODate(isoDate(result.headline.firstDueDate))}
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
        <p className="text-sm text-warning-500" data-testid="minimum-interest">
          {minimumInterestNote(
            result.minimumPathInterestCents,
            result.minimumPathInterestCardsCount,
            result.unknownDueDateCards.length,
            // Critic F5: a $0-balance estimated card has nothing for next cycle
            // to count — naming it in the exclusion clause claims something was
            // excluded. Same positive-required filter the engine uses for the
            // due-set (engine.ts).
            result.upcoming.filter((o) => o.cashRequiredCents > 0).length,
          )}
        </p>
      )}

      {(() => {
        // urgency order: soonest effective due date first, manual action before autopay —
        // the comparator is shared with the first-action gate so the two cannot drift.
        const ordered = [...result.cards].sort(compareCardUrgency);
        // "Do this first" is THE imperative on this page, so the card it names must be
        // inside the total printed beside it (P1-17 / C.12). The membership test is the
        // engine's own, shared with the dashboard hero: perDueDate via paintedHeroCards.
        // A next-cycle ESTIMATE lives in `upcoming` — excluded from requiredCents the
        // moment any card has a real statement — yet sorts here by date and could head
        // the list; promoting it instructed the reader to pay a figure no total on this
        // page contains. ($0-due dated cards are absent from paintedHeroCards by design;
        // they can never be the first action, and their rows keep the default label.)
        const firstAction = firstCountedActionCard(result, ordered);
        // The engine's own next-cycle set (engine.ts: upcoming). The row label keys on
        // THIS, not on paintedHeroCards absence (critic P2-6): a $0 this-cycle estimate
        // is in no total either, but it is not next-cycle, and only upcoming membership
        // makes that claim.
        const upcomingIds = new Set(result.upcoming.map((c) => c.cardId));
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
        // $217.99 headline that contained neither. (`upcomingIds` itself is declared above, beside
        // the first-action gate that shares it.)
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
        // TASKS L.18. Only on the genuine all-clear: where the page prints a total, or names
        // undatable cards, the affected rows carry their own notes instead. This branch prints no
        // figure at all, so what is being qualified is the ABSENCE — a card the bank stopped
        // sharing cannot deliver a new statement, and "nothing due this cycle" would cover it
        // silently.
        //
        // Built HERE rather than beside the headline (critic P1-3): `painted` is this page's one
        // expression for what a card is called and exists only in this scope, so the first cut
        // passed the RAW name and two cards both called "CREDIT CARD" were named twice,
        // identically, inches from the headings that tell them apart.
        const allClearFrozen =
          !result.headline.firstDueDate && result.unknownDueDateCards.length === 0
            ? frozenNothingDueNote(
                [...result.cards, ...result.unknownDueDateCards]
                  .filter((c) => c.frozenSince != null)
                  .map((c) => ({
                    label: painted(c.cardId, c.cardName),
                    frozenSince: c.frozenSince as string,
                    ownership: accountOwnerLabel[c.cardId]
                      ? ('partner' as const)
                      : ('reader' as const),
                    // /cards lists cards and nothing else, so this set cannot contain a loan
                    // (TASKS L.19). The two surfaces whose all-clear covers BOTH are the dashboard
                    // Today feed's `frozenDueNote` and the weekly digest.
                    //
                    // This comment used to name the dashboard reminders card, which #369 deleted on
                    // 2026-08-01 — leaving a cards-only exclusion here justified by a surface that
                    // no longer rendered, and the digest email as the only place a frozen loan's
                    // all-clear could reach anyone. TASKS K.5 put the claim back on the dashboard;
                    // this narrowing is safe again because that sentence exists again.
                    kind: 'card' as const,
                    // `missing` describes an undatable LOAN's absent field; a card is never one.
                    missing: null,
                  })),
                { nextStep: 'accounts-route' },
              )
            : null;
        return (
          <>
            {allClearFrozen && (
              <p className="text-xs text-warning-500" data-testid={FROZEN_ALL_CLEAR_TESTID}>
                {allClearFrozen}
              </p>
            )}
            {duplicates && (
              // Above the instruction it qualifies (TASKS L.6): "Do this first: pay CREDIT CARD
              // $6,679.68" is the sentence a double-counted card corrupts, so the reader must meet
              // the caveat before the imperative, not three screens below it.
              <div
                // Announced like the /accounts warning it mirrors: without this a screen-reader
                // user meets the payment instruction with no signal that it is qualified.
                role="alert"
                className="rounded-lg border border-warning-900/50 bg-warning-950/20 px-3 py-2 text-sm"
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
                className="rounded-lg border border-positive-900/50 bg-positive-950/30 px-3 py-2 text-sm"
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
            {/* TASKS L.18. THE instruction on this page gets its own qualifier when the card it
                names is one the bank stopped sharing — a reader may act on this line alone, and it
                sits several rows above that card's own note. Resolved against `firstAction` itself,
                so it can never qualify an instruction about a different card, and it says nothing
                when the first action is on a healthy card even if another card on the page is
                frozen (that one is qualified on its own row).

                Deliberately NOT a third, page-level block over `headline.requiredCents`: every
                frozen card carries its note beside its own amounts directly below, so a total-level
                sentence would be the same fact a third time. The L.6 duplicate block above IS
                page-level, for a reason that does not apply here — a double-count is invisible on
                the individual rows and shows up only in the sum. */}
            {firstAction?.frozenSince != null && (
              <p
                role="alert"
                className="rounded-lg border border-warning-900/50 bg-warning-950/20 px-3 py-2 text-xs text-muted-foreground"
                data-testid={FROZEN_FIRST_ACTION_TESTID}
              >
                {frozenCardsNote(
                  [
                    {
                      cardId: firstAction.cardId,
                      label: painted(firstAction.cardId, firstAction.cardName),
                      frozenSince: firstAction.frozenSince,
                      amountSource: currentCycleAmountSource(firstAction.isEstimated),
                      // Critic P1-1: on a PARTNER's card the builder drops the "check it before
                      // paying" imperative entirely — the reader is not the one paying it — and
                      // says "the bank" rather than claiming a relationship they do not have.
                      ownership: accountOwnerLabel[firstAction.cardId] ? 'partner' : 'reader',
                    },
                  ],
                  { role: 'instruction', nextStep: 'accounts-route' },
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
                        {renderCardName(card.cardId, card.cardName)}
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
                        card gets the neutral label (slice-8 critic F-2). And either
                        imperative is false for a next-cycle ESTIMATE: that figure is
                        in no total on this page (P1-17), so the row says what it is. */}
                    <div className="flex items-baseline justify-between">
                      <span className="text-muted-foreground">
                        {card.isEstimated && upcomingIds.has(card.cardId)
                          ? 'Estimated — next cycle'
                          : owner
                            ? HOUSEHOLD_COPY.cardsPartnerToPayLabel()
                            : 'You must pay'}
                      </span>
                      <span
                        className="text-xl font-semibold tabular-nums"
                        data-testid={`user-action-${card.cardId}`}
                      >
                        {formatCents(card.userActionCents)}
                      </span>
                    </div>
                    {card.userActionCents === 0 && card.autopayCents > 0 && (
                      <p className="text-xs text-positive-500">
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
                    {/* TASKS L.18 — the row's own note, beside the four amounts it qualifies.
                        `role: 'instruction'` because the biggest thing on this card reads "You must
                        pay $X": on a frozen card a payment the reader has already made was never
                        subtracted from it. Rendered for a PARTNER's card too — the amounts and the
                        name are already on screen because the account is shared, so qualifying them
                        discloses nothing further, and a stale figure misleads whoever reads it. */}
                    {card.frozenSince != null && (
                      <p
                        className="mt-2 text-xs text-warning-500"
                        data-testid={`${FROZEN_CARD_TESTID}-${card.cardId}`}
                      >
                        {frozenCardsNote(
                          [
                            {
                              cardId: card.cardId,
                              label: painted(card.cardId, card.cardName),
                              frozenSince: card.frozenSince,
                              amountSource: currentCycleAmountSource(card.isEstimated),
                              // A PARTNER's card: this viewer's /accounts does not list that
                              // connection (L.14 critic F-4), and they are not the one paying it
                              // (critic P1-1). Both follow from ownership, so the builder decides.
                              ownership: owner ? 'partner' : 'reader',
                            },
                          ],
                          { role: 'instruction', nextStep: 'accounts-route' },
                        )}
                      </p>
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
                className="rounded-lg border border-warning-900/50 bg-warning-950/20 px-3 py-2 text-sm"
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
                        {renderCardName(c.cardId, c.cardName)}
                        {/* These are the cards MOST likely to be unnamed — no statement often
                            means a thin issuer feed — so the identity matters more here, not
                            less (#298 critic F4). They are deliberately kept out of
                            `result.cards`, hence their own label pass. */}
                        {identity[c.cardId] ? ` ${identity[c.cardId]}` : ''}
                        {owner ? ` (${owner})` : ''} — balance{' '}
                        {formatCents(c.currentBalanceCents)}
                        {/* TASKS L.18. This is the one figure on the page that is purely a
                            BALANCE — the panel says these cards are in no total, so the claim is
                            not about an amount due but about the number printed on this line. It
                            gets `frozenQuotedBalanceNote`, not the card note, for that reason. The
                            route is already named in this panel's own paragraph above, so the
                            sentence points at nothing and does not repeat it. */}
                        {c.frozenSince != null && (
                          <span
                            className="text-warning-500"
                            data-testid={`${FROZEN_CARD_TESTID}-${c.cardId}`}
                          >
                            {' '}
                            {frozenQuotedBalanceNote(
                              { frozenSince: c.frozenSince },
                              { nextStep: 'nothing' },
                            )}
                          </span>
                        )}
                        {canRenameCard && canAddStatementById?.[c.cardId] && !owner ? (
                          <CardStatementControl accountId={c.cardId} />
                        ) : null}
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
