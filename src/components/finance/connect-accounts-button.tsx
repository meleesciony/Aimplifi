'use client';

/**
 * "Connect a bank or brokerage" — Plaid Link front door (DECISIONS #41). Opens
 * Plaid's hosted Link UI, then hands the public token to the sandbox-validated
 * exchange path (linkPlaidAccount), which pulls accounts, transactions, and
 * liabilities. The link token is fetched ON CLICK (never on render), so the
 * page makes no Plaid network call just by loading.
 *
 * OAuth banks (Chase/BofA) redirect the browser to the registered redirect URI,
 * which destroys this component's state — so the freshly-minted token is stashed
 * (storeLinkToken) for /plaid-oauth to recover and resume Link. It's cleared on
 * every terminal outcome (success, error, exit).
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePlaidLink } from 'react-plaid-link';
import { createPlaidLinkToken, linkPlaidAccount } from '@/server/plaid-actions';
import { clearStoredLinkToken, storeLinkToken } from '@/lib/plaid-oauth';

export function ConnectAccountsButton() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [wantOpen, setWantOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSuccess = useCallback(
    (publicToken: string) => {
      setBusy(true);
      setError(null);
      // A rejected exchange (session expiry, network) must NOT silently drop the
      // public_token Plaid just handed us — clear busy and surface an error, never
      // leave the button stuck on "Connecting…" after a successful bank login.
      void linkPlaidAccount(publicToken)
        .then((r) => {
          clearStoredLinkToken();
          setToken(null);
          setWantOpen(false);
          setBusy(false);
          if (!r.ok) setError(r.error ?? 'Linking failed.');
          else router.refresh();
        })
        .catch(() => {
          clearStoredLinkToken();
          setToken(null);
          setWantOpen(false);
          setBusy(false);
          setError('Linking failed — please try again.');
        });
    },
    [router],
  );

  const { open, ready } = usePlaidLink({
    token,
    onSuccess,
    // Surface a real Link error (institution/login failure) instead of silent
    // re-enable; a clean user cancel passes err=null, so it stays quiet.
    onExit: (err) => {
      clearStoredLinkToken();
      setWantOpen(false);
      if (err) setError(err.display_message ?? err.error_message ?? 'Bank connection was cancelled.');
    },
  });

  // Open Plaid Link once the SDK is ready with the freshly-minted token.
  useEffect(() => {
    if (wantOpen && ready) {
      open();
      // eslint-disable-next-line react-hooks/set-state-in-effect -- pre-existing pattern surfaced by the react-hooks v6 upgrade (#166), not this increment's scope
      setWantOpen(false);
    }
  }, [wantOpen, ready, open]);

  async function start() {
    setError(null);
    setBusy(true);
    // try/finally so a rejected action always clears busy — never strand the
    // button disabled on "Connecting…" with no error shown.
    try {
      const r = await createPlaidLinkToken();
      if (!r.ok || !r.linkToken) {
        setError(r.error ?? 'Could not start bank linking.');
        return;
      }
      setToken(r.linkToken);
      // Persist for a possible OAuth round-trip: an OAuth bank navigates the
      // browser away (destroying this component's state), and /plaid-oauth needs
      // the token to resume Link. Harmless for non-OAuth banks.
      storeLinkToken(r.linkToken);
      setWantOpen(true);
    } catch {
      setError('Could not start bank linking — please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        data-testid="connect-bank-btn"
        disabled={busy}
        onClick={start}
        className="rounded-md border border-emerald-700/40 bg-emerald-950/30 px-3 py-1.5 text-sm font-medium text-emerald-300 hover:bg-emerald-950/50 disabled:opacity-50"
      >
        {busy ? 'Connecting…' : '+ Connect a bank or brokerage'}
      </button>
      {error && (
        <p role="alert" data-testid="connect-error" className="text-xs text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
