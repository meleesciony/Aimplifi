/**
 * The register's scroll-restore decision (owner report 2026-08-03: an inline
 * edit in Activity threw the reader back to the top).
 *
 * Every case here is a REFUSAL except the first: restoring the wrong offset is
 * a jump the reader never asked for, while refusing is just the behaviour that
 * shipped before the feature. The e2e (tests/e2e/register-scroll.spec.ts) locks
 * the one case that must succeed, end to end.
 */
import { describe, expect, it } from 'vitest';
import {
  SAVED_SCROLL_TTL_MS,
  decodeSavedScroll,
  encodeSavedScroll,
} from '@/components/finance/register-scroll-store';

const VIEW = '/transactions?merchant=Chipotle';
const NOW = 1_770_000_000_000;

function saved(over: Partial<{ y: number; at: number; view: string }> = {}): string {
  return encodeSavedScroll({ y: 4451, at: NOW - 200, view: VIEW, ...over });
}

describe('decodeSavedScroll', () => {
  it('restores an offset saved moments ago in the same view', () => {
    expect(decodeSavedScroll(saved(), NOW, VIEW)).toBe(4451);
  });

  it('refuses when nothing was saved', () => {
    expect(decodeSavedScroll(null, NOW, VIEW)).toBeNull();
  });

  it('refuses a value it did not write', () => {
    expect(decodeSavedScroll('not json', NOW, VIEW)).toBeNull();
    expect(decodeSavedScroll('null', NOW, VIEW)).toBeNull();
    expect(decodeSavedScroll('4451', NOW, VIEW)).toBeNull();
    expect(decodeSavedScroll('{}', NOW, VIEW)).toBeNull();
  });

  it('refuses an offset older than the TTL — the reload it belonged to never landed', () => {
    // The session-expiry path: the reload redirected to /sign-in, and the reader
    // came back minutes later.
    expect(decodeSavedScroll(saved({ at: NOW - SAVED_SCROLL_TTL_MS - 1 }), NOW, VIEW)).toBeNull();
    // The boundary itself is still honoured — a slow reload is not a stale one.
    expect(decodeSavedScroll(saved({ at: NOW - SAVED_SCROLL_TTL_MS }), NOW, VIEW)).toBe(4451);
  });

  it('refuses an offset from the future — a clock change makes the age meaningless', () => {
    expect(decodeSavedScroll(saved({ at: NOW + 5_000 }), NOW, VIEW)).toBeNull();
  });

  it('refuses an offset measured in a different view', () => {
    // A filtered register and an unfiltered one are different lists of different
    // heights; the same pixel offset means a different place in each.
    expect(decodeSavedScroll(saved(), NOW, '/transactions')).toBeNull();
    expect(decodeSavedScroll(saved(), NOW, '/transactions?merchant=Whole+Foods')).toBeNull();
    expect(decodeSavedScroll(saved(), NOW, '/transactions?page=2')).toBeNull();
  });

  it('refuses a top-of-page or nonsense offset', () => {
    expect(decodeSavedScroll(saved({ y: 0 }), NOW, VIEW)).toBeNull();
    expect(decodeSavedScroll(saved({ y: -10 }), NOW, VIEW)).toBeNull();
    expect(decodeSavedScroll('{"y":"4451","at":1,"view":"/transactions"}', NOW, VIEW)).toBeNull();
    expect(decodeSavedScroll(`{"y":null,"at":${NOW},"view":"${VIEW}"}`, NOW, VIEW)).toBeNull();
  });
});
