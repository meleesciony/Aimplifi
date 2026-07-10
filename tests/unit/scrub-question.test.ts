/**
 * Ask question PII scrub (TASKS 2.2 / DECISIONS #208) — known-answer tests.
 */
import { describe, expect, it } from 'vitest';
import { scrubQuestionText } from '@/lib/engine/assistant/scrub';

describe('scrubQuestionText', () => {
  it('returns empty for blank input', () => {
    expect(scrubQuestionText('')).toBe('');
    expect(scrubQuestionText('   ')).toBe('');
  });

  it('redacts emails', () => {
    expect(scrubQuestionText('email me at jane.doe@example.com please')).toBe(
      'email me at [email] please',
    );
  });

  it('redacts currency amounts before bare digits', () => {
    expect(scrubQuestionText('did I spend $1,234.56 on groceries')).toBe(
      'did I spend [amount] on groceries',
    );
    expect(scrubQuestionText('was that 12.99 at Target')).toBe('was that [amount] at Target');
  });

  it('redacts remaining digit runs (years, phones, bare ints)', () => {
    expect(scrubQuestionText('what about June 2026')).toBe('what about June [num]');
    expect(scrubQuestionText('call 555-123-4567')).toBe('call [num]-[num]-[num]');
  });

  it('preserves routable vocabulary words for mining', () => {
    expect(scrubQuestionText('how much on groceries last month')).toBe(
      'how much on groceries last month',
    );
  });

  it('collapses whitespace and caps length', () => {
    expect(scrubQuestionText('  spend   on   coffee  ')).toBe('spend on coffee');
    const long = 'x'.repeat(600);
    expect(scrubQuestionText(long).length).toBe(500);
  });
});
