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
import { setFlash } from '@/components/finance/flash';
import {
  UPDATE_PULL_FAILED_AWAY as UPDATE_PULL_FAILED,
  updateSuccessFlash,
} from '@/components/finance/plaid-update-copy';
import { linkPlaidAccount, syncPlaidNow } from '@/server/plaid-actions';
import {
  clearStoredLinkToken,
  clearStoredOriginPath,
  isOAuthRedirect,
  readStoredDeepenHistory,
  readStoredLinkToken,
  readStoredOriginPath,
  readStoredUpdateItemId,
} from '@/lib/plaid-oauth';

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
      // Read BEFORE clearing — a big OAuth bank may have been started from any
      // zero-account route (Gap 3 §3 inlined Connect on EmptyDashboard), not just
      // /accounts, so send the user back to where they actually started.
      let origin = readStoredOriginPath();
      // Which flow came back through this page decides what "success" means, and the two
      // handlings are mutually wrong. An UPDATE-mode session reopened a connection the
      // user already has: Plaid states the item's access token is unchanged and the
      // exchange is not repeated (plaid.com/docs/link/update-mode, fetched 2026-07-24),
      // so the work here is simply to pull whatever the user just shared. Exchanging
      // instead would be an unrequested token operation on a healthy connection — and
      // the banks that redirect through this page are precisely the ones this matters
      // for. A NEW connection still exchanges, exactly as before (TASKS L.10 layer 1).
      const updateItemId = readStoredUpdateItemId();
      const finish = updateItemId
        ? syncPlaidNow(updateItemId).then((r) => {
            // Report the outcome, exactly as the non-OAuth path does. Without this the
            // banks that redirect through here — Chase, Capital One, U.S. Bank, i.e. the
            // ones this feature exists for — were the only ones told nothing at all: no
            // "updated", and no word when the transaction pull silently failed. The
            // message is composed by the same module, so the two paths cannot drift.
            if (r.ok) {
              setFlash(
                'accounts',
                updateSuccessFlash({
                  // This page knows an item id, never the bank's name.
                  bank: 'your bank',
                  added: r.added,
                  transactionsFailed: r.transactionsFailed,
                }),
              );
            }
            return {
              ok: r.ok,
              // The reason RIDES the truthful frame rather than replacing it: whatever
              // went wrong here, the connection was already updated before this loaded.
              error: r.error ? `${UPDATE_PULL_FAILED} (${r.error})` : UPDATE_PULL_FAILED,
            };
          })
        : // Read from the SAME stored record as the update marker, and read BEFORE the clear
          // below — an OAuth bank is exactly where losing this would hurt, because the owner's
          // deepest connections (Chase ×3, Capital One ×2, U.S. Bank) all return through here
          // and would otherwise be discarded as redundant with no way to tell why (H.6).
          linkPlaidAccount(publicToken, { deepenHistory: readStoredDeepenHistory() }).then((r) => {
            // This page navigates away the instant it succeeds, so an outcome that needs
            // saying — a redundant link refused, an overlapping one kept (TASKS L.10 layer 2)
            // — has to ride the flash to survive the redirect, the same way the update flow's
            // report does. An ordinary link sets nothing and stays silent.
            //
            // The redirect is RE-POINTED at /accounts when there is something to say, because
            // the flash has exactly one reader (accounts-list) while `origin` is deliberately
            // any route the Connect button mounts on — the dashboard onboarding panel, /cards,
            // /settings. Sending the user back there would have handed their new connection
            // back to Plaid and told them nothing at all (invariant D9), then fired the stale
            // message at them on some later, unrelated visit to /accounts. /accounts is also
            // where every control the message names actually lives.
            if (r.ok && r.notice) {
              setFlash('accounts', r.notice);
              origin = '/accounts';
            }
            return {
              ok: r.ok,
              error: r.error ?? 'Linking failed — please try again.',
            };
          });
      setStatus(updateItemId ? 'Updating your bank connection…' : 'Importing your accounts…');
      void finish
        .then((r) => {
          clearStoredLinkToken();
          clearStoredOriginPath();
          if (!r.ok) {
            setStatus('');
            setError(r.error);
          } else {
            router.replace(origin);
          }
        })
        .catch(() => {
          clearStoredLinkToken();
          clearStoredOriginPath();
          setStatus('');
          setError(
            updateItemId
              ? UPDATE_PULL_FAILED
              : 'Linking failed — please try again.',
          );
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
      const origin = readStoredOriginPath();
      // Read the flow BEFORE clearing, so the fallback names the operation the user
      // actually started: "connection was cancelled" is wrong for someone who was
      // reopening a bank they already have.
      const wasUpdate = readStoredUpdateItemId() !== null;
      clearStoredLinkToken();
      clearStoredOriginPath();
      if (err) {
        setStatus('');
        setError(
          err.display_message ??
            err.error_message ??
            (wasUpdate ? 'Bank update was cancelled.' : 'Bank connection was cancelled.'),
        );
      } else {
        router.replace(origin);
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
