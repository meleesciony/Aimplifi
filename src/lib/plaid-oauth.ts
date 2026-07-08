/**
 * Plaid OAuth redirect support (ROADMAP — real OAuth banks). The big banks
 * (Chase, Bank of America, …) don't authenticate inside Plaid's iframe: they hand
 * the user off to the bank's own website, which then redirects the BROWSER back to
 * a pre-registered redirect URI. That redirect is a full page navigation, so the
 * Connect button's in-memory Plaid Link handler and its React state are gone by
 * the time we land. To resume Link on the return page we must (a) recognise that
 * we arrived via an OAuth redirect and (b) recover the original `link_token` we
 * stashed before Link opened.
 *
 * `isOAuthRedirect` is pure and unit-tested (tests/unit/plaid-oauth.test.ts). The
 * storage wrappers touch `window.localStorage`, so they're browser-only and guard
 * every access — `window` is referenced ONLY inside function bodies, never at
 * module load, so this module imports cleanly under Node (Vitest) too.
 */

/** localStorage key holding the in-flight link_token across the OAuth round-trip. */
export const OAUTH_LINK_TOKEN_KEY = 'aimplifi.plaid.link_token';

/**
 * True when the current URL is a Plaid OAuth redirect back into the app. After an
 * OAuth bank authenticates the user, Plaid appends `oauth_state_id` to the
 * registered redirect URI; its presence is the documented signal to re-initialise
 * Link with `receivedRedirectUri`. Accepts a full href or a bare query string.
 */
export function isOAuthRedirect(urlOrSearch: string): boolean {
  if (!urlOrSearch) return false;
  const search = urlOrSearch.includes('?')
    ? urlOrSearch.slice(urlOrSearch.indexOf('?'))
    : urlOrSearch;
  return new URLSearchParams(search).has('oauth_state_id');
}

/** Stash the in-flight link token before opening Link (browser-only; no-op on failure). */
export function storeLinkToken(token: string): void {
  try {
    window.localStorage.setItem(OAUTH_LINK_TOKEN_KEY, token);
  } catch {
    /* localStorage unavailable (e.g. private mode) — OAuth resume just won't persist */
  }
}

/** Read back the link token on the OAuth return page (browser-only). */
export function readStoredLinkToken(): string | null {
  try {
    return window.localStorage.getItem(OAUTH_LINK_TOKEN_KEY);
  } catch {
    return null;
  }
}

/** Clear the stashed link token once the round-trip is over (success, error, or exit). */
export function clearStoredLinkToken(): void {
  try {
    window.localStorage.removeItem(OAUTH_LINK_TOKEN_KEY);
  } catch {
    /* nothing to clear / storage unavailable — non-fatal */
  }
}

/**
 * localStorage key holding the page the user was on when they opened Link — so
 * the OAuth return page can send them back to where they started (Gap 3 §3
 * critic P1: ConnectAccountsButton is no longer /accounts-only, it's inlined on
 * EmptyDashboard across 13 routes; a hardcoded post-OAuth '/accounts' redirect
 * would strand a dashboard-onboarding user off the guided flow after a big
 * OAuth bank like Chase/BofA). Same lifecycle and storage pattern as the link
 * token: stashed before Link opens, cleared on every terminal outcome.
 */
export const OAUTH_ORIGIN_PATH_KEY = 'aimplifi.plaid.origin_path';

/** Stash the page Link was opened from (browser-only; no-op on failure). */
export function storeOriginPath(path: string): void {
  try {
    window.localStorage.setItem(OAUTH_ORIGIN_PATH_KEY, path);
  } catch {
    /* localStorage unavailable — OAuth resume just won't remember the origin */
  }
}

/**
 * Read back the origin path on the OAuth return page (browser-only). Falls back
 * to /accounts — a safe default that always has a bank-connect entry point —
 * when nothing was stashed (storage unavailable, or Link opened before this
 * origin-tracking existed).
 */
export function readStoredOriginPath(): string {
  try {
    return window.localStorage.getItem(OAUTH_ORIGIN_PATH_KEY) ?? '/accounts';
  } catch {
    return '/accounts';
  }
}

/** Clear the stashed origin path once the round-trip is over (success, error, or exit). */
export function clearStoredOriginPath(): void {
  try {
    window.localStorage.removeItem(OAUTH_ORIGIN_PATH_KEY);
  } catch {
    /* nothing to clear / storage unavailable — non-fatal */
  }
}
