'use client';

/**
 * "Connect a bank or brokerage" — Plaid Link front door (DECISIONS #41).
 *
 * OAUTH POPUP NEEDS THE CLICK'S USER GESTURE (#284): Plaid opens an OAuth bank in a
 * popup/new tab, which browsers permit only when `open()` runs inside a real user
 * gesture. So the link token is minted AHEAD of the click (on mount, and again after
 * every terminal outcome) and `open()` is called DIRECTLY in the button's onClick,
 * never from an effect — matching Plaid's official react-plaid-link OAuth example.
 * The /plaid-oauth return page keeps its effect-based re-open (correct for the
 * redirect-return leg).
 *
 * (Historical note: the universal every-bank OAuth failure that dominated a long
 * debugging session was ultimately a Plaid DASHBOARD setting — Data Transparency
 * Messaging use cases were unconfigured, so Link EXITed at institution-select with
 * INVALID_LINK_CUSTOMIZATION. Not an app-code bug. The gesture fix here is still the
 * correct pattern and is kept.)
 *
 * OAuth banks navigate the browser away via the registered redirect URI, destroying
 * this component's state, so the token + origin path are stashed (storeLinkToken /
 * storeOriginPath) for /plaid-oauth to recover and resume Link.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePlaidLink, type PlaidLinkError } from 'react-plaid-link';
import { createPlaidLinkToken, linkPlaidAccount } from '@/server/plaid-actions';
import { clearStoredLinkToken, storeLinkToken, storeOriginPath } from '@/lib/plaid-oauth';

export function ConnectAccountsButton() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** A successful outcome that still needs saying — see the L.10 layer-2 notice below. */
  const [notice, setNotice] = useState<string | null>(null);
  // #256: Plaid's SANDBOX rejects real-world input inside its own Link UI — without
  // this disclosure that reads as a broken app rather than test mode.
  const [sandbox, setSandbox] = useState(false);
  const generating = useRef(false);

  /**
   * Mint a fresh link token so one is READY before the user taps. `showError` is
   * false for the silent pre-arm (a demo user or a Plaid-not-configured gap must not
   * flash an error just from viewing the page); real errors surface only on a real
   * click. Guarded against concurrent mints.
   */
  const generateToken = useCallback(async (showError: boolean) => {
    if (generating.current) return;
    generating.current = true;
    try {
      const r = await createPlaidLinkToken();
      if (r.ok && r.linkToken) {
        setSandbox(r.sandbox === true);
        // NOT stashed here. This runs on mount and after every terminal outcome, on every
        // route that renders this button — so stashing at mint time meant a background
        // re-mint could overwrite the record of a Link session already running (the
        // per-connection update flow renders on this same page). The stash now happens in
        // the click, immediately before open(), so the stored record always describes the
        // session actually open. Found by a fresh-context critic, L.10 slice 2.
        setToken(r.linkToken);
      } else if (showError) {
        setError(r.error ?? 'Could not start bank linking.');
      }
    } catch {
      if (showError) setError('Could not start bank linking — please try again.');
    } finally {
      generating.current = false;
    }
  }, []);

  // Pre-arm on mount so the FIRST tap opens Link synchronously (keeping the gesture).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- generateToken only setState()s AFTER an async server round-trip (createPlaidLinkToken), so this is not a synchronous cascading render; the pre-arm must run on mount so the first click opens() in-gesture (#284).
    void generateToken(false);
  }, [generateToken]);

  const onSuccess = useCallback(
    (publicToken: string) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      // A rejected exchange must NOT silently drop the public_token — clear busy and
      // surface an error, never strand the button on "Connecting…".
      void linkPlaidAccount(publicToken)
        .then((r) => {
          clearStoredLinkToken();
          setToken(null);
          setBusy(false);
          if (!r.ok) setError(r.error ?? 'Linking failed.');
          else {
            // A refused-as-redundant link is a SUCCESS with news: the user ticked accounts and
            // must not be left to infer from a silent refresh that nothing happened. Rendered
            // here rather than flashed to /accounts because this button also lives on pages
            // that never navigate there (invariant D9).
            if (r.notice) setNotice(r.notice);
            router.refresh();
          }
        })
        .catch(() => {
          clearStoredLinkToken();
          setToken(null);
          setBusy(false);
          setError('Linking failed — please try again.');
        });
    },
    [router],
  );

  const onExit = useCallback(
    (err: PlaidLinkError | null) => {
      clearStoredLinkToken();
      // The link token is single-use; drop it and pre-mint a fresh one so the next
      // tap opens Link straight away. A clean user cancel passes err=null and stays quiet.
      setToken(null);
      if (err) {
        setError(err.display_message ?? err.error_message ?? 'Bank connection was cancelled.');
      }
      void generateToken(false);
    },
    [generateToken],
  );

  const { open, ready } = usePlaidLink({ token, onSuccess, onExit });

  function handleClick() {
    setError(null);
    setNotice(null);
    if (ready) {
      // Stamp the session THIS click is about to open, so the OAuth return page resumes
      // the right token and knows this is a NEW connection (it must exchange). Must
      // happen here rather than at mint: see generateToken.
      if (token) storeLinkToken(token);
      storeOriginPath(window.location.pathname);
      // Synchronous open() INSIDE the click — this is what keeps the OAuth bank
      // popup allowed. Never move this into a useEffect.
      open();
    } else {
      // Not armed yet (still minting, token expired, or a demo/config block) — mint
      // one now and surface any error; the token then arms for the next tap.
      void generateToken(true);
    }
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        data-testid="connect-bank-btn"
        disabled={busy}
        onClick={handleClick}
        className="rounded-md border border-emerald-700/40 bg-emerald-950/30 px-3 py-1.5 text-sm font-medium text-emerald-300 hover:bg-emerald-950/50 disabled:opacity-50"
      >
        {busy ? 'Connecting…' : '+ Connect a bank or brokerage (Plaid)'}
      </button>
      {sandbox && (
        <p data-testid="plaid-sandbox-notice" className="text-[11px] text-amber-300/80">
          Plaid is running in <b>sandbox (test) mode</b>: real banks, real logins, and real phone
          numbers won’t work inside the Plaid window — its own screens reject them. Use Plaid’s
          documented sandbox test credentials (e.g. user <span className="font-mono">user_good</span> /
          password <span className="font-mono">pass_good</span>) and its sandbox test phone number for
          any SMS step. To link a real bank, the operator must set production Plaid keys
          (<span className="font-mono">PLAID_ENV=production</span>).
        </p>
      )}
      {error && (
        <p role="alert" data-testid="connect-error" className="text-xs text-red-400">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" data-testid="connect-notice" className="text-xs text-sky-300">
          {notice}
        </p>
      )}
    </div>
  );
}
