/**
 * P1.3 Rich Life vision — the pure normalization boundary. The value is the
 * reader's own words echoed verbatim inside a registered sentence, so this
 * module is the one author of what can enter that sentence: control-char drop,
 * trim, empty→null, over-cap REJECT (never silent truncation — the L.30 rule).
 */
import { describe, expect, it } from 'vitest';
import {
  RICH_LIFE_MAX_CHARS,
  normalizeRichLifeVision,
  richLifeErrorMessage,
} from '@/lib/engine/settings/rich-life';

describe('normalizeRichLifeVision', () => {
  it('trims the ends and keeps the interior exactly as typed', () => {
    const r = normalizeRichLifeVision('  Three months of travel every year  ');
    expect(r).toEqual({ ok: true, vision: 'Three months of travel every year' });
  });

  it('keeps interior spacing and capitalization (the reader prose)', () => {
    const r = normalizeRichLifeVision('college   for both kids.   THE TRIPS.');
    expect(r).toEqual({ ok: true, vision: 'college   for both kids.   THE TRIPS.' });
  });

  it('REPLACES control characters with a space — never joins the words they separated', () => {
    const r = normalizeRichLifeVision('line one\twith\rtabs\nand breaks');
    expect(r).toEqual({ ok: true, vision: 'line one with tabs and breaks' });
  });

  it('replaces the clipboard line/paragraph separators (U+0085/U+2028/U+2029), which are not ASCII', () => {
    const r = normalizeRichLifeVision('row one twothree');
    expect(r).toEqual({ ok: true, vision: 'row one two three' });
  });

  it('empty and whitespace-only both become null (cleared = never written)', () => {
    expect(normalizeRichLifeVision('')).toEqual({ ok: true, vision: null });
    expect(normalizeRichLifeVision('   \t  ')).toEqual({ ok: true, vision: null });
    expect(normalizeRichLifeVision(null)).toEqual({ ok: true, vision: null });
    expect(normalizeRichLifeVision(undefined)).toEqual({ ok: true, vision: null });
  });

  it('accepts exactly the cap and rejects one character past it', () => {
    const at = 'x'.repeat(RICH_LIFE_MAX_CHARS);
    const over = 'x'.repeat(RICH_LIFE_MAX_CHARS + 1);
    expect(normalizeRichLifeVision(at)).toEqual({ ok: true, vision: at });
    expect(normalizeRichLifeVision(over)).toEqual({ ok: false, error: 'too-long' });
  });

  it('rejects rather than truncating — the message names the limit', () => {
    expect(normalizeRichLifeVision('y'.repeat(RICH_LIFE_MAX_CHARS + 5))).toEqual({
      ok: false,
      error: 'too-long',
    });
    expect(richLifeErrorMessage('too-long')).toContain(String(RICH_LIFE_MAX_CHARS));
  });
});
