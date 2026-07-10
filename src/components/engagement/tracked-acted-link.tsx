'use client';

/**
 * Whole-card / CTA Link that records an `acted` engagement event (TASKS 3.1).
 * Fire-and-forget — navigation must not wait on the ledger write.
 */
import Link from 'next/link';
import type { ComponentProps } from 'react';
import { logEngagement } from '@/server/engagement-actions';
import type { EngagementSubjectKey, EngagementSurface } from '@/lib/engine/engagement/event';

type Props = Omit<ComponentProps<typeof Link>, 'onClick'> & {
  surface?: EngagementSurface;
  subjectKey: EngagementSubjectKey;
};

export function TrackedActedLink({
  surface = 'dashboard',
  subjectKey,
  children,
  ...rest
}: Props) {
  return (
    <Link
      {...rest}
      onClick={() => {
        void logEngagement({ surface, verb: 'acted', subjectKey });
      }}
    >
      {children}
    </Link>
  );
}
