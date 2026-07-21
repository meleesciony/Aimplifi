'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { NudgeFeed, Proposal } from '@/lib/engine/nudge/types';
import { proposalCopy, tierRule, whyInputs } from '@/components/dashboard/today-feed-copy';
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
            {feed.emptyReason ?? 'Nothing needs you today.'}
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
