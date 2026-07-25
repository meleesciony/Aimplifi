/**
 * TASKS L.15 — `renderSafe` was EXTRACTED from `components/finance/continued-accounts-view.ts` into
 * `lib/engine/account/render-safe.ts` (the duplicate-disclosure copy module moved into the engine
 * tree, and `src/lib/**` must not import from `src/components/**`).
 *
 * The extraction rewrote the INVISIBLE character class through a script, and this repo has a lesson
 * about exactly that — `docs/lessons/windows-codegen-via-shell.md`: shell/python heredocs mangle
 * backslash escapes in generated TypeScript. A mangled class here would be silent and severe:
 * `renderSafe` is what makes the string a check COMPARES equal the string the browser PAINTS, which
 * is the whole basis of the duplicate disclosure's "it can never name a card differently from the
 * row itself" argument, and of #297's ordinal collision breaker.
 *
 * Every character below is built with String.fromCharCode so this file itself contains no invisible
 * or control characters to be mangled in turn.
 */
import { describe, expect, it } from 'vitest';
import { UNNAMED_ACCOUNT, renderSafe } from '@/lib/engine/account/render-safe';
import { renderSafe as reExported } from '@/components/finance/continued-accounts-view';

const ch = (code: number) => String.fromCharCode(code);

describe('renderSafe survives the extraction intact', () => {
  it('strips every class the original stripped', () => {
    // One representative from each range in the character class, so a mangled range fails loudly.
    const cases: [number, string][] = [
      [0x0000, 'NUL (C0 start)'],
      [0x001f, 'C0 end'],
      [0x007f, 'DEL (C1 start)'],
      [0x009f, 'C1 end'],
      [0x00ad, 'soft hyphen'],
      [0x061c, 'Arabic letter mark'],
      [0x180e, 'Mongolian vowel separator'],
      [0x200b, 'zero-width space'],
      [0x200f, 'right-to-left mark'],
      [0x202a, 'LTR embedding'],
      [0x202e, 'RTL override'],
      [0x2060, 'word joiner'],
      [0x2064, 'invisible plus'],
      [0x2066, 'LTR isolate'],
      [0x2069, 'pop directional isolate'],
      [0xfeff, 'BOM'],
    ];
    for (const [code, why] of cases) {
      expect(renderSafe(`CARD${ch(code)}0977`), why).toBe('CARD0977');
    }
  });

  it('keeps characters just OUTSIDE each range — the class did not widen', () => {
    // A mangled escape most often widens a range. These must survive untouched.
    for (const code of [0x0020, 0x00ae, 0x061d, 0x180f, 0x200a, 0x2010, 0x2065, 0x206a, 0xfefe]) {
      expect(renderSafe(`A${ch(code)}B`).length, `U+${code.toString(16)}`).toBeGreaterThan(2);
    }
  });

  it('collapses whitespace, trims, and NFC-normalizes', () => {
    expect(renderSafe('  Chase   Sapphire  ')).toBe('Chase Sapphire');
    // Cafe + combining acute must normalize to the precomposed form, so a name typed either way
    // compares and paints identically.
    expect(renderSafe(`Cafe${ch(0x0301)}`)).toBe('Café');
  });

  it('returns the sentinel when a name sanitizes away to nothing — never an empty face', () => {
    expect(renderSafe(ch(0x200b) + ch(0x202e) + '   ')).toBe(UNNAMED_ACCOUNT);
    expect(UNNAMED_ACCOUNT).toBe('Unnamed account');
  });

  it('keeps the iOS default apostrophe (a false-strip would rename a real merchant)', () => {
    expect(renderSafe('mcdonald' + ch(0x2019) + 's')).toBe('mcdonald’s');
  });

  it('is the SAME function the old home still exports — one sanitizer, not two', () => {
    expect(reExported).toBe(renderSafe);
  });
});
