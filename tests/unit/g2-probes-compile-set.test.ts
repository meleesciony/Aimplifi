/**
 * G.2 — .mts audit probes compile under the Definition-of-Done gate.
 *
 * The root tsconfig include is every .ts file and never matches .mts. Two
 * money-visible probe bugs (O.20g keep-object no-op; O.20a first-draft same
 * shape) shipped because tsc --noEmit could not see them. This lock is the
 * fence: the dedicated project includes every probe, and verify.sh runs it.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PROBES_DIR = 'scripts/audit-probes';
const TSCONFIG = 'tsconfig.probes.json';
const VERIFY = 'scripts/verify.sh';

function listMts(dir: string): string[] {
  return readdirSync(dir)
    .filter((n) => n.endsWith('.mts'))
    .map((n) => join(dir, n).replaceAll('\\', '/'))
    .sort();
}

describe('G.2 — probe compile set', () => {
  it('test_regression__g2_probes_tsconfig_includes_every_mts', () => {
    const cfg = JSON.parse(readFileSync(TSCONFIG, 'utf8')) as { include: string[] };
    expect(cfg.include).toContain('scripts/audit-probes/**/*.mts');
    const mts = listMts(PROBES_DIR);
    expect(mts.length).toBeGreaterThan(0);
    // The glob is the include; this asserts the directory the glob names
    // still holds the files (a move that leaves the glob pointing at
    // nothing would keep tsc green and the gate blind again).
    expect(mts.every((p) => p.startsWith(`${PROBES_DIR}/`))).toBe(true);
  });

  it('test_regression__g2_verify_runs_the_probes_project', () => {
    const sh = readFileSync(VERIFY, 'utf8');
    expect(sh).toMatch(/tsc --noEmit --project tsconfig\.probes\.json/);
  });

  it('test_regression__g2_probes_do_not_pass_keep_an_object_or_filter_countsInFlows', () => {
    // The two silent-no-op shapes this gate exists to catch: a positional
    // keep-closure called with `{accountId, date}`, and `array.filter(countsInFlows)`
    // which binds the index as `excludedFlowIds`.
    const offenders: string[] = [];
    for (const file of listMts(PROBES_DIR)) {
      const text = readFileSync(file, 'utf8');
      if (/keep\(\s*\{/.test(text)) offenders.push(`${file}: keep({…})`);
      if (/\.filter\(\s*countsInFlows\s*\)/.test(text)) {
        offenders.push(`${file}: .filter(countsInFlows)`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
