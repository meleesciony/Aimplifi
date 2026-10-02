/**
 * SimpleFIN is retired as a way IN, and only as a way in (DECISIONS #780).
 *
 * Two halves, and the second matters as much as the first: nothing offers a new
 * SimpleFIN connection, and everything a reader who already used it depends on is
 * still there — the connected panel, the sync and disconnect actions, the dashboard
 * alert's repair path, and the stored data's read paths (which have their own suites).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SETTINGS_CONNECTIONS_BODY } from '@/lib/copy/settings-connections-copy';
import {
  CONNECT_ONBOARDING_FOOTNOTE,
  CONNECT_ONBOARDING_HEADING,
  EMPTY_DASHBOARD_DESCRIPTION,
  GET_STARTED_DESCRIPTION,
} from '@/lib/copy/onboarding-empty-copy';

const src = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('nothing offers a new SimpleFIN connection', () => {
  const panel = src('src/components/finance/connect-simplefin.tsx');

  it('the Accounts-page panel has no connect door, no token form, and cannot call the connect action', () => {
    expect(panel).not.toMatch(/simplefin-connect-btn|simplefin-form|simplefin-token|simplefin-submit/);
    // (Its header comment names the action; what matters is that it is neither imported nor called.)
    expect(panel).not.toMatch(/import \{[^}]*\bconnectSimplefin\b/);
    expect(panel).not.toMatch(/\bconnectSimplefin\(/);
    expect(panel).not.toMatch(/setup token/i);
  });

  it('it renders nothing for a reader with no connection and no stranded accounts', () => {
    expect(panel).toMatch(/if \(!orphaned\) return null;/);
  });

  it('the first-run panel renders nothing of it', () => {
    // (A comment there records that it used to; no import, component or test id remains.)
    expect(src('src/components/onboarding/connect-onboarding-panel.tsx')).not.toMatch(
      /connect-simplefin|ConnectSimplefin|SimplefinConnection|simplefin-/,
    );
  });

  it('no first-run or settings copy names it', () => {
    for (const copy of [
      SETTINGS_CONNECTIONS_BODY,
      CONNECT_ONBOARDING_HEADING,
      CONNECT_ONBOARDING_FOOTNOTE,
      EMPTY_DASHBOARD_DESCRIPTION,
      GET_STARTED_DESCRIPTION,
    ]) {
      expect(copy).not.toMatch(/simplefin/i);
    }
  });
});

describe('what an existing SimpleFIN reader depends on is still there', () => {
  it('an existing connection is still shown, synced and disconnected from the Accounts page', () => {
    const panel = src('src/components/finance/connect-simplefin.tsx');
    for (const id of ['simplefin-connected', 'simplefin-sync', 'simplefin-disconnect', 'simplefin-history', 'simplefin-disconnect-note']) {
      expect(panel, id).toContain(id);
    }
    expect(panel).toMatch(/syncSimplefinNow/);
    expect(panel).toMatch(/disconnectSimplefin/);
    expect(src('src/components/finance/accounts-list.tsx')).toMatch(/<SimplefinConnection /);
  });

  it('says, before Disconnect is pressed, that it cannot be undone any more', () => {
    expect(src('src/components/finance/connect-simplefin.tsx')).toContain('Disconnecting is final: SimpleFIN is no longer offered');
  });

  it('accounts that outlived their connection are still told so, and pointed at the way a bank is linked now', () => {
    const panel = src('src/components/finance/connect-simplefin.tsx');
    expect(panel).toContain('simplefin-disconnected-notice');
    expect(panel).toContain('Your saved transactions are kept.');
    expect(panel).toContain('connect that bank with the button below');
    // The button the notice points at is rendered after the panel on the same page.
    const list = src('src/components/finance/accounts-list.tsx');
    expect(list.indexOf('<ConnectAccountsButton />')).toBeGreaterThan(list.indexOf('<SimplefinConnection '));
  });

  it('the server actions behind an existing connection are untouched', () => {
    const actions = src('src/server/simplefin-actions.ts');
    for (const name of ['connectSimplefin', 'syncSimplefinNow', 'disconnectSimplefin']) {
      expect(actions, name).toMatch(new RegExp(`export async function ${name}\\b`));
    }
  });

  it('the dashboard alert can still repair an existing connection', () => {
    const alert = src('src/components/finance/simplefin-alert-reconnect.tsx');
    expect(alert).toMatch(/syncSimplefinNow/);
    expect(alert).toMatch(/connectSimplefin/);
    expect(src('src/components/finance/connection-alerts-card.tsx')).toMatch(/SimplefinAlertReconnect/);
  });
});
