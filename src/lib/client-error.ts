/**
 * Client-side error reports (DECISIONS #794).
 *
 * The app had no eyes in the browser: `(app)/error.tsx` reports to Sentry only
 * with a DSN, and a page whose JavaScript dies BEFORE React takes over never
 * reaches a boundary at all — the server HTML stays on screen and every button
 * is dead, with nothing in any log. That is exactly the owner's 2026-10-07
 * report ("the × does nothing") on a page the demo cannot reproduce. These
 * helpers are the pure half: what a report is, what is worth sending, and the
 * caps that keep a hostile client from logging megabytes. The browser half
 * (`components/client-error-reporter.tsx`) listens; the server half
 * (`api/client-error/route.ts`) writes one structured log line.
 */

export type ClientErrorKind = 'error' | 'unhandledrejection' | 'hydration';

export interface ClientErrorReport {
  kind: ClientErrorKind;
  message: string;
  stack?: string;
  /** The pathname the page was on (never the query string — it can carry ids). */
  route: string;
  userAgent: string;
}

export const MAX_MESSAGE_LEN = 500;
export const MAX_STACK_LEN = 2000;
export const MAX_ROUTE_LEN = 200;
export const MAX_UA_LEN = 300;
/** Per page load, in the browser: enough to see a cascade, not a loop. */
export const MAX_REPORTS_PER_PAGE = 5;
/** Per user per minute, on the server. */
export const REPORT_LIMIT = 20;
export const REPORT_WINDOW_MS = 60_000;

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const KINDS: ReadonlySet<string> = new Set(['error', 'unhandledrejection', 'hydration']);

function clip(s: unknown, max: number): string {
  return (typeof s === 'string' ? s : '').replace(EMAIL_RE, '[redacted-email]').slice(0, max);
}

/**
 * Validate and cap a report from the wire. `null` for anything that is not a
 * report — the route answers 400 and logs nothing, so a forged body cannot
 * write what it likes into the log.
 */
export function parseClientErrorReport(body: unknown): ClientErrorReport | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (typeof b.kind !== 'string' || !KINDS.has(b.kind)) return null;
  const message = clip(b.message, MAX_MESSAGE_LEN);
  if (!message) return null;
  const route = clip(b.route, MAX_ROUTE_LEN);
  const stack = clip(b.stack, MAX_STACK_LEN);
  return {
    kind: b.kind as ClientErrorKind,
    message,
    ...(stack ? { stack } : {}),
    route: route.split('?')[0] || '/',
    userAgent: clip(b.userAgent, MAX_UA_LEN),
  };
}

/**
 * React's hydration failures are not thrown — they are `console.error`ed
 * ("Hydration failed because…", "There was an error while hydrating…", or in
 * production the minified "Minified React error #418/#423/#425"). The reporter
 * mirrors those console lines; everything else on console.error stays local.
 */
export function isHydrationMessage(msg: string): boolean {
  return /hydrat|Minified React error #(418|419|420|421|422|423|424|425)\b/i.test(msg);
}

/** One line for the server log — the only thing the route emits. */
export function formatClientErrorLog(userId: string, r: ClientErrorReport): string {
  return `[client-error] ${JSON.stringify({ userId, ...r })}`;
}
