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

/**
 * Everything the OAuth return page needs to finish the session that was opened: the token
 * to resume with, and — when the session was UPDATE mode — the item it reopened.
 *
 * ONE record, written atomically, because these two facts are only meaningful together.
 * They began as two keys and that was wrong in a way worth recording: two keys with two
 * writers on one page produced a state where a completed link could be discarded. See
 * `storeLinkToken`.
 */
interface StoredLinkSession {
  token: string;
  /** Present ⇒ update mode on this item. Absent ⇒ a NEW connection, which must exchange. */
  updateItemId?: string;
  /**
   * Present ⇒ the owner opened this session from "get the full two years" (TASKS H.6,
   * DECISIONS #424), so a connection that turns out to duplicate one they already have is
   * KEPT rather than handed back to Plaid — it is the one carrying the deeper history.
   *
   * It rides in this record for the same reason the update marker does: an OAuth bank
   * navigates the browser away and takes the calling component's state with it, and the
   * banks that redirect through /plaid-oauth (Chase, Capital One, U.S. Bank) are exactly
   * the ones the owner needs deepened. Losing the intent across that hop would put the
   * deepening link straight back into the discard branch it exists to avoid — silently,
   * and only at the big banks.
   *
   * Mutually exclusive with `updateItemId` by construction: update mode reopens the
   * EXISTING Item, whose history window Plaid has already frozen, so there is no depth to
   * be had down that path and nothing to exempt.
   */
  deepenHistory?: true;
}

/**
 * Stash the session about to be opened. Call this IMMEDIATELY BEFORE `open()`, never at
 * mint time — the stored record must describe the session actually running.
 *
 * Both rules were learned from a fresh-context critic that broke the first version:
 *
 *   1. ONE record, one `setItem`. The first version kept the update marker in a second
 *      key. A partial write (quota) left a token with no marker — and the no-marker
 *      branch is the one that EXCHANGES, so the failure direction was the unsafe one.
 *   2. Stamped at open, not at mint. /accounts renders this alongside the connect
 *      front door, which pre-mints a token on mount and again after every exit. Stamping
 *      at mint let that background writer replace a live update session's record, and let
 *      an abandoned update session's record outlive it — so the return page could exchange
 *      an update token, or, worse, take the update branch for a genuinely new bank and
 *      silently discard a completed link while redirecting as though it had worked.
 *
 * Only one Link session can be open at a time (it is a modal), so a single slot is the
 * right shape — provided it is stamped by whoever is opening it.
 */
export function storeLinkToken(
  token: string,
  updateItemId?: string,
  /** True only from the "get the full two years" door (H.6) — see StoredLinkSession. */
  deepenHistory?: boolean,
): void {
  const session: StoredLinkSession = updateItemId
    ? { token, updateItemId }
    : deepenHistory
      ? { token, deepenHistory: true }
      : { token };
  try {
    window.localStorage.setItem(OAUTH_LINK_TOKEN_KEY, JSON.stringify(session));
  } catch {
    /* localStorage unavailable (e.g. private mode) — OAuth resume just won't persist */
  }
}

/** The stashed session, or null. Tolerates the pre-JSON format (see below). */
function readStoredSession(): StoredLinkSession | null {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(OAUTH_LINK_TOKEN_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      const { token, updateItemId, deepenHistory } = parsed as Record<string, unknown>;
      if (typeof token !== 'string' || token.trim() === '') return null;
      if (typeof updateItemId === 'string' && updateItemId.trim() !== '') {
        return { token, updateItemId };
      }
      // Only the literal `true` this module writes counts. Anything else — a truthy
      // string, a stale shape from another build — reads as absent, which lands on the
      // ORDINARY front door: the link is checked for redundancy exactly as it is today.
      return deepenHistory === true ? { token, deepenHistory: true } : { token };
    }
    return null;
  } catch {
    // A bare token string: a session started on the build before this shipped, whose
    // browser round-trip lands after the deploy. It can only be a NEW connection, since
    // update mode did not exist then — so no marker is exactly right.
    return raw.trim() === '' ? null : { token: raw };
  }
}

/** Read back the link token on the OAuth return page (browser-only). */
export function readStoredLinkToken(): string | null {
  return readStoredSession()?.token ?? null;
}

/**
 * Clear the stashed session once the round-trip is over (success, error, or exit). One
 * record means the token and its update marker cannot survive each other.
 */
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

/**
 * localStorage key holding the Plaid item id when the in-flight Link session is an
 * UPDATE-mode one (TASKS L.10 layer 1) — reopening a bank the user already has, rather
 * than connecting a new one.
 *
 * The return page has to be able to tell the two apart, because their success handling
 * is not merely different but mutually wrong. A NEW connection must exchange its public
 * token; an update-mode session must NOT — Plaid documents that the item's access token
 * is unchanged and the exchange is not repeated. Sending an update-mode token down the
 * exchange path would be an unrequested token operation on a healthy connection, and it
 * is a real path rather than a hypothetical one: the banks that redirect through this
 * page (Chase, Capital One, U.S. Bank) are exactly the ones the owner has.
 *
 * Presence of this key IS the signal, and its value is the item to resync. Same
 * lifecycle as the token and origin path: stashed before Link opens, cleared on every
 * terminal outcome, so a stale key can never mislabel a later session.
 */
/** The in-flight session's item id, or null when this is a NEW connection (browser-only). */
export function readStoredUpdateItemId(): string | null {
  return readStoredSession()?.updateItemId ?? null;
}

/**
 * True when the in-flight session was opened from "get the full two years" (H.6), so the
 * connection it produces must be kept even if every account in it is one the user already
 * has. Defaults to FALSE on anything unreadable — an absent intent costs the owner one
 * repeated attempt, while a fabricated one keeps a connection they did not ask for.
 */
export function readStoredDeepenHistory(): boolean {
  return readStoredSession()?.deepenHistory === true;
}
