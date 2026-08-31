'use server';

/**
 * Tax-advantaged contribution-room mutation (W.6(b) follow-up / DECISIONS #529).
 * Session verified, fenced for the shared demo, parsed through the pure
 * engine, audit-logged, then the two surfaces that rank/phrase it revalidate.
 */
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { DEMO_ENTRY_BLOCKED, isDemoUser } from '@/lib/demo-user';
import { auditLog, requireUserId } from '@/server/authz';
import {
  parseTaxAdvantagedRoom,
  taxAdvantagedRoomToColumn,
} from '@/lib/engine/settings/tax-advantaged-room';
import type { TaxAdvantagedRoom } from '@/lib/engine/fi/next-dollar';

export interface TaxAdvantagedRoomResult {
  ok: boolean;
  /** Top-level refusal (the demo fence). */
  error?: string;
  /** On `ok`: the status now stored (`unknown` = column null). */
  status?: TaxAdvantagedRoom;
}

export async function updateTaxAdvantagedRoom(
  _prev: TaxAdvantagedRoomResult | null,
  formData: FormData,
): Promise<TaxAdvantagedRoomResult> {
  const userId = await requireUserId();

  // The demo is ONE shared row every anonymous visitor signs into: a room
  // status typed here would re-rank the next-dollar card for every later
  // visitor. The Settings card hides the form for demo; this is the
  // server-side defense in depth.
  if (isDemoUser(userId)) return { ok: false, error: DEMO_ENTRY_BLOCKED };

  const status = parseTaxAdvantagedRoom(String(formData.get('taxAdvantagedRoom') ?? ''));

  await prisma.user.update({
    where: { id: userId },
    data: { taxAdvantagedRoom: taxAdvantagedRoomToColumn(status) },
  });

  await auditLog(userId, 'settings.taxAdvantagedRoom.update', { status });

  revalidatePath('/settings');
  revalidatePath('/coach');

  return { ok: true, status };
}
