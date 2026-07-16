/**
 * Engagement-event closed-set validator (TASKS 3.1 / DECISIONS #209).
 */
import { describe, expect, it } from 'vitest';
import {
  ENGAGEMENT_SUBJECT_KEYS,
  ENGAGEMENT_SURFACES,
  ENGAGEMENT_VERBS,
  isValidEngagementEvent,
} from '@/lib/engine/engagement/event';

describe('isValidEngagementEvent', () => {
  it('accepts every closed-set combination of surface × verb × known subject', () => {
    for (const surface of ENGAGEMENT_SURFACES) {
      for (const verb of ENGAGEMENT_VERBS) {
        for (const subjectKey of ENGAGEMENT_SUBJECT_KEYS) {
          expect(isValidEngagementEvent({ surface, verb, subjectKey })).toBe(true);
        }
      }
    }
  });

  it('accepts every nudge:<kind> subject the feed engine can emit (NUDGE_PLAN slice 2)', () => {
    // Runtime confirmation of the compile-time lockstep in engine/nudge/select.ts
    // (subjectKey returns EngagementSubjectKey). If a ProposalKind is added, add its
    // `nudge:<kind>` here AND to ENGAGEMENT_SUBJECT_KEYS, or logging silently no-ops.
    const NUDGE_SUBJECTS = [
      'nudge:payment_due',
      'nudge:cash_flow_dip',
      'nudge:cash_needed_shortfall',
      'nudge:price-increase',
      'nudge:unused-subscription',
      'nudge:insurance-reshop',
      'nudge:negotiable-bill',
    ] as const;
    for (const subjectKey of NUDGE_SUBJECTS) {
      expect(ENGAGEMENT_SUBJECT_KEYS as readonly string[]).toContain(subjectKey);
      expect(isValidEngagementEvent({ surface: 'dashboard', verb: 'dismissed', subjectKey })).toBe(true);
    }
  });

  it('rejects unknown surface, verb, or subjectKey (incl. PII-shaped keys)', () => {
    expect(
      isValidEngagementEvent({ surface: 'dashboard', verb: 'viewed', subjectKey: 'return-moment' }),
    ).toBe(true);
    expect(
      isValidEngagementEvent({ surface: 'analytics', verb: 'viewed', subjectKey: 'return-moment' }),
    ).toBe(false);
    expect(
      isValidEngagementEvent({ surface: 'dashboard', verb: 'clicked', subjectKey: 'return-moment' }),
    ).toBe(false);
    expect(
      isValidEngagementEvent({
        surface: 'dashboard',
        verb: 'acted',
        subjectKey: 'jane@example.com',
      }),
    ).toBe(false);
    expect(
      isValidEngagementEvent({ surface: 'dashboard', verb: 'acted', subjectKey: 'card-chase-4242' }),
    ).toBe(false);
  });
});
