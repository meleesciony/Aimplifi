'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MERCHANT_LINK_CLASS, merchantRegisterHref } from '@/lib/engine/transactions/links';
import { Button } from '@/components/ui/button';
import type { NudgeFeed, Proposal } from '@/lib/engine/nudge/types';
import {
  proposalCopy,
  proposalFrozenNote,
  tierRule,
  whyInputs,
} from '@/components/dashboard/today-feed-copy';
import {
  FROZEN_DUES_TESTID,
  FROZEN_FEED_TESTID,
  frozenNoWarningNote,
} from '@/lib/engine/account/feed-dropped-view';
import { logEngagement } from '@/server/engagement-actions';
import { dismissNudge } from '@/server/nudge-actions';
import { confirmIncomePauseAction, undoIncomePauseAction } from '@/server/income-pause-actions';

/**
 * The "Today" nudge feed (NUDGE_PLAN slice 2). A ranked digest over the SAME engine
 * outputs the cards below already show — reshaped and ordered by the pure
 * `buildNudgeFeed` engine, passed in verbatim. This component only formats, collapses,
 * and wires dismissal; it authors no number and does no money math (every cents/date
 * is copied from the proposal, which copied it from its source engine).
 *
 * Copy is OWNER-NEUTRAL by design — it states the obligation ("Payment due — $500 to
 * pay by Jun 11"), never "you pay". At household scope a partner's card can flow into
 * `data.reminders`; a second-person claim would be a false money statement about who
 * pays (the #221 lesson). The feed never asserts a subject, so it stays honest at
 * every scope. Titles are obligation-neutral too ("Payment due" covers cards AND loans,
 * which the proposal can't tell apart).
 *
 * Dismissal honesty: only ACTION and OPPORTUNITY proposals offer a Dismiss control. A
 * CRITICAL warning is never given a hide button (a material warning is never buried);
 * HANDLED autopay is quiet reassurance with nothing to do. Dismiss collapses in-session
 * immediately and persists via dismissNudge (a no-op for the demo user → reappears on
 * reload). "Show everything" re-renders the full, un-suppressed feed (feedAll, built by
 * the engine with an empty dismissedKeys set) — there is no hidden-items list here.
 */
