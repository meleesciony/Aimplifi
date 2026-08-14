/**
 * U.2 — hue-named status classes are gone; semantic scales live in globals.css.
 *
 * brand / positive alias Tailwind emerald; warning aliases amber. Call sites
 * must use those names so a later palette change cannot leave a stray
 * emerald-* / amber-* class painting the old hue. The token file itself is
 * the allowed exception — that is where the alias is defined.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const HUE_CLASS = /(?:emerald|amber)-\d+/;
const TOKEN_FILE = 'src/app/globals.css';

function* walkSrc(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walkSrc(p);
    else if (/\.(ts|tsx|css)$/.test(name)) yield p;
  }
}

describe('U.2 — semantic status-color tokens', () => {
  it('test_regression__no-emerald-or-amber-class-literals-outside-token-defs', () => {
    const offenders: string[] = [];
    for (const file of walkSrc('src')) {
      const rel = file.replaceAll('\\', '/');
      if (rel === TOKEN_FILE) continue;
      const text = readFileSync(file, 'utf8');
      if (HUE_CLASS.test(text)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it('token file aliases brand and positive to emerald, warning to amber', () => {
    const css = readFileSync(TOKEN_FILE, 'utf8');
    expect(css).toContain('--color-brand-500: var(--color-emerald-500);');
    expect(css).toContain('--color-positive-500: var(--color-emerald-500);');
    expect(css).toContain('--color-warning-500: var(--color-amber-500);');
    expect(css).toContain('--color-brand-950: var(--color-emerald-950);');
    expect(css).toContain('--color-positive-950: var(--color-emerald-950);');
    expect(css).toContain('--color-warning-950: var(--color-amber-950);');
  });
});
