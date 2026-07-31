/**
 * OAuth redirect support (ROADMAP — real OAuth banks). Two pure pieces drive the
 * resume, and both are covered here:
 *   1. linkTokenParams must register a `redirect_uri` ONLY when configured. An
 *      unset/empty value must be omitted, because Plaid rejects a redirect_uri
 *      that isn't an exact match for one registered in the dashboard — so leaving
 *      it off must keep non-OAuth linking working with zero extra config.
 *   2. isOAuthRedirect must recognise Plaid's `oauth_state_id` return marker
 *      without false-matching unrelated params.
 * The interactive Link iframe is Plaid-hosted and can't be browser-e2e'd (see the
 * note in plaid-actions.test.ts), so these unit tests are the labeled coverage
 * for the redirect wiring.
 */
import { describe, expect, it } from 'vitest';
import { PLAID_DAYS_REQUESTED, linkTokenParams } from '@/lib/providers/plaid';
import {
  OAUTH_LINK_TOKEN_KEY,
  OAUTH_ORIGIN_PATH_KEY,
  isOAuthRedirect,
  readStoredOriginPath,
} from '@/lib/plaid-oauth';

describe('linkTokenParams — redirect_uri is opt-in (configured-only)', () => {
  it('omits redirect_uri when none is provided (non-OAuth linking unaffected)', () => {
    const body = linkTokenParams('user-1');
    // present-but-undefined: JSON.stringify drops it, so Plaid never sees an
    // empty/invalid redirect_uri.
    expect(body.redirect_uri).toBeUndefined();
  });

  it('treats an empty-string redirect URI as unset (omitted)', () => {
    expect(linkTokenParams('user-1', '').redirect_uri).toBeUndefined();
  });

  it('registers the redirect_uri verbatim when configured', () => {
    const body = linkTokenParams('user-1', 'https://www.aimplifi.app/plaid-oauth');
    expect(body.redirect_uri).toBe('https://www.aimplifi.app/plaid-oauth');
  });

  it('keeps the link-token contract: scoped user, transactions product, liabilities + investments only-if-supported', () => {
    const body = linkTokenParams('user-42');
    expect(body.user).toEqual({ client_user_id: 'user-42' });
    expect(body.client_name).toBe('Aimplifi');
    expect(body.products).toEqual(['transactions']);
    // liabilities + investments are best-effort: a depository-only bank still links, and
    // the unsupported product's sync reports the item as unsupported, never failed (4.3).
    expect(body.required_if_supported_products).toEqual(['liabilities', 'investments']);
    expect(body.country_codes).toEqual(['US']);
    expect(body.language).toBe('en');
  });
});

describe('isOAuthRedirect — recognises Plaid’s oauth_state_id handoff marker', () => {
  it('true for a full href returning from an OAuth bank', () => {
    expect(isOAuthRedirect('https://www.aimplifi.app/plaid-oauth?oauth_state_id=abc-123')).toBe(true);
  });

  it('true for a bare query string', () => {
    expect(isOAuthRedirect('?oauth_state_id=abc-123')).toBe(true);
  });

  it('false for a normal page load with no marker', () => {
    expect(isOAuthRedirect('https://www.aimplifi.app/plaid-oauth')).toBe(false);
    expect(isOAuthRedirect('')).toBe(false);
  });

  it('does not false-match a param that merely contains the substring', () => {
    expect(isOAuthRedirect('?not_oauth_state_id_really=1')).toBe(false);
  });
});

describe('OAUTH_LINK_TOKEN_KEY', () => {
  it('is a stable, non-empty storage key', () => {
    expect(typeof OAUTH_LINK_TOKEN_KEY).toBe('string');
    expect(OAUTH_LINK_TOKEN_KEY.length).toBeGreaterThan(0);
  });
});

describe('OAUTH_ORIGIN_PATH_KEY / readStoredOriginPath (Gap 3 §3 critic P1 fix)', () => {
  it('is a stable, non-empty storage key distinct from the link-token key', () => {
    expect(typeof OAUTH_ORIGIN_PATH_KEY).toBe('string');
    expect(OAUTH_ORIGIN_PATH_KEY.length).toBeGreaterThan(0);
    expect(OAUTH_ORIGIN_PATH_KEY).not.toBe(OAUTH_LINK_TOKEN_KEY);
  });

  it('falls back to /accounts when nothing was stashed (this suite runs without a window)', () => {
    // The unit suite runs under vitest's `environment: 'node'` (vitest.config.ts) —
    // no `window`, so the try/catch inside readStoredOriginPath is exactly the path
    // exercised here. This pins the safe default: a resume with no stashed origin
    // (storage unavailable, or Link opened before this fix existed) always has
    // somewhere sane to land, never `undefined`/a crash.
    expect(readStoredOriginPath()).toBe('/accounts');
  });
});

/**
 * Owner-reported 2026-07-31: "How many months of financial data does system
 * pull? Why not more years so I can see trends?"
 *
 * The answer was 90 days, chosen by nobody — Plaid defaults `days_requested` to
 * 90 when the key is absent, so an unset field was a shipped decision. These
 * lock the answer to that question at the one place it is decided.
 */
describe('linkTokenParams — how much history a new link asks for', () => {
  it('asks for history explicitly rather than inheriting Plaid\'s 90-day default', () => {
    const body = linkTokenParams('user-1') as { transactions?: { days_requested?: number } };
    expect(body.transactions?.days_requested).toBeDefined();
    // The defect being locked out is precisely the default, so name it: a drift
    // back to 90 (or to an absent key, caught above) must fail here.
    expect(body.transactions?.days_requested).not.toBe(90);
  });

  it('stays inside the range Plaid documents (1..730), at the maximum', () => {
    // BOUNDED, not pinned: a future trade-off may lower this, and that edit
    // should have to move a bound that explains itself rather than re-copy a
    // literal. 24 months is what the 12-month FI window and the 6-month reports
    // chart need before they can compare a year against the year before it.
    expect(PLAID_DAYS_REQUESTED).toBeGreaterThanOrEqual(365);
    expect(PLAID_DAYS_REQUESTED).toBeLessThanOrEqual(730);
    expect(linkTokenParams('user-1').transactions).toEqual({
      days_requested: PLAID_DAYS_REQUESTED,
    });
  });

  it('sends NO transactions parameter in update mode — Plaid rejects product params beside an access_token', () => {
    // The update-mode branch is the repair/add-an-account door and carries an
    // access_token; days_requested there would break every re-auth, and Plaid
    // documents that it cannot extend an existing Item's history anyway.
    const body = linkTokenParams('user-1', undefined, { accessToken: 'access-sandbox-x' });
    expect(body.transactions).toBeUndefined();
    expect(body.products).toBeUndefined();
  });
});
