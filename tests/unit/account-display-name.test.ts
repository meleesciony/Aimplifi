/**
 * account-display-name.test.ts — TASKS L.7. Known-answer tests for the nickname layer:
 * which string a reader sees, which string a comparison compares, and what the write
 * boundary accepts. The direction of the default (feed name wins unless a nickname is
 * explicitly set) is asserted, not assumed — a regression there would silently feed
 * user-typed strings into duplicate detection.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_NICKNAME_LENGTH,
  NICKNAME_TOO_LONG,
  accountLabel,
  parseAccountNickname,
} from '@/lib/engine/account/display-name';
import { UNNAMED_ACCOUNT } from '@/lib/engine/account/render-safe';

describe('accountLabel', () => {
  it('shows the feed name when no nickname is set', () => {
    expect(accountLabel({ name: 'CREDIT CARD' })).toBe('CREDIT CARD');
    expect(accountLabel({ name: 'CREDIT CARD', displayName: null })).toBe('CREDIT CARD');
  });

  it('shows the nickname when one is set', () => {
    expect(accountLabel({ name: 'CREDIT CARD', displayName: 'Chase Freedom' })).toBe('Chase Freedom');
  });

  it('falls back to the feed name when the stored nickname is blank or invisible-only', () => {
    expect(accountLabel({ name: 'CREDIT CARD', displayName: '   ' })).toBe('CREDIT CARD');
    expect(accountLabel({ name: 'CREDIT CARD', displayName: '​​' })).toBe('CREDIT CARD');
  });

  it('never paints an empty face: a feed name that sanitizes away becomes the placeholder', () => {
    expect(accountLabel({ name: '​' })).toBe(UNNAMED_ACCOUNT);
  });

  it('sanitizes both routes, so the painted string equals the compared string', () => {
    expect(accountLabel({ name: 'Ven‮ture' })).toBe('Venture');
    expect(accountLabel({ name: 'x', displayName: 'Joint  checking​' })).toBe('Joint checking');
  });
});



describe('parseAccountNickname', () => {
  it('accepts a normal name, trimmed and whitespace-collapsed', () => {
    expect(parseAccountNickname('  Chase   Freedom ')).toEqual({ ok: true, value: 'Chase Freedom' });
  });

  it('treats an empty box as "go back to my bank\'s name"', () => {
    expect(parseAccountNickname('')).toEqual({ ok: true, value: null });
    expect(parseAccountNickname('   ')).toEqual({ ok: true, value: null });
  });

  it('treats an invisible-only entry as clearing, never as a storable name', () => {
    expect(parseAccountNickname('​‮')).toEqual({ ok: true, value: null });
  });

  it('strips control and bidi characters instead of storing them', () => {
    expect(parseAccountNickname('Ch‮ast​e')).toEqual({ ok: true, value: 'Chaste' });
  });

  it('accepts exactly the maximum length and refuses one more', () => {
    const atMax = 'a'.repeat(MAX_NICKNAME_LENGTH);
    expect(parseAccountNickname(atMax)).toEqual({ ok: true, value: atMax });
    expect(parseAccountNickname(`${atMax}a`)).toEqual({ ok: false, error: NICKNAME_TOO_LONG });
  });

  it('counts code points, so an emoji costs one character and not two', () => {
    const emoji = '🏦'.repeat(MAX_NICKNAME_LENGTH);
    expect(parseAccountNickname(emoji)).toEqual({ ok: true, value: emoji });
    expect(parseAccountNickname(`${emoji}🏦`)).toEqual({ ok: false, error: NICKNAME_TOO_LONG });
  });
});

