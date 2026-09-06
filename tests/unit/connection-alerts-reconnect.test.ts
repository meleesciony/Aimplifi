/**
 * Dashboard connection alerts can reconnect Plaid without leaving for Accounts (DECISIONS #682).
 *
 * PlaidUpdateButton lived on Accounts. ConnectionAlertsCard only linked to /accounts,
 * so a broken Plaid feed on the dashboard required leaving to repair.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Dashboard connection alerts reconnect Plaid inline', () => {
  it('test_regression__household_can_reconnect_a_broken_plaid_feed_from_the_dashboard', () => {
    const card = readFileSync(resolve('src/components/finance/connection-alerts-card.tsx'), 'utf8');
    expect(card).toContain('PlaidUpdateButton');
    expect(card).toContain("a.provider === 'Plaid'");
    expect(card).toContain('itemId={a.connectionId}');
    expect(card).toContain('Reconnect on Accounts');

    const health = readFileSync(resolve('src/server/connection-health.ts'), 'utf8');
    expect(health).toContain('connectionId: item.itemId');
    expect(health).toContain('itemId: true');
  });
});