export function TodayFeedCard({
  feed,
  feedAll,
  canManageIncomePause = false,
}: {
  feed: NudgeFeed;
  feedAll: NudgeFeed;
  /**
   * Whether income-pause confirm/undo controls render (#251). False for the shared
   * demo account — one visitor's "my income stopped" must never mutate the
   * projections every other visitor sees, so demo keeps the nudge read-only (the
   * server actions are fenced regardless; this just avoids offering a dead button).
   */
  canManageIncomePause?: boolean;
}) {
  const router = useRouter();
  const [showAll, setShowAll] = useState(false);
  const [sessionDismissed, setSessionDismissed] = useState<ReadonlySet<string>>(new Set());
  // Income-pause confirm/undo (#251): the mutation-form recipe — own busy state,
  // refresh-on-success (the server re-renders the feed AND the projections from the
  // new state), inline error on failure. Never optimistic: a projection mutation
  // must not appear applied until it is.
  const [pauseBusyKey, setPauseBusyKey] = useState<string | null>(null);
  const [pauseErrorKey, setPauseErrorKey] = useState<string | null>(null);

  async function managePause(p: Proposal, action: 'confirm' | 'undo') {
    if (!p.merchant || pauseBusyKey !== null) return;
    setPauseBusyKey(p.key);
    setPauseErrorKey(null);
    const ok =
      action === 'confirm'
        ? await confirmIncomePauseAction(p.merchant)
        : await undoIncomePauseAction(p.merchant);
    setPauseBusyKey(null);
    if (ok) {
      void logEngagement({ surface: 'dashboard', verb: 'acted', subjectKey: p.subjectKey });
      router.refresh();
    } else {
      setPauseErrorKey(p.key);
    }
  }

  const headlineSubject = feed.headline?.subjectKey ?? null;
  useEffect(() => {
    if (headlineSubject) {
      void logEngagement({ surface: 'dashboard', verb: 'viewed', subjectKey: headlineSubject });
    }
  }, [headlineSubject]);

  const base = showAll ? feedAll : feed;
  // CRITICAL is always visible. Otherwise, in the default view, hide anything the user
  // dismissed this session; "show everything" reveals all (incl. persisted-dismissed).
  const visible = base.ordered.filter(
    (p) => p.tier === 'critical' || showAll || !sessionDismissed.has(p.dismissKey),
  );
  const headline = visible.find((p) => p.tier !== 'handled') ?? null;
  const rest = headline ? visible.filter((p) => p !== headline) : visible;

  const hiddenCount = feedAll.ordered.length - visible.length;

  function dismiss(p: Proposal) {
    setSessionDismissed((prev) => new Set(prev).add(p.dismissKey));
    void dismissNudge(p.dismissKey);
    void logEngagement({ surface: 'dashboard', verb: 'dismissed', subjectKey: p.subjectKey });
  }

  return (
    <Card data-testid="today-feed-card" aria-labelledby="today-feed-title">
      <CardHeader>
        <CardTitle id="today-feed-title">Today</CardTitle>
        <p className="text-sm text-muted-foreground">
          What needs you right now — ranked, with everything autopay handles kept quiet.
        </p>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {headline ? (
          <ProposalRow
            proposal={headline}
            headline
            onDismiss={dismiss}
            canManageIncomePause={canManageIncomePause}
            onPauseAction={managePause}
            pauseBusy={pauseBusyKey === headline.key}
            pauseError={pauseErrorKey === headline.key}
          />
        ) : (
          <p data-testid="today-feed-empty" className="text-muted-foreground">
            {/* `base`, not `feed`, and no literal fallback (L.20 critic cycle, finding C-2). The
                headline is recomputed above over this component's own session-dismiss filter, so
                the engine's all-clear must be readable whenever that filter empties the feed —
                and the literal that used to stand in here knew none of its qualifiers. */}
            {base.emptyReason}
          </p>
        )}

        {/* The frozen DUE rows no proposal above can carry (TASKS K.5) — a frozen card, a frozen
            dated loan, or an undatable frozen loan. Outside the branch above on purpose: a row the
            feed cannot date produces no proposal, so nothing here can ever state this fact for it,
            and gating it on the all-clear meant one live payment being due took a frozen mortgage
            off the page. That was the state between #369 and K.5, and it is the same reasoning that
            already keeps the funding balance below ungated. */}
        {base.frozenDueNote && (
          <p data-testid={FROZEN_DUES_TESTID} className="text-muted-foreground">
            {base.frozenDueNote}
          </p>
        )}

        {/* The frozen funding balance no row above accounts for (TASKS L.20). Read from `base`,
            the same feed the rows are rendered from, so "Show everything" can never move the
            sentence out of step with the proposals it is exclusive with. */}
        {base.fundingFrozen && (
          <p data-testid={FROZEN_FEED_TESTID} className="text-muted-foreground">
            {frozenNoWarningNote(base.fundingFrozen, { nextStep: 'accounts-route' })}
          </p>
        )}

        {rest.length > 0 && (
          <ul className="space-y-2 border-t pt-3" data-testid="today-feed-rest">
            {rest.map((p, i) => (
              // Index in the key: the engine admits two opportunities identical in
              // (kind, merchant, monthlyCents) → identical p.key (select.ts ordering
              // note). Bare p.key would collide in React; the index disambiguates the
              // rows. (Dismissing one still suppresses both — they share a dismissKey by
              // construction; that is an engine-level identity, acknowledged, not a UI bug.)
              <li key={`${p.key}::${i}`}>
                <ProposalRow
                  proposal={p}
                  onDismiss={dismiss}
                  canManageIncomePause={canManageIncomePause}
                  onPauseAction={managePause}
                  pauseBusy={pauseBusyKey === p.key}
                  pauseError={pauseErrorKey === p.key}
                />
              </li>
            ))}
          </ul>
        )}

        {(hiddenCount > 0 || showAll) && (
          <div className="pt-1">
            <Button
              variant="ghost"
              size="sm"
              data-testid="today-feed-show-all"
              onClick={() => setShowAll((v) => !v)}
            >
              {showAll ? 'Show less' : `Show everything${hiddenCount > 0 ? ` (${hiddenCount} hidden)` : ''}`}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ProposalRow({
  proposal,
  headline = false,
  onDismiss,
  canManageIncomePause = false,
  onPauseAction,
  pauseBusy = false,
  pauseError = false,
}: {
  proposal: Proposal;
  headline?: boolean;
  onDismiss: (p: Proposal) => void;
  canManageIncomePause?: boolean;
  onPauseAction?: (p: Proposal, action: 'confirm' | 'undo') => void;
  pauseBusy?: boolean;
  pauseError?: boolean;
}) {
  const { title, detail } = proposalCopy(proposal);
  const frozenNote = proposalFrozenNote(proposal);
  const dismissable = proposal.tier === 'action' || proposal.tier === 'opportunity';
  // Income-pause management (#251): an unconfirmed pause offers "Yes, it's paused"
  // (gates the projection exclusion); a confirmed one (HANDLED) offers Undo. Both
  // hidden for the demo (canManageIncomePause) — the fenced action would no-op.
  const pauseAction =
    proposal.kind === 'income_pause' && canManageIncomePause && onPauseAction && proposal.merchant
      ? proposal.tier === 'handled'
        ? ('undo' as const)
        : ('confirm' as const)
      : null;

  return (
    <div data-testid={`nudge-${proposal.kind}`} data-tier={proposal.tier}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={headline ? 'font-semibold' : 'font-medium'}>{title}</p>
          <p className="text-muted-foreground">{detail}</p>
          {/* Attached to the row whose figure it qualifies, never to the card (TASKS L.20): this
              feed prints the two sharpest instructions in the app, and a qualifier floating above
              a ranked list would not say WHICH amount rests on a balance that stopped moving. */}
          {frozenNote && (
            <p className="text-muted-foreground" data-testid={`nudge-frozen-${proposal.kind}`}>
              {frozenNote}
            </p>
          )}
          {/* O.15 slice 1 — the feed makes the sharpest claims in the app about a
              NAMED merchant ("larger than the typical $11.56 there", "usually
              arrives monthly") and offered no way to check any of them; the only
              action was to dismiss. This is the check.

              A separate affordance rather than a link wrapped around the name
              inside `detail`, and that is deliberate: `detail` is a money
              SENTENCE assembled in today-feed-copy.ts, whose every clause is
              audited copy (the estimate disclosures, the no-shame framing, the
              runway formula). Linkifying a substring of it would mean splitting
              that string into React nodes at each of its four kinds and
              re-auditing all of them — changing money copy to add a link. The
              merchant is already a first-class field on the payload, so the row
              can point at the register without touching a word of what it says.

              Gated on `proposal.merchant` because it is genuinely nullable: the
              copy itself falls back to "this source", and a link reading "View
              charges at this source" would filter the register by nothing.

              The VERB is kind-aware, and that is not a nicety. Exactly two kinds
              carry a merchant (select.ts: `unusual_charge` and `income_pause`),
              and one of them is INCOME — a paycheck. "View charges at Acme
              Payroll" calls a deposit a charge, on the same row whose audited
              copy is careful to describe money that DIDN'T arrive and never says
              "spent" (today-feed-copy.ts:164). Adding a link is no licence to
              undo that; a new sentence beside money copy is money copy. */}
          {proposal.merchant && (
            <p className="mt-0.5">
              <Link
                href={merchantRegisterHref(proposal.merchant)}
                // Keyed by the proposal, not just its kind: ANOMALY_MAX_RESULTS is 3,
                // so three `unusual_charge` rows can render at once and a kind-only
                // testid would resolve to three nodes. The kind stays in the id so
                // existing kind-scoped selectors still read naturally.
                data-testid={`nudge-merchant-link-${proposal.kind}`}
                data-merchant={proposal.merchant}
                className={MERCHANT_LINK_CLASS}
              >
                {proposal.kind === 'income_pause' ? 'View deposits from' : 'View charges at'}{' '}
                {proposal.merchant}
              </Link>
            </p>
          )}
          {pauseError && (
            <p className="text-destructive" data-testid="nudge-income-pause-error" role="alert">
              Couldn’t save that — try again.
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-start gap-1">
          {pauseAction && (
            <Button
              variant="outline"
              size="sm"
              disabled={pauseBusy}
              aria-label={
                pauseAction === 'confirm'
                  ? `Confirm income paused: ${proposal.merchant}`
                  : `Undo income paused: ${proposal.merchant}`
              }
              data-testid={`nudge-income-pause-${pauseAction}`}
              onClick={() => onPauseAction!(proposal, pauseAction)}
            >
              {pauseBusy ? 'Saving…' : pauseAction === 'confirm' ? 'Yes, it’s paused' : 'Undo'}
            </Button>
          )}
          {dismissable && (
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Dismiss: ${title}`}
              data-testid={`nudge-dismiss-${proposal.kind}`}
              onClick={() => onDismiss(proposal)}
            >
              Dismiss
            </Button>
          )}
        </div>
      </div>
      <details className="mt-1">
        <summary className="cursor-pointer text-xs text-muted-foreground">
          Why am I seeing this?
        </summary>
        {/* The tier RULE plus the verbatim inputs that triggered it (NUDGE_PLAN:80-81).
            Every value here is copied from the proposal, not recomputed. Rule line
            comes from the copy module (per-kind honest override — #251 critic F2). */}
        <p className="mt-1 text-xs text-muted-foreground">{tierRule(proposal)}</p>
        <p className="mt-1 text-xs text-muted-foreground" data-testid="nudge-why-inputs">
          Based on: {whyInputs(proposal)}
        </p>
      </details>
    </div>
  );
}
