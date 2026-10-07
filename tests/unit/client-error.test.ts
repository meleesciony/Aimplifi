/**
 * Client error reporting (DECISIONS #794): the pure helpers and the route.
 * Locks the caps (a forged body cannot write megabytes to the log), the
 * email scrub, the hydration-message filter, and the route's three answers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_MESSAGE_LEN,
  MAX_STACK_LEN,
  formatClientErrorLog,
  isHydrationMessage,
  parseClientErrorReport,
} from '@/lib/client-error';

vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('@/server/authz', () => ({ rateLimitDurable: vi.fn(async () => true) }));
import { auth } from '@/auth';
import { rateLimitDurable } from '@/server/authz';
import { POST } from '@/app/api/client-error/route';
import { NextRequest } from 'next/server';

const req = (body: unknown) =>
  new NextRequest('http://localhost/api/client-error', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('parseClientErrorReport', () => {
  it('accepts a report, clips every field, drops the query string, scrubs emails', () => {
    const r = parseClientErrorReport({
      kind: 'error',
      message: `x`.repeat(MAX_MESSAGE_LEN + 50) + ' me@example.com',
      stack: 's'.repeat(MAX_STACK_LEN + 1),
      route: '/transactions?account=abc123',
      userAgent: 'Safari me@example.com',
    });
    expect(r).not.toBeNull();
    expect(r!.message).toHaveLength(MAX_MESSAGE_LEN);
    expect(r!.stack).toHaveLength(MAX_STACK_LEN);
    expect(r!.route).toBe('/transactions');
    expect(r!.userAgent).toBe('Safari [redacted-email]');
  });

  it('rejects anything that is not a report', () => {
    expect(parseClientErrorReport(null)).toBeNull();
    expect(parseClientErrorReport('x')).toBeNull();
    expect(parseClientErrorReport({ kind: 'nope', message: 'x' })).toBeNull();
    expect(parseClientErrorReport({ kind: 'error', message: '' })).toBeNull();
    expect(parseClientErrorReport({ kind: 'error' })).toBeNull();
  });

  it('a report with no stack has no stack key, and an empty route becomes /', () => {
    const r = parseClientErrorReport({ kind: 'unhandledrejection', message: 'm', route: '', userAgent: '' });
    expect(r).toEqual({ kind: 'unhandledrejection', message: 'm', route: '/', userAgent: '' });
  });
});

describe('isHydrationMessage', () => {
  it('matches React hydration failures, dev and minified, and nothing else', () => {
    expect(isHydrationMessage('Hydration failed because the server rendered HTML did not match')).toBe(true);
    expect(isHydrationMessage('There was an error while hydrating this Suspense boundary')).toBe(true);
    expect(isHydrationMessage('Minified React error #418; visit https://react.dev/errors/418')).toBe(true);
    expect(isHydrationMessage('Minified React error #423')).toBe(true);
    expect(isHydrationMessage('Minified React error #31')).toBe(false);
    expect(isHydrationMessage('Warning: Each child in a list should have a unique key')).toBe(false);
    expect(isHydrationMessage('')).toBe(false);
  });
});

describe('POST /api/client-error', () => {
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  beforeEach(() => {
    errorSpy.mockClear();
    vi.mocked(rateLimitDurable).mockResolvedValue(true);
  });
  afterEach(() => vi.mocked(auth).mockReset());

  it('401 without a session, and logs nothing', async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    const res = await POST(req({ kind: 'error', message: 'x' }));
    expect(res.status).toBe(401);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('204 and one structured log line for a valid report', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: 'u1' } } as never);
    const res = await POST(req({ kind: 'hydration', message: 'Minified React error #418', route: '/dashboard?x=1', userAgent: 'ua' }));
    expect(res.status).toBe(204);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const line = String(errorSpy.mock.calls[0][0]);
    expect(line.startsWith('[client-error] ')).toBe(true);
    expect(JSON.parse(line.slice('[client-error] '.length))).toEqual({
      userId: 'u1',
      kind: 'hydration',
      message: 'Minified React error #418',
      route: '/dashboard',
      userAgent: 'ua',
    });
    expect(line).toBe(formatClientErrorLog('u1', { kind: 'hydration', message: 'Minified React error #418', route: '/dashboard', userAgent: 'ua' }));
  });

  it('400 for a non-report body or unparseable JSON, 429 when rate-limited — logging nothing', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: 'u1' } } as never);
    expect((await POST(req({ kind: 'nope' }))).status).toBe(400);
    expect((await POST(req('{not json'))).status).toBe(400);
    vi.mocked(rateLimitDurable).mockResolvedValueOnce(false);
    expect((await POST(req({ kind: 'error', message: 'x' }))).status).toBe(429);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
