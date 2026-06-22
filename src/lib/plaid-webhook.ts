/**
 * Plaid webhook signature verification (ROADMAP #1c). Plaid signs each webhook
 * with an ES256 JWT in the `Plaid-Verification` header whose `request_body_sha256`
 * claim pins the exact body bytes. This verifies: the JWT is ES256, its signature
 * checks against Plaid's published key (resolved by `kid`), the body hash matches,
 * and the token is fresh (anti-replay). The key resolver is INJECTED so the logic
 * is fully unit-testable without Plaid credentials; production passes a resolver
 * that fetches /webhook_verification_key/get (src/lib/providers/plaid.ts).
 *
 * Returns {ok:false, reason} on any failure — it never throws, so a malformed or
 * forged webhook becomes a clean 401 rather than a 500.
 */
import { createHash } from 'node:crypto';
import { decodeProtectedHeader, importJWK, jwtVerify, type JWK } from 'jose';

export interface VerifyResult {
  ok: boolean;
  reason?: string;
}

/** SHA-256 hex of the raw request body (matches Plaid's request_body_sha256 claim). */
export function sha256Hex(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

export async function verifyPlaidWebhook(opts: {
  token: string;
  rawBody: string;
  getKey: (kid: string) => Promise<JWK | null>;
  /** Injectable clock (ms) for testability. */
  now?: number;
  /** Freshness window; default 5 minutes (Plaid's recommendation). */
  maxAgeMs?: number;
}): Promise<VerifyResult> {
  const { token, rawBody, getKey } = opts;
  const now = opts.now ?? Date.now();
  const maxAgeMs = opts.maxAgeMs ?? 5 * 60_000;

  if (!token) return { ok: false, reason: 'missing-token' };

  let header: { alg?: string; kid?: string };
  try {
    header = decodeProtectedHeader(token);
  } catch {
    return { ok: false, reason: 'bad-header' };
  }
  if (header.alg !== 'ES256') return { ok: false, reason: 'bad-alg' };
  if (!header.kid) return { ok: false, reason: 'missing-kid' };

  const jwk = await getKey(header.kid).catch(() => null);
  if (!jwk) return { ok: false, reason: 'no-key' };

  let payload: { request_body_sha256?: unknown; iat?: unknown };
  try {
    const key = await importJWK(jwk, 'ES256');
    ({ payload } = await jwtVerify(token, key, { algorithms: ['ES256'] }));
  } catch {
    return { ok: false, reason: 'bad-signature' };
  }

  // Freshness — reject replays older than the window (Plaid signs `iat` in seconds).
  if (typeof payload.iat !== 'number' || now - payload.iat * 1000 > maxAgeMs) {
    return { ok: false, reason: 'stale' };
  }
  // Body integrity — the JWT pins the SHA-256 of the exact bytes we received.
  if (payload.request_body_sha256 !== sha256Hex(rawBody)) {
    return { ok: false, reason: 'body-mismatch' };
  }
  return { ok: true };
}
