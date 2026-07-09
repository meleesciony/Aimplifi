/**
 * Production error tracking behind a graceful, tested fallback — the same
 * dormant-by-default stance as email (#47) and Web Push (#173). With NO
 * `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN`, captureError is a no-op that reports
 * `{captured:false, reason:'no-provider'}` WITHOUT making a network call, so
 * verify / e2e / demo stay golden-safe. With a DSN it POSTs a minimal Sentry
 * envelope (errors only — no perf traces, no default PII). It NEVER throws —
 * a reporting failure must not abort a user recovery or a cron sweep.
 *
 * Switch it on later by setting SENTRY_DSN (server) and/or NEXT_PUBLIC_SENTRY_DSN
 * (client error boundaries). See docs/DEPLOY.md + DECISIONS #189.
 */

export interface CaptureContext {
  /** Which boundary / surface raised the error (e.g. 'global', 'app', 'request'). */
  boundary?: string;
  /** Opaque tags only — never attach emails, merchant names, or money amounts. */
  tags?: Record<string, string>;
  /** Extra metadata; scrubbed before send (emails / secret-looking keys stripped). */
  extra?: Record<string, unknown>;
}

export interface CaptureResult {
  captured: boolean;
  reason?: string;
}

/** Parsed DSN bits — pure, unit-tested. */
export interface ParsedSentryDsn {
  publicKey: string;
  host: string;
  pathPrefix: string;
  projectId: string;
  envelopeUrl: string;
}

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const SECRET_KEY_RE = /^(authorization|cookie|password|secret|token|api[_-]?key|dsn|auth|credential)/i;

/** True when a Sentry DSN is configured for this runtime. */
export function errorTrackingConfigured(): boolean {
  return !!(process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN);
}

/** Resolve the DSN for this runtime (server prefers SENTRY_DSN). */
export function resolveSentryDsn(): string | undefined {
  const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;
  return dsn && dsn.trim() ? dsn.trim() : undefined;
}

/**
 * Parse a Sentry DSN into an envelope endpoint. Returns null on junk so a
 * misconfigured env never throws at the call site.
 *
 * Shape: `{PROTOCOL}://{PUBLIC_KEY}@{HOST}{/PATH}/{PROJECT_ID}`
 * (secret key optional/deprecated).
 */
export function parseSentryDsn(dsn: string): ParsedSentryDsn | null {
  try {
    const u = new URL(dsn);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    const publicKey = u.username;
    if (!publicKey) return null;
    const segments = u.pathname.split('/').filter(Boolean);
    const projectId = segments.pop();
    if (!projectId || !/^\d+$/.test(projectId)) return null;
    const pathPrefix = segments.length ? `/${segments.join('/')}` : '';
    const host = u.host;
    return {
      publicKey,
      host,
      pathPrefix,
      projectId,
      envelopeUrl: `${u.protocol}//${host}${pathPrefix}/api/${projectId}/envelope/`,
    };
  } catch {
    return null;
  }
}

/** Strip emails and secret-looking keys from a context bag (pure). */
export function scrubExtra(extra: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!extra) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(extra)) {
    if (SECRET_KEY_RE.test(k)) continue;
    out[k] = scrubValue(v);
  }
  return out;
}

function scrubValue(v: unknown): unknown {
  if (typeof v === 'string') return v.replace(EMAIL_RE, '[redacted-email]');
  if (Array.isArray(v)) return v.map(scrubValue);
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
      if (SECRET_KEY_RE.test(k)) continue;
      o[k] = scrubValue(child);
    }
    return o;
  }
  return v;
}

function scrubMessage(msg: string): string {
  return msg.replace(EMAIL_RE, '[redacted-email]').slice(0, 500);
}

function eventId(): string {
  // 32 hex chars — Sentry event_id format.
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Capture an error to Sentry when configured. Never throws. No-op without a DSN.
 * Safe to call from client error boundaries and server `onRequestError`.
 */
export async function captureError(
  error: unknown,
  context: CaptureContext = {},
): Promise<CaptureResult> {
  const dsn = resolveSentryDsn();
  if (!dsn) return { captured: false, reason: 'no-provider' };

  const parsed = parseSentryDsn(dsn);
  if (!parsed) return { captured: false, reason: 'invalid-dsn' };

  const err =
    error instanceof Error
      ? error
      : new Error(typeof error === 'string' ? error : 'Unknown error');

  const id = eventId();
  const env =
    process.env.SENTRY_ENVIRONMENT ||
    process.env.VERCEL_ENV ||
    process.env.NODE_ENV ||
    'development';
  const release =
    process.env.SENTRY_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA || undefined;

  const event: Record<string, unknown> = {
    event_id: id,
    timestamp: Date.now() / 1000,
    platform: 'javascript',
    level: 'error',
    environment: env,
    ...(release ? { release } : {}),
    sdk: { name: 'aimplifi.errors', version: '1.0.0' },
    exception: {
      values: [
        {
          type: err.name || 'Error',
          value: scrubMessage(err.message || 'Unknown error'),
          // Stacks can carry file paths; keep them (needed to debug) but never
          // attach request bodies / financial payloads alongside.
          stacktrace: err.stack
            ? {
                frames: err.stack
                  .split('\n')
                  .slice(0, 40)
                  .map((line) => ({ filename: scrubMessage(line.trim()) })),
              }
            : undefined,
        },
      ],
    },
    tags: {
      ...(context.boundary ? { boundary: context.boundary } : {}),
      ...context.tags,
    },
    extra: scrubExtra(context.extra),
  };

  const envelopeHeader = JSON.stringify({
    event_id: id,
    dsn,
    sent_at: new Date().toISOString(),
  });
  const itemHeader = JSON.stringify({ type: 'event', content_type: 'application/json' });
  const body = `${envelopeHeader}\n${itemHeader}\n${JSON.stringify(event)}\n`;

  try {
    const res = await fetch(parsed.envelopeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
        'X-Sentry-Auth': [
          'Sentry sentry_version=7',
          'sentry_client=aimplifi.errors/1.0.0',
          `sentry_key=${parsed.publicKey}`,
        ].join(', '),
      },
      body,
      // Don't let a hung ingest block recovery UI.
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return { captured: false, reason: `provider-${res.status}` };
    return { captured: true };
  } catch (e) {
    return { captured: false, reason: e instanceof Error ? e.message : 'send-failed' };
  }
}
