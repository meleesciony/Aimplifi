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
 *
 * ONE Link instance PER TOKEN (#282, owner-reported): the launcher below is
 * mounted keyed by the token, so every attempt gets a FRESH usePlaidLink handler.
 * The previous single-hook-reused-across-tokens shape wedged after an ungraceful
 * OAuth close — the modal vanished, no `onExit` fired, and `open()` on the consumed
 * instance did nothing, so the button went dead until a full page refresh AND the
 * exit reason never surfaced. A fresh instance per token fixes the retry and lets
 * onExit actually fire.
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePlaidLink, type PlaidLinkOnExit } from 'react-plaid-link';
import { createPlaidLinkToken, linkPlaidAccount } from '@/server/plaid-actions';
import { clearStoredLinkToken, storeLinkToken, storeOriginPath } from '@/lib/plaid-oauth';

/**
 * A single-use Plaid Link handler for exactly one token. Mounted (keyed by token)
 * only while a link is in flight; auto-opens as soon as the SDK is ready. Because
 * the parent keys it by the token string, a new attempt = a brand-new instance,
 * never a reused/consumed one.
 */
function PlaidLinkLauncher({
  token,
  onSuccess,
  onExit,
}: {
  token: string;
  onSuccess: (publicToken: string) => void;
  onExit: PlaidLinkOnExit;
}) {
  const { open, ready } = usePlaidLink({ token, onSuccess, onExit });
  useEffect(() => {
    if (ready) open();
  }, [ready, open]);
  return null;
}

export function ConnectAccountsButton() {
  const router = useRouter();
  // The in-flight link token. Setting it MOUNTS a fresh launcher; clearing it (on
  // any terminal outcome) unmounts so the next attempt starts clean.
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // #256: Plaid's SANDBOX rejects real-world input inside its own Link UI (real
  // bank logins, real phone numbers) — without this disclosure that reads as a
  // broken app rather than test mode.
  const [sandbox, setSandbox] = useState(false);

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
          setBusy(false);
          if (!r.ok) setError(r.error ?? 'Linking failed.');
          else router.refresh();
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

  const onExit = useCallback<PlaidLinkOnExit>((err, metadata) => {
    clearStoredLinkToken();
    // Clear the token so the launcher unmounts; the NEXT click mounts a fresh one.
    setToken(null);
    // TEMP DIAGNOSTIC (#282): surface Plaid's OWN exit reason on-screen (readable on
    // mobile, no console). Now that each attempt gets a fresh instance, onExit fires
    // reliably instead of being swallowed by a wedged handler. Revert to the plain
    // `if (err)` message once the Chase cause is identified.
    const parts = [
      metadata?.status ? `status=${metadata.status}` : null,
      err?.error_code ? `code=${err.error_code}` : null,
      err?.error_type ? `type=${err.error_type}` : null,
      err?.error_message ?? null,
      metadata?.institution?.name ? `bank=${metadata.institution.name}` : null,
      metadata?.request_id ? `req=${metadata.request_id}` : null,
    ].filter(Boolean);
    const diag = parts.join(' · ') || 'no reason reported by Plaid';
    setError(
      err
        ? (err.display_message ?? err.error_message ?? `Link ended — ${diag}`)
        : `Diagnostic — Link closed without connecting: ${diag}`,
    );
  }, []);

  async function start() {
    if (busy || token) return;
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
      setSandbox(r.sandbox === true);
      // Persist for a possible OAuth round-trip: an OAuth bank navigates the
      // browser away (destroying this component's state), and /plaid-oauth needs
      // the token (and where to send the user back) to resume Link. Harmless for
      // non-OAuth banks — the resume page is never visited.
      storeLinkToken(r.linkToken);
      storeOriginPath(window.location.pathname);
      // Mounts <PlaidLinkLauncher key={token}> which auto-opens once ready.
      setToken(r.linkToken);
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
        {busy ? 'Connecting…' : '+ Connect a bank or brokerage (Plaid)'}
      </button>
      {token && (
        <PlaidLinkLauncher key={token} token={token} onSuccess={onSuccess} onExit={onExit} />
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
    </div>
  );
}
