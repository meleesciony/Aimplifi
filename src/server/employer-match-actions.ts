'use server';

/**
 * Employer-match status mutation (W.6(b) follow-up / DECISIONS #528).
 * Session verified, fenced for the shared demo, parsed through the pure
 * engine, audit-logged, then the two surfaces that rank/phrase it revalidate.
 */
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { DEMO_ENTRY_BLOCKED, isDemoUser } from '@/lib/demo-user';
import { auditLog, requireUserId } from '@/server/authz';
import {
  employerMatchToColumn,
  parseEmployerMatch,
} from '@/lib/engine/settings/employer-match';
import type { EmployerMatch } from '@/lib/engine/fi/next-dollar';

export interface EmployerMatchResult {
  ok: boolean;
  /** Top-level refusal (the demo fence). */
  error?: string;
  /** On `ok`: the status now stored (`unknown` = column null). */
  status?: EmployerMatch;
}

export async function updateEmployerMatch(
  _prev: EmployerMatchResult | null,
  formData: FormData,
): Promise<EmployerMatchResult> {
  const userId = await requireUserId();

  // The demo is ONE shared row every anonymous visitor signs into: a match
  // status typed here would re-rank the next-dollar card for every later
  // visitor. The Settings card hides the form for demo; this is the
  // server-side defense in depth.
  if (isDemoUser(userId)) return { ok: false, error: DEMO_ENTRY_BLOCKED };

  const status = parseEmployerMatch(String(formData.get('employerMatch') ?? ''));

  await prisma.user.update({
    where: { id: userId },
    data: { employerMatch: employerMatchToColumn(status) },
  });

  await auditLog(userId, 'settings.employerMatch.update', { status });

  revalidatePath('/settings');
  revalidatePath('/coach');

  return { ok: true, status };
}
