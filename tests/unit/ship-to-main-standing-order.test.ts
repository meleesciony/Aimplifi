/**
 * test_regression__completed_slices_land_on_main_the_same_turn
 *
 * Owner standing order (DECISIONS #636): they check www.aimplifi.app, not a
 * cloud branch or a pull request. A completed slice that is only on a PR is
 * unshipped. The instruction files must keep saying that so a later session
 * cannot quietly revert to "leave it on a draft PR."
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('ship-to-main standing order (DECISIONS #636)', () => {
  it('test_regression__completed_slices_land_on_main_the_same_turn', () => {
    const claude = readFileSync('CLAUDE.md', 'utf8');
    const agents = readFileSync('AGENTS.md', 'utf8');
    const rule = readFileSync('.cursor/rules/always-commit-push.mdc', 'utf8');

    for (const [name, text] of [
      ['CLAUDE.md', claude],
      ['AGENTS.md', agents],
      ['.cursor/rules/always-commit-push.mdc', rule],
    ] as const) {
      expect(text, `${name} must call an unmerged PR unshipped`).toMatch(
        /An unmerged PR is unshipped/,
      );
      expect(text, `${name} must name the live site`).toMatch(/www\.aimplifi\.app/);
    }
  });
});
