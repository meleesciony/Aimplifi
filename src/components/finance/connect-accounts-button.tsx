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
import { ACCOUNT_CLEANUP_HEADING } from '@/lib/engine/account/account-cleanup';
import { clearStoredLinkToken, storeLinkToken, storeOriginPath } from '@/lib/plaid-oauth';

export interface ConnectAccountsButtonProps {
  /**
   * Open this session as a DEEPEN-HISTORY link (TASKS H.6, DECISIONS #424) rather than as an
   * ordinary new connection: the owner is re-linking a bank he already has, on purpose, because
   * Plaid freezes an Item's history window when it is created and only a new Item can carry the
   * 730-day maximum. The resulting connection is exempt from the wholly-redundant discard.
   *
   * Same component rather than a sibling because everything difficult here — minting the token
   * ahead of the click so `open()` stays inside the user gesture (#284), stashing the session
   * for the OAuth round-trip, clearing it on every terminal outcome — is identical, and a copy
   * would be a second place for the gesture rule to be got wrong.
   */
  deepenHistory?: boolean;
}

export function ConnectAccountsButton({ deepenHistory = false }: ConnectAccountsButtonProps = {}) {
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
      void linkPlaidAccount(publicToken, { deepenHistory })
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
    [router, deepenHistory],
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
      // The deepen intent is stamped into the SAME record as the token, so it survives the
      // OAuth round-trip that destroys this component — and the banks the owner needs
      // deepened (Chase, Capital One, U.S. Bank) are exactly the ones that take that trip.
      if (token) storeLinkToken(token, undefined, deepenHistory);
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
        data-testid={deepenHistory ? 'deepen-history-btn' : 'connect-bank-btn'}
        disabled={busy}
        onClick={handleClick}
        className="rounded-md border border-emerald-700/40 bg-emerald-950/30 px-3 py-1.5 text-sm font-medium text-emerald-300 hover:bg-emerald-950/50 disabled:opacity-50"
      >
        {busy
          ? 'Connecting…'
          : deepenHistory
            ? 'Get the full two years of history'
            : '+ Connect a bank or brokerage (Plaid)'}
      </button>
      {deepenHistory && (
        <p data-testid="deepen-history-explainer" className="text-[11px] text-slate-400">
          Plaid fixes how far back a connection can see at the moment it is created, and it can’t
          be widened afterwards — so reaching two years means connecting the bank again and
          keeping the new connection. Pick the same bank, and share <b>the same accounts</b> you
          shared before. You’ll have two connections to that bank and its accounts will count
          twice until you combine them under “{ACCOUNT_CLEANUP_HEADING}” on this page, keeping the
          new one.
        </p>
      )}
      {deepenHistory && (
        // NOT "your categories and notes stay" — a fresh-context critic executed the combine and
        // showed otherwise: the cutover clamps to the OLD account's first transaction whenever
        // the new connection reaches further back, which is the defining property of a
        // successful deepen. Everything the old side recorded after that one day stops counting
        // in favour of the new connection's untouched copies. No money moves and nothing is
        // deleted, but hand-filed work does stop being reflected — so this says so rather than
        // promising the opposite. Carrying those fields across is the next slice (TASKS H.6b).
        <p data-testid="deepen-history-caveat" className="text-[11px] text-amber-300/80">
          One caveat worth reading first: when you combine, each account starts reading from the
          new connection’s copy of its transactions, so categories, notes and splits you set by
          hand on the older copies stop being applied. Nothing is deleted and no balance changes
          — but if you’ve done a lot of hand-categorising at this bank, deepen it last.
        </p>
      )}
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
