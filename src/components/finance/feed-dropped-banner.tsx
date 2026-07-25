import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  FEED_DROPPED_TESTID,
  type DroppedAccountInput,
  feedDroppedDashboardNotice,
} from '@/lib/engine/account/feed-dropped-view';

/**
 * Disclosure for accounts a bank has stopped sharing (TASKS L.14). Renders nothing when there are
 * none, so every unaffected user's dashboard is byte-identical — the CurrencyExclusionBanner
 * precedent, and the reason the demo golden stays green.
 *
 * All copy lives in the pure builder (unit-tested); this component only places it. role="status"
 * rather than the Alert default role="alert" for the same reason the currency banner uses it: this
 * is a standing qualifier on the figures, not an interruption.
 *
 * The dashboard carries no account list and no Delete or reconnect control, so the builder is the
 * one that names the Accounts route instead of pointing at anything on this page (L.15: whether a
 * surface can be pointed at is a fact about the surface).
 */
export function FeedDroppedBanner({
  accounts,
  householdFrozenCount = 0,
}: {
  accounts: readonly DroppedAccountInput[];
  /** Partner accounts frozen inside the household figures — a count only (critic F-3). */
  householdFrozenCount?: number;
}) {
  const notice = feedDroppedDashboardNotice(accounts, householdFrozenCount);
  if (!notice) return null;
  return (
    <Alert role="status" data-testid={FEED_DROPPED_TESTID}>
      <AlertTitle>{notice.title}</AlertTitle>
      <AlertDescription>
        <ul className="mb-1 list-none space-y-1">
          {notice.lines.map((line, i) => (
            <li key={i} className="break-words">
              {line}
            </li>
          ))}
        </ul>
        <p className="break-words">
          {notice.body}
          {notice.whereToFix ? ` ${notice.whereToFix}` : ''}
        </p>
      </AlertDescription>
    </Alert>
  );
}
