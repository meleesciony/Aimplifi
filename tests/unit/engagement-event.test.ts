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
