/**
 * Ask Aimplifi — rich_life intent (P1.3 stored Rich Life vision line).
 *
 * The answer echoes the reader's stored line VERBATIM (the /coach echo's one
 * author is COACH_COPY.richLifeHeader — never a second author) and, when none
 * is written, states the empty state and points at Settings. No new money math.
 * Abstentions are the majority (docs/lessons/context-carrying-features-must-abstain.md):
 * the possessive "my" is required, and amount/date/store flows stay theirs.
 * Copy does not say "this card" or "below".
 */
import { describe, expect, it } from 'vitest';

import { isoDate } from '@/lib/dates';
import {
  parseAssistantQuery,
  richLifeFromQuestion,
  validateIntent,
} from '@/lib/engine/assistant/intent';
import { intentFromKind } from '@/lib/engine/assistant/llm';
import { answerRichLife } from '@/lib/engine/assistant/answer';

const today = isoDate('2026-06-10');
const kindOf = (q: string) => parseAssistantQuery(q, today).kind;

describe('routing — rich_life', () => {
  it('test_regression__rich_life_my_rich_life_routes', () => {
    expect(kindOf('What is my rich life?')).toBe('rich_life');
    expect(kindOf('my rich life')).toBe('rich_life');
    expect(kindOf("what's my rich life")).toBe('rich_life');
    expect(kindOf('what is my rich-life')).toBe('rich_life');
    expect(kindOf('tell me my rich life')).toBe('rich_life');
  });

  it('does not steal retirement, staying-wealthy, cuts, or any money question', () => {
    expect(kindOf('When can I retire?')).toBe('fi_status');
    expect(kindOf('Am I staying wealthy?')).toBe('stay_wealthy');
    expect(kindOf('What should I cut?')).toBe('what_to_cut');
    expect(kindOf('What is my net worth?')).toBe('net_worth');
    expect(kindOf('How many months of runway do I have?')).toBe('runway');
  });
});

describe('abstentions — the majority', () => {
  it('an amount declines so the amount planner (wealth_target) can match', () => {
    // A stated amount WITHOUT a date is the W.1 compounding planner's question.
    expect(kindOf('save $1,000 for my rich life')).toBe('wealth_target');
    expect(richLifeFromQuestion('my rich life $500', today)).toBeNull();
  });

  it('test_regression__rich_life_date_window_abstains', () => {
    expect(kindOf('my rich life last month')).toBe('unknown');
    expect(kindOf('my rich life in 2025')).toBe('unknown');
    expect(richLifeFromQuestion('my rich life last month', today)).toEqual({
      kind: 'unknown',
      question: 'my rich life last month',
    });
  });

  it('a named store or preposition object is not the stored line', () => {
    expect(kindOf('my rich life at Costco')).toBe('unknown');
    expect(kindOf('my rich life with groceries')).toBe('unknown');
  });

  it('bare "rich life" without "my" does not match (advice-shaped), and unrelated words never do', () => {
    expect(kindOf('how do I live a rich life')).not.toBe('rich_life');
    expect(kindOf('I got a haircut')).not.toBe('rich_life');
    expect(kindOf('If I want to save up to $10 million, what do I need to do?')).not.toBe(
      'rich_life',
    );
  });

  it('validateIntent accepts only the closed kind', () => {
    expect(validateIntent({ kind: 'rich_life' })).toEqual({ kind: 'rich_life' });
    expect(validateIntent({ kind: 'rich_life', extra: true })).toEqual({ kind: 'rich_life' });
  });
});

describe('intentFromKind — the model picks a route, never the words', () => {
  it('re-derives from the words; a question tagged rich_life that is not one abstains', () => {
    expect(intentFromKind('rich_life', 'What is my rich life?', today)).toEqual({ kind: 'rich_life' });
    expect(intentFromKind('rich_life', 'how much did I spend last month', today)).toBeNull();
    expect(intentFromKind('rich_life', 'whatever', today)).toBeNull();
    expect(intentFromKind('rich_life', 'When can I retire?', today)).toBeNull();
  });
});

describe('answerRichLife — echoes the stored line, originates nothing', () => {
  const vision = 'Three months of travel every year with the family';

  it('test_regression__rich_life_answer_echoes_the_stored_line_verbatim', () => {
    const a = answerRichLife(vision);
    expect(a.kind).toBe('rich_life');
    expect(a.headline).toBe(`Your Rich Life: "${vision}".`);
    expect(a.headline).toContain(vision);
    expect(a.source).toEqual({ label: 'See on Coach', href: '/coach' });
    expect(a.facts).toEqual([]);
  });

  it('the not-written branch names the empty state and points at Settings', () => {
    const a = answerRichLife(null);
    expect(a.kind).toBe('rich_life');
    expect(a.headline).toContain("don't have");
    expect(a.detail).toContain('Settings');
    expect(a.source).toEqual({ label: 'Set it in Settings', href: '/settings' });
  });

  it('test_regression__rich_life_copy_does_not_claim_this_card_or_below', () => {
    for (const v of [vision, null]) {
      const a = answerRichLife(v);
      const text = `${a.headline} ${a.detail} ${a.facts.map((f) => `${f.label} ${f.value}`).join(' ')}`;
      expect(text).not.toMatch(/\bthis card\b/i);
      expect(text).not.toMatch(/\bbelow\b/i);
    }
  });
});
