'use client';

/**
 * Plaid OAuth return page (ROADMAP — real OAuth banks). This is the URL registered
 * as the Plaid `redirect_uri`. A big OAuth bank (Chase/BofA) sends the user to the
 * bank's own site to authenticate, then redirects the BROWSER back here with an
 * `oauth_state_id` — a full navigation that destroyed the Connect button's React
 * state. We recover the link_token stashed before Link opened and re-initialise
 * Plaid Link with `receivedRedirectUri = current URL`, which resumes the exact
 * handoff. Non-OAuth banks never reach this page.
 *
 * The interactive Link step is Plaid-hosted and can't be browser-e2e'd (see
 * plaid-actions.test.ts); the pure resume logic (isOAuthRedirect + the storage
 * key) is unit-tested in tests/unit/plaid-oauth.test.ts.
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePlaidLink } from 'react-plaid-link';
import { linkPlaidAccount } from '@/server/plaid-actions';
import { clearStoredLinkToken, isOAuthRedirect, readStoredLinkToken } from '@/lib/plaid-oauth';

export default function PlaidOAuthReturnPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('Finishing your bank connection…');

  // Recover the in-flight link token. Runs once on mount (client only).
  useEffect(() => {
    if (!isOAuthRedirect(window.location.href)) {
      // Opened without an OAuth handoff — nothing to resume.
      router.replace('/accounts');
      return;
    }
    const stored = readStoredLinkToken();
    if (!stored) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- pre-existing pattern surfaced by the react-hooks v6 upgrade (#166), not this increment's scope
      setStatus('');
      setError('Your bank connection session expired. Please start the connection again.');
      return;
    }
    setToken(stored);
  }, [router]);

  const onSuccess = useCallback(
    (publicToken: string) => {
      setStatus('Importing your accounts…');
      void linkPlaidAccount(publicToken)
        .then((r) => {
          clearStoredLinkToken();
          if (!r.ok) {
            setStatus('');
            setError(r.error ?? 'Linking failed — please try again.');
          } else {
            router.replace('/accounts');
          }
        })
        .catch(() => {
          clearStoredLinkToken();
          setStatus('');
          setError('Linking failed — please try again.');
        });
    },
    [router],
  );

  const { open, ready } = usePlaidLink({
    token,
    // Hand Plaid the redirect URI only once we actually hold the token to resume.
    // Passing it with token=null makes the SDK try (and fail) to initialize Link and
    // log "Error initializing Plaid Link"; with no token we show the session-expired
    // UI instead. On a real resume the token and the URI become present together.
    receivedRedirectUri: token && typeof window !== 'undefined' ? window.location.href : undefined,
    onSuccess,
    onExit: (err) => {
      clearStoredLinkToken();
      if (err) {
        setStatus('');
        setError(err.display_message ?? err.error_message ?? 'Bank connection was cancelled.');
      } else {
        router.replace('/accounts');
      }
    },
  });

  // Auto-reopen Link to complete the OAuth handoff as soon as it's ready.
  useEffect(() => {
    if (token && ready) open();
  }, [token, ready, open]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-8 text-center">
      {error ? (
        <>
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
          <button
            type="button"
            onClick={() => router.replace('/accounts')}
            className="rounded-md border border-emerald-700/40 bg-emerald-950/30 px-3 py-1.5 text-sm font-medium text-emerald-300 hover:bg-emerald-950/50"
          >
            Back to accounts
          </button>
        </>
      ) : (
        <p className="text-sm text-neutral-400">{status}</p>
      )}
    </main>
  );
}
