/**
 * The auth middleware's matcher IS the reachability contract for every
 * bearer-guarded operator route (critic B P0, O.12d): a route excluded from the
 * matcher answers its own auth; a route NOT excluded is 401'd by the session
 * check before its handler ever runs — with a curl, silently. The O.12d repair
 * route shipped unreachable for exactly this reason (executed repro: correct
 * CRON_SECRET bearer → middleware 401 with authjs cookies, handler never ran).
 *
 * The matcher is executed here as the RegExp Next.js compiles it to (the pattern
 * is a plain regex inside the path group), read from the SOURCE so this lock
 * cannot drift from the shipped file. test_regression__o12d-repair-route-behind-
 * middleware: fails on the pre-fix matcher (no `api/repair` exclusion).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = readFileSync('src/middleware.ts', 'utf8');
// Anchor on the pattern's own opening `/((?!` — the comment block above it contains
// apostrophes, so a lazy "first quoted string after matcher:[" match captures prose.
const raw = src.match(/'(\/\(\(\?![^']+)'/)?.[1];
if (!raw) throw new Error('middleware matcher not found in src/middleware.ts');
// The file's single-quoted literal escapes backslashes (`sw\\.js`) — unescape to
// the string VALUE Next.js receives.
const pattern = raw.replace(/\\\\/g, '\\');
const matcher = new RegExp(`^${pattern}$`);
/** true = the auth middleware runs on this path (session required). */
const guarded = (path: string) => matcher.test(path);

describe('middleware matcher — bearer-guarded routes are excluded, app routes stay guarded', () => {
  it('test_regression__o12d-repair-route-behind-middleware: /api/repair/* reaches its own bearer guard', () => {
    expect(guarded('/api/repair/plaid-provider-categories')).toBe(false);
  });

  it('the exclusion is only safe because the repair route carries its own CRON_SECRET guard', () => {
    // Anti-vacuity for the line above: if this route ever drops checkCronBearer,
    // the matcher exclusion becomes an OPEN door, not a delegated guard.
    const route = readFileSync('src/app/api/repair/plaid-provider-categories/route.ts', 'utf8');
    expect(route).toContain('checkCronBearer');
  });

  it('existing bearer/webhook exclusions hold (cron, auth, plaid webhook)', () => {
    expect(guarded('/api/cron/sync')).toBe(false);
    expect(guarded('/api/auth/session')).toBe(false);
    expect(guarded('/api/plaid/webhook')).toBe(false);
  });

  it('app pages and user APIs stay session-guarded', () => {
    for (const p of ['/transactions', '/settings', '/dashboard', '/api/export', '/triage']) {
      expect(guarded(p)).toBe(true);
    }
  });

  it('public pages stay public, and their prefix collisions stay guarded', () => {
    expect(guarded('/privacy')).toBe(false);
    expect(guarded('/sign-in')).toBe(false);
    expect(guarded('/privacy-secret')).toBe(true); // `$` blocks the prefix collision
  });
});
