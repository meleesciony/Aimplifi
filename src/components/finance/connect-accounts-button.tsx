'use client';

/**
 * "Connect a bank or brokerage" — Plaid Link front door (DECISIONS #41). Opens
 * Plaid's hosted Link UI, then hands the public token to the sandbox-validated
 * exchange path (linkPlaidAccount), which pulls accounts, transactions, and
 * liabilities. The link token is fetched ON CLICK (never on render), so the
 * page makes no Plaid network call just by loading.
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePlaidLink } from 'react-plaid-link';
import { createPlaidLinkToken, linkPlaidAccount } from '@/server/plaid-actions';

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
      void linkPlaidAccount(publicToken).then((r) => {
        setToken(null);
        setWantOpen(false);
        setBusy(false);
        if (!r.ok) setError(r.error ?? 'Linking failed.');
        else router.refresh();
      });
    },
    [router],
  );

  const { open, ready } = usePlaidLink({
    token,
    onSuccess,
    onExit: () => setWantOpen(false),
  });

  // Open Plaid Link once the SDK is ready with the freshly-minted token.
  useEffect(() => {
    if (wantOpen && ready) {
      open();
      setWantOpen(false);
    }
  }, [wantOpen, ready, open]);

  async function start() {
    setError(null);
    setBusy(true);
    const r = await createPlaidLinkToken();
    setBusy(false);
    if (!r.ok || !r.linkToken) {
      setError(r.error ?? 'Could not start bank linking.');
      return;
    }
    setToken(r.linkToken);
    setWantOpen(true);
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
