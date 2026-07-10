import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { ConnectionAlert } from '@/lib/engine/sync/health';
import { TrackedActedLink } from '@/components/engagement/tracked-acted-link';

/**
 * Dashboard reconnect alert when a linked feed's last sync actually FAILED (Gap 1 §4) —
 * the most material heads-up a tracker can send, so it sits at the top with the other
 * connection-health surfaces and uses the destructive variant (an interruption, unlike
 * the softer "your data may be old" staleness banner).
 *
 * Renders nothing when there are no broken connections, so the demo user and every
 * healthy or merely-quiet feed see nothing (no false alarm). Every message is the pure,
 * unit-tested `connectionAlertMessage` — it never echoes the recorded error text, which
 * could carry a credentialed URL.
 */
export function ConnectionAlertsCard({ alerts }: { alerts: ConnectionAlert[] }) {
  if (alerts.length === 0) return null;
  return (
    <Alert variant="destructive" data-testid="connection-alerts-card">
      <AlertTitle>{alerts.length === 1 ? 'A connection needs reconnecting' : 'Connections need reconnecting'}</AlertTitle>
      <AlertDescription>
        <ul className="space-y-1">
          {alerts.map((a) => (
            <li key={a.connectionId} data-testid="connection-alert-row">
              {a.message}
            </li>
          ))}
        </ul>
        <TrackedActedLink
          href="/accounts"
          subjectKey="connection-alerts"
          className="mt-1 inline-block font-medium underline underline-offset-2"
        >
          Go to Accounts
        </TrackedActedLink>
      </AlertDescription>
    </Alert>
  );
}
