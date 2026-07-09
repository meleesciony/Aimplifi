/**
 * safeSyncErrorReason (src/lib/providers/sync-status.ts) — the leak-proof reducer that
 * turns a caught provider error into a persisted signal. The security-critical property:
 * it NEVER returns the raw message (which can carry a credentialed access URL, #5), only
 * an allow-listed SyncFailureReason.
 */
import { describe, it, expect } from 'vitest';
import { safeSyncErrorReason, isSyncFailureReason, type SyncFailureReason } from '@/lib/providers/sync-status';

const ALLOWED: readonly SyncFailureReason[] = ['auth', 'timeout', 'network', 'server', 'unknown'];

describe('safeSyncErrorReason — always an allow-listed reason', () => {
  it('classifies HTTP-status-bearing errors', () => {
    expect(safeSyncErrorReason({ status: 401 })).toBe('auth');
    expect(safeSyncErrorReason({ status: 403 })).toBe('auth');
    expect(safeSyncErrorReason({ statusCode: 500 })).toBe('server');
    expect(safeSyncErrorReason({ status: 503 })).toBe('server');
    expect(safeSyncErrorReason({ status: 429 })).toBe('network');
    expect(safeSyncErrorReason({ status: 504 })).toBe('timeout');
  });

  it('classifies error classes without inspecting the message', () => {
    const abort = new Error('boom');
    abort.name = 'AbortError';
    expect(safeSyncErrorReason(abort)).toBe('timeout');
    const te = new TypeError('fetch failed');
    expect(safeSyncErrorReason(te)).toBe('network');
  });

  it('unrecognized errors collapse to "unknown"', () => {
    expect(safeSyncErrorReason(new Error('something odd'))).toBe('unknown');
    expect(safeSyncErrorReason('a bare string')).toBe('unknown');
    expect(safeSyncErrorReason(null)).toBe('unknown');
    expect(safeSyncErrorReason(undefined)).toBe('unknown');
  });

  it('CRITICAL: never returns the raw message, even when it embeds a credential URL', () => {
    const leaky = new Error('sync failed for https://user:s3cr3t@bridge.simplefin.org/accounts?token=abc');
    const reason = safeSyncErrorReason(leaky);
    expect(reason).not.toContain('simplefin');
    expect(reason).not.toContain('s3cr3t');
    expect(reason).not.toContain('http');
    expect(ALLOWED).toContain(reason);
  });

  it('the returned value is ALWAYS a member of the allow-list (fuzz over shapes)', () => {
    const shapes: unknown[] = [
      {}, [], 0, 1, true, false, Symbol('x'), () => {}, new Map(),
      { status: 'not-a-number' }, { status: 418 }, { statusCode: 401 },
      new Error(''), { message: 'x'.repeat(10_000) },
    ];
    for (const s of shapes) expect(ALLOWED).toContain(safeSyncErrorReason(s));
  });

  it('isSyncFailureReason guards persisted values', () => {
    expect(isSyncFailureReason('auth')).toBe(true);
    expect(isSyncFailureReason('nope')).toBe(false);
    expect(isSyncFailureReason(null)).toBe(false);
  });
});
