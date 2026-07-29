/**
 * Byte-level source hygiene (O.12d critic P1; the L.15 / windows-codegen failure
 * class). A raw control byte in a source file is invisible to tsc, eslint, vitest
 * and next build — the O.12d slice shipped verify-green with a raw NUL (0x00) in a
 * plaid.ts template literal — but it makes ripgrep classify the file as BINARY, so
 * recursive grep sweeps (this repo's mandated audit instrument: the new-egress
 * lesson, the CRITIC_RUBRIC standing checks, every "grep every consumer" lesson)
 * silently truncate at the byte and stop seeing everything after it. The corrupted
 * region was, of course, the new write path itself.
 *
 * This scan is the gate that class was missing: every tracked source file must
 * contain no control bytes besides \t \n \r. Scoped to src/ + tests/ + scripts/
 * (the trees agents generate code into).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// docs/ and the root-level ledgers are included deliberately: the same session that
// motivated this gate also planted a raw 0x01 in a docs/lessons file — markdown is
// swept by the same greps as source.
const ROOTS = ['src', 'tests', 'scripts', 'docs', 'prisma'];
const EXTS = /\.(ts|tsx|js|mjs|css|md|json|prisma)$/;

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (EXTS.test(name)) yield p;
  }
}

function* rootFiles(): Generator<string> {
  for (const name of readdirSync('.')) {
    if (EXTS.test(name) && statSync(name).isFile()) yield name;
  }
}

describe('source hygiene — no raw control bytes in any source file', () => {
  it('test_regression__nul-byte-in-source-blinds-grep-sweeps', () => {
    const offenders: string[] = [];
    const files = [...rootFiles()];
    for (const root of ROOTS) files.push(...walk(root));
    {
      for (const file of files) {
        const bytes = readFileSync(file);
        for (let i = 0; i < bytes.length; i++) {
          const b = bytes[i];
          // Allowed: \t (9), \n (10), \r (13). Everything else below 0x20 is a
          // raw control byte that has no business in source.
          if (b < 32 && b !== 9 && b !== 10 && b !== 13) {
            offenders.push(`${file} @ byte ${i} (0x${b.toString(16).padStart(2, '0')})`);
            break; // one report per file is enough
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
