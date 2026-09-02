/**
 * Live 2026-09-01 /triage: 'Only genuinely ambiguous transactions land here —
 * everything else is filed automatically' sat next to Categorization accuracy
 * 5.3% (21 of 398 labeled). The 5.3% is a real scored hit-rate; the promise
 * is not. Inbox copy must describe the queue, not auto-file quality.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  INBOX_EMPTY_DESCRIPTION,
  INBOX_EMPTY_FOOTNOTE,
  INBOX_EMPTY_TITLE,
  INBOX_NAV_DESCRIPTION,
  INBOX_PAGE_SUBTITLE,
} from '@/lib/copy/inbox-copy';
import { NAV_DESTINATIONS } from '@/lib/nav/destinations';

const FORBIDDEN = [/genuinely ambiguous/i, /filed automatically/i, /almost everything automatically/i];

function assertHonest(s: string) {
  for (const re of FORBIDDEN) expect(s, s).not.toMatch(re);
}

describe('Inbox copy does not promise auto-file quality (DECISIONS #536)', () => {
  it('test_regression__inbox_copy_does_not_promise_only_ambiguous_land_here', () => {
    expect(INBOX_PAGE_SUBTITLE).toMatch(/later label/i);
    assertHonest(INBOX_PAGE_SUBTITLE);
    assertHonest(INBOX_NAV_DESCRIPTION);
    assertHonest(INBOX_EMPTY_TITLE);
    assertHonest(INBOX_EMPTY_DESCRIPTION);
    assertHonest(INBOX_EMPTY_FOOTNOTE);

    const inboxNav = NAV_DESTINATIONS.find((d) => d.href === '/triage');
    expect(inboxNav?.description).toBe(INBOX_NAV_DESCRIPTION);

    const page = readFileSync(resolve('src/app/(app)/triage/page.tsx'), 'utf8');
    expect(page).toContain('INBOX_PAGE_SUBTITLE');
    expect(page).toContain('data-testid="inbox-subtitle"');
    expect(page).not.toMatch(/Only genuinely ambiguous/);

    const empty = readFileSync(resolve('src/components/onboarding/route-empty.tsx'), 'utf8');
    expect(empty).toContain('INBOX_EMPTY_TITLE');
    expect(empty).not.toMatch(/genuinely ambiguous/);
  });
});

describe('Inbox copy is merchant-group review, not Needs a category (DECISIONS #564)', () => {
  it('test_regression__inbox_copy_is_merchant_groups_not_needs_a_category', () => {
    for (const s of [
      INBOX_PAGE_SUBTITLE,
      INBOX_NAV_DESCRIPTION,
      INBOX_EMPTY_TITLE,
      INBOX_EMPTY_DESCRIPTION,
      INBOX_EMPTY_FOOTNOTE,
    ]) {
      expect(s).toMatch(/merchant groups/i);
      expect(s).toMatch(/review/i);
    }
    expect(INBOX_PAGE_SUBTITLE).toMatch(/Activity/);
    expect(INBOX_PAGE_SUBTITLE).toMatch(/Needs a category/);
    expect(INBOX_EMPTY_DESCRIPTION).toMatch(/Activity/);
    expect(INBOX_EMPTY_FOOTNOTE).toMatch(/Activity/);
    expect(INBOX_NAV_DESCRIPTION).not.toMatch(/still need a category/i);
    expect(INBOX_EMPTY_TITLE).not.toMatch(/still need a category/i);
  });
});
