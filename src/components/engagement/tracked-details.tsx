'use client';

/**
 * `<details>` that records `expanded` when opened (TASKS 3.1).
 */
import type { ReactNode } from 'react';
import { logEngagement } from '@/server/engagement-actions';
import type { EngagementSubjectKey, EngagementSurface } from '@/lib/engine/engagement/event';

export function TrackedDetails({
  surface = 'dashboard',
  subjectKey,
  summary,
  summaryClassName,
  children,
  className,
}: {
  surface?: EngagementSurface;
  subjectKey: EngagementSubjectKey;
  summary: string;
  summaryClassName?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details
      className={className}
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open) {
          void logEngagement({ surface, verb: 'expanded', subjectKey });
        }
      }}
    >
      <summary className={summaryClassName ?? 'cursor-pointer'}>{summary}</summary>
      {children}
    </details>
  );
}
