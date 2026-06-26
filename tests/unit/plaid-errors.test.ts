/**
 * plaidErrorSummary formats Plaid's error envelope for a thrown Error so the
 * first real sandbox/production run is diagnosable. It must surface the
 * developer-facing error_code/error_type/error_message/request_id (none of which
 * are secret) and never throw on a malformed/empty body — a formatting failure
 * must not mask the underlying Plaid failure.
 */
import { describe, expect, it } from 'vitest';
import { plaidErrorSummary } from '@/lib/providers/plaid';

describe('plaidErrorSummary', () => {
  it('formats a full Plaid error envelope with request_id', () => {
    const out = plaidErrorSummary({
      error_type: 'ITEM_ERROR',
      error_code: 'ITEM_LOGIN_REQUIRED',
      error_message: 'the login details of this item have changed',
      request_id: 'abc123',
    });
    expect(out).toContain('ITEM_LOGIN_REQUIRED');
    expect(out).toContain('ITEM_ERROR');
    expect(out).toContain('the login details of this item have changed');
    expect(out).toContain('abc123');
  });

  it('omits request_id cleanly when absent', () => {
    const out = plaidErrorSummary({ error_code: 'INVALID_FIELD', error_type: 'INVALID_REQUEST' });
    expect(out).toContain('INVALID_FIELD');
    expect(out).not.toContain('request_id');
  });

  it('never throws on a non-object / empty / fieldless body', () => {
    expect(plaidErrorSummary(null)).toBe('(no error body)');
    expect(plaidErrorSummary(undefined)).toBe('(no error body)');
    expect(plaidErrorSummary('boom')).toBe('(no error body)');
    expect(plaidErrorSummary({})).toBe('(no error fields)');
    expect(plaidErrorSummary({ request_id: 'only-id' })).toBe('(no error fields)');
  });
});
