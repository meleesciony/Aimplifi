'use client';

/**
 * "Add or fix accounts" — Plaid Link in UPDATE mode on a bank the user already has
 * (TASKS L.10 layer 1, docs/ACCOUNT_IDENTITY_ARCHITECTURE.md §4).
 *
 * This is the control that makes the duplicate not happen. Until now the app offered one
 * door — Connect a bank — so a user who wanted to add an account they hadn't shared, or
 * to repair a login that had expired, had no option but to run Link again on a bank they
 * already had. That mints a second Item, and Plaid's `account_id`s are not stable across
 * Items, so the same real card arrives as a brand-new row: a duplicate created by
 * construction, which afterwards can only be detected and disclosed. Through update mode
 * every already-linked account returns with its existing id and takes the account
 * upsert's UPDATE branch, which is a refresh — so no second copy of anything the user
 * already had. (Rows are still written: a newly shared account and its transactions are
 * the whole point. What is avoided is the duplicate, not the write.)
 *
 * One instance per connection, because `usePlaidLink` is a hook and a row can't call one.
 *
 * The public token from an update-mode session is deliberately DISCARDED: Plaid documents
 * that the item's access token is unchanged and the exchange is not repeated
 * (plaid.com/docs/link/update-mode, fetched 2026-07-24). Newly-shared accounts arrive the
 * ordinary way, through the sync that already runs per item.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePlaidLink, type PlaidLinkError } from 'react-plaid-link';
import { setFlash } from '@/components/finance/flash';
import {
  cannotReopenMessage,
  updatePullFailedMessage,
  updateSuccessFlash,
} from '@/components/finance/plaid-update-copy';
import { clearStoredLinkToken, storeLinkToken, storeOriginPath } from '@/lib/plaid-oauth';
import { createPlaidUpdateLinkToken, syncPlaidNow } from '@/server/plaid-actions';

export function PlaidUpdateButton({
  itemId,
  bank,
  which,
  disabled,
  onError,
}: {
  itemId: string;
  /** The bank's display name, or a neutral stand-in when it has none. */
  bank: string;
  /** ", connection 1 of 2" when this bank has more than one — never invented for a single. */
  which: string;
  disabled: boolean;
  onError: (message: string) => void;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Set by the click that asked for a token, consumed by the effect that opens Link, so a
  // token arriving for any other reason never pops a bank window at someone.
  const wantOpen = useRef(false);

  const onSuccess = useCallback(() => {
    setBusy(true);
    void syncPlaidNow(itemId)
      .then((r) => {
        clearStoredLinkToken();
        setToken(null);
        if (!r.ok) {
          setBusy(false);
          // By the time this runs the Link session has ALREADY finished at the bank, so a
          // failure here is the data pull, never the update. Reporting it as "couldn't
          // update" would be false, and worse than false: it would send someone back
          // through Connect a bank — the one action that creates the duplicate copy.
          onError(updatePullFailedMessage(bank, r.error));
          return;
        }
        setFlash(
          'accounts',
          updateSuccessFlash({
            bank,
            added: r.added,
            transactionsFailed: r.transactionsFailed,
          }),
        );
        // Full reload for the same reason Sync and Disconnect do it: every figure on the
        // page is server-rendered from what this just changed.
        window.location.reload();
      })
      .catch(() => {
        clearStoredLinkToken();
        setToken(null);
        setBusy(false);
        onError(updatePullFailedMessage(bank));
      });
  }, [itemId, bank, onError]);

  const onExit = useCallback(
    (err: PlaidLinkError | null) => {
      // The link token is single-use; drop it either way. A clean cancel stays quiet.
      clearStoredLinkToken();
      setToken(null);
      setBusy(false);
      if (err) onError(err.display_message ?? err.error_message ?? 'Bank update was cancelled.');
    },
    [onError],
  );

  const { open, ready } = usePlaidLink({ token, onSuccess, onExit });

  /**
   * Stamp the session about to open, then open it. Stamping here — at every open() site,
   * never at mint — is what keeps the OAuth return page's record describing the session
   * that is actually running; the connect front door on this same page re-mints its own
   * token in the background, and the two used to overwrite each other.
   */
  const stampAndOpen = useCallback(
    (linkToken: string) => {
      storeLinkToken(linkToken, itemId);
      storeOriginPath(window.location.pathname);
      open();
    },
    [itemId, open],
  );

  useEffect(() => {
    if (token && ready && wantOpen.current) {
      wantOpen.current = false;
      setBusy(false);
      stampAndOpen(token);
    }
  }, [token, ready, stampAndOpen]);

  function handleClick() {
    if (busy || disabled) return;
    if (token && ready) {
      // Already armed — open synchronously INSIDE the click, which is what keeps an
      // OAuth bank's popup allowed (#284). This is also the second tap after a first
      // one that minted the token, so a blocked popup costs one more tap, not a dead end.
      stampAndOpen(token);
      return;
    }
    wantOpen.current = true;
    // `busy` is held until the open effect fires — clearing it on token arrival left a
    // window where the button looked idle but the fast path's `ready` was still false, so
    // a second tap minted a second link token (a billed call) and orphaned the first.
    setBusy(true);
    void createPlaidUpdateLinkToken(itemId)
      .then((r) => {
        if (!r.ok || !r.linkToken) {
          wantOpen.current = false;
          setBusy(false);
          onError(r.error ?? cannotReopenMessage(bank, which));
          return;
        }
        setToken(r.linkToken);
      })
      .catch(() => {
        wantOpen.current = false;
        setBusy(false);
        onError(cannotReopenMessage(bank, which));
      });
  }

  return (
    <button
      type="button"
      data-testid="plaid-update"
      aria-label={`Add or fix accounts at ${bank}${which} (Plaid)`}
      disabled={disabled || busy}
      onClick={handleClick}
      className="tap-target inline-flex items-center justify-center rounded-md border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
    >
      {busy ? 'Opening…' : 'Add or fix accounts'}
    </button>
  );
}
