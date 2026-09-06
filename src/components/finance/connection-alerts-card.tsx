'use client';

import { useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { ConnectionAlert } from '@/lib/engine/sync/health';
import { TrackedActedLink } from '@/components/engagement/tracked-acted-link';
import { PlaidUpdateButton } from '@/components/finance/plaid-update-button';
import { SimplefinAlertReconnect } from '@/components/finance/simplefin-alert-reconnect';

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
 *
 * Plaid rows get update-mode reconnect here (same PlaidUpdateButton as Accounts). SimpleFIN
 * gets Sync now + setup-token reconnect here (same writers as Accounts).
 */
export function ConnectionAlertsCard({ alerts }: { alerts: ConnectionAlert[] }) {
  const [error, setError] = useState<string | null>(null);
  if (alerts.length === 0) return null;
  return (
    <Alert variant="destructive" data-testid="connection-alerts-card">
      <AlertTitle>{alerts.length === 1 ? 'A connection needs reconnecting' : 'Connections need reconnecting'}</AlertTitle>
      <AlertDescription>
        <ul className="space-y-2">
          {alerts.map((a) => (
            <li key={a.connectionId} data-testid="connection-alert-row" className="space-y-1">
              <p>{a.message}</p>
              {a.provider === 'Plaid' ? (
                <PlaidUpdateButton
                  itemId={a.connectionId}
                  bank={a.institution ?? 'this bank'}
                  which=""
                  disabled={false}
                  onError={setError}
                />
              ) : a.provider === 'SimpleFIN' ? (
                <SimplefinAlertReconnect />
              ) : (
                <TrackedActedLink
                  href="/accounts"
                  subjectKey="connection-alerts"
                  className="inline-block font-medium underline underline-offset-2"
                >
                  Reconnect on Accounts
                </TrackedActedLink>
              )}
            </li>
          ))}
        </ul>
        {error ? (
          <p className="mt-2 text-xs" role="alert" data-testid="connection-alert-error">
            {error}
          </p>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
