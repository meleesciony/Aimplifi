/**
 * The public privacy policy (src/lib/legal/privacy-policy.ts) is the single source
 * rendered at /privacy and submitted-against for Plaid production access. These
 * tests pin its REQUIRED disclosures to the guarantees the code actually enforces,
 * so the policy can never silently drift from the implementation:
 *   - mask = last 4 only            → prisma/schema.prisma (Account.mask)
 *   - AES-256-GCM tokens at rest     → src/lib/crypto.ts
 *   - delete → revoke → cascade      → src/server/account-actions.ts + plaid.removeItem
 *   - userId-scoped access           → src/server/authz.ts
 *   - AI sends only descriptor+amount, key-gated → src/server/llm-categorize.ts
 */
import { describe, expect, it } from 'vitest';
import {
  PRIVACY_CONTACT_EMAIL,
  PRIVACY_LAST_UPDATED,
  PRIVACY_POLICY,
} from '@/lib/legal/privacy-policy';

function flatten(): string {
  const parts: string[] = [PRIVACY_POLICY.title, PRIVACY_POLICY.intro];
  for (const s of PRIVACY_POLICY.sections) {
    parts.push(s.heading);
    for (const b of s.body) parts.push(typeof b === 'string' ? b : b.list.join('\n'));
  }
  return parts.join('\n');
}

describe('privacy policy — structure', () => {
  it('has a title, intro, and several sections', () => {
    expect(PRIVACY_POLICY.title).toMatch(/privacy/i);
    expect(PRIVACY_POLICY.intro.length).toBeGreaterThan(80);
    expect(PRIVACY_POLICY.sections.length).toBeGreaterThanOrEqual(6);
  });

  it('every section has a unique kebab id, a heading, and non-empty body', () => {
    const ids = new Set<string>();
    for (const s of PRIVACY_POLICY.sections) {
      expect(s.id).toMatch(/^[a-z][a-z-]*[a-z]$/);
      expect(ids.has(s.id)).toBe(false);
      ids.add(s.id);
      expect(s.heading.length).toBeGreaterThan(0);
      expect(s.body.length).toBeGreaterThan(0);
      for (const b of s.body) {
        if (typeof b === 'string') expect(b.length).toBeGreaterThan(0);
        else expect(b.list.length).toBeGreaterThan(0);
      }
    }
  });

  it('last-updated is a valid YYYY-MM-DD and contact is an email', () => {
    expect(PRIVACY_LAST_UPDATED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(PRIVACY_CONTACT_EMAIL).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);
  });
});

describe('privacy policy — discloses exactly what the code enforces', () => {
  const text = flatten().toLowerCase();
  // Each required phrase corresponds to a guarantee proven elsewhere in the suite.
  const required: Array<[string, string]> = [
    ['mask is last-4 only', 'last 4 digits'],
    ['full numbers never stored', 'never requested, stored, or displayed'],
    ['token encryption', 'aes-256-gcm'],
    ['tokens not exposed to client', 'never sent to your browser'],
    ['no SSNs', 'social security'],
    ['public tokens mentioned', 'public tokens'],
    ['public tokens are discarded (not retained)', 'immediately and discarded'],
    ['userId-scoped access', 'your own user id'],
    ['encryption in transit', 'https/tls'],
    ['export path', 'export your transactions'],
    ['typed-confirmation deletion', 'typed confirmation'],
    ['revoke at plaid on delete', 'revoked at plaid'],
    ['cascade incl. audit log', 'audit log itself'],
    ['AI sends only descriptor+amount', 'descriptor and amount'],
    ['AI is key-gated / off without a key', 'with no ai key'],
    ['no data sale / no ad trackers', 'do not sell your data'],
    ['contact provided', PRIVACY_CONTACT_EMAIL.toLowerCase()],
  ];

  for (const [label, phrase] of required) {
    it(`discloses: ${label}`, () => {
      expect(text).toContain(phrase);
    });
  }
});
