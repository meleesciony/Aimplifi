/**
 * Self-audit metrics on Trust without leaving for Settings (DECISIONS #703).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Trust mounts SelfAuditMetrics', () => {
  it('test_regression__household_can_see_self_audit_on_trust_without_leaving_for_settings', () => {
    const page = readFileSync(resolve('src/app/(app)/trust/page.tsx'), 'utf8');
    expect(page).toContain('SelfAuditMetrics');
    expect(page).toContain('getLatestSelfAuditSnapshot');
  });
});
