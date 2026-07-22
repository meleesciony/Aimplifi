import { ArrowRight, Sparkles } from 'lucide-react';
import { TrackedActedLink } from '@/components/engagement/tracked-acted-link';
import { SURFACE_LINK_CARD_CLASS } from '@/components/finance/surface-card-styles';

/**
 * Dashboard entry to Ask Aimplifi (DECISIONS #75). The flagship conversational
 * surface the app is named for; discovered via a tappable card rather than an 8th
 * nav icon (the 380px bar is full at 7 — #71/#74). Whole-card link, matching the
 * Trends / Recurring dashboard cards.
 */
const EXAMPLES = ['What can I safely spend?', 'Spending on groceries last month?', 'Any subscriptions to cut?'];

export function AskAimplifiCard() {
  return (
    <TrackedActedLink
      href="/ask"
      subjectKey="ask-aimplifi"
      data-testid="dashboard-ask"
      className={SURFACE_LINK_CARD_CLASS}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="size-4 text-emerald-500" aria-hidden /> Ask Aimplifi
        </div>
        <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Ask anything about your money in plain language — answered from your own data.
      </p>
      {/* plain example prompts (not buttons) — the whole card is the single tap target */}
      <p className="mt-2 text-xs text-muted-foreground">{EXAMPLES.map((e) => `“${e}”`).join('  ·  ')}</p>
    </TrackedActedLink>
  );
}
