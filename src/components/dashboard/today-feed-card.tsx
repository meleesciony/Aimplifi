'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { NudgeFeed, Proposal } from '@/lib/engine/nudge/types';
import { proposalCopy, whyInputs } from '@/components/dashboard/today-feed-copy';
import { logEngagement } from '@/server/engagement-actions';
import { dismissNudge } from '@/server/nudge-actions';

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
}: {
  feed: NudgeFeed;
  feedAll: NudgeFeed;
}) {
  const [showAll, setShowAll] = useState(false);
  const [sessionDismissed, setSessionDismissed] = useState<ReadonlySet<string>>(new Set());

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
          <ProposalRow proposal={headline} headline onDismiss={dismiss} />
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
                <ProposalRow proposal={p} onDismiss={dismiss} />
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

const TIER_RULE: Record<Proposal['tier'], string> = {
  critical: 'It needs attention soon, so it is ranked at the top and never hidden.',
  action: 'It needs a decision, but there is no deadline pressure yet.',
  opportunity: 'A possible saving — no deadline. Dismiss it and it stays gone until the underlying figure changes.',
  handled: 'Autopay covers this — nothing to do. Shown only so you know it is handled.',
};

function ProposalRow({
  proposal,
  headline = false,
  onDismiss,
}: {
  proposal: Proposal;
  headline?: boolean;
  onDismiss: (p: Proposal) => void;
}) {
  const { title, detail } = proposalCopy(proposal);
  const dismissable = proposal.tier === 'action' || proposal.tier === 'opportunity';

  return (
    <div data-testid={`nudge-${proposal.kind}`} data-tier={proposal.tier}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={headline ? 'font-semibold' : 'font-medium'}>{title}</p>
          <p className="text-muted-foreground">{detail}</p>
        </div>
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
      <details className="mt-1">
        <summary className="cursor-pointer text-xs text-muted-foreground">
          Why am I seeing this?
        </summary>
        {/* The tier RULE plus the verbatim inputs that triggered it (NUDGE_PLAN:80-81).
            Every value here is copied from the proposal, not recomputed. */}
        <p className="mt-1 text-xs text-muted-foreground">{TIER_RULE[proposal.tier]}</p>
        <p className="mt-1 text-xs text-muted-foreground" data-testid="nudge-why-inputs">
          Based on: {whyInputs(proposal)}
        </p>
      </details>
    </div>
  );
}
