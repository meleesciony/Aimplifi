'use client';

/**
 * Tax-advantaged contribution-room Settings card (W.6(b) follow-up /
 * DECISIONS #529): a closed status, not a dollar amount and not a vehicle.
 * Form-state idiom is RichLifeForm's: direct server-action invocation with a
 * busy flag and a deadline reload — NOT `useActionState` (mutation-form-recipe).
 */
import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { parseTaxAdvantagedRoom } from '@/lib/engine/settings/tax-advantaged-room';
import type { TaxAdvantagedRoom } from '@/lib/engine/fi/next-dollar';
import {
  updateTaxAdvantagedRoom,
  type TaxAdvantagedRoomResult,
} from '@/server/tax-advantaged-room-actions';

const OPTIONS: { value: TaxAdvantagedRoom; label: string }[] = [
  { value: 'unknown', label: 'Not sure yet' },
  { value: 'remaining', label: 'I still have unused contribution room' },
  { value: 'maxed', label: "I've already maxed contribution room" },
  { value: 'none', label: "Tax-advantaged accounts don't apply to me" },
];

export function TaxAdvantagedRoomForm({
  current,
  canWrite = true,
}: {
  /** Stored column; null = never written = unknown. */
  current: string | null;
  /** False on the shared demo: one visitor's status would re-rank Coach
   *  for the next (same shape as EmployerMatchForm's canWrite). */
  canWrite?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TaxAdvantagedRoomResult | null>(null);
  const selected =
    result?.ok && result.status != null ? result.status : parseTaxAdvantagedRoom(current);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const res = await withDeadline(updateTaxAdvantagedRoom(null, fd), FORM_ACTION_DEADLINE_MS);
      setResult(res);
    } catch {
      window.location.reload();
      return;
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card data-testid="tax-advantaged-room-card">
      <CardHeader className="pb-2">
        <CardDescription>Contribution room</CardDescription>
        <CardTitle className="text-base">Tax-advantaged contribution room</CardTitle>
      </CardHeader>
      <CardContent>
        {!canWrite && (
          <p className="text-sm text-muted-foreground" data-testid="tax-advantaged-room-demo-note">
            The demo is a shared account, so contribution-room status can&rsquo;t be saved here —
            create your own free account and Coach will use it on the next-dollar card.
          </p>
        )}
        {canWrite ? (
          <form onSubmit={onSubmit} className="space-y-3" data-testid="tax-advantaged-room-form">
            <fieldset className="space-y-2" key={selected}>
              <legend className="text-sm">
                Do you still have unused tax-advantaged contribution room?
              </legend>
              <p className="text-xs text-muted-foreground" id="tax-advantaged-room-hint">
                This is a rung on the next-dollar order, not a dollar amount and not a pick of
                which account. Aimplifi names the envelope; it does not recommend a vehicle.
              </p>
              {OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className="tap-target flex cursor-pointer items-center gap-2 text-sm"
                >
                  <input
                    type="radio"
                    name="taxAdvantagedRoom"
                    value={opt.value}
                    defaultChecked={selected === opt.value}
                    aria-describedby="tax-advantaged-room-hint"
                    data-testid={`tax-advantaged-room-${opt.value}`}
                  />
                  {opt.label}
                </label>
              ))}
            </fieldset>
            {result?.error ? (
              <span role="alert" className="block text-xs text-red-400">
                {result.error}
              </span>
            ) : result?.ok ? (
              <span
                role="status"
                className="flex items-center gap-1 text-xs text-positive-500"
                data-testid="tax-advantaged-room-saved"
              >
                <CheckCircle2 className="size-4" aria-hidden />
                {result.status === 'unknown'
                  ? 'Cleared — Coach skips the contribution-room rung until you set it.'
                  : 'Saved — Coach uses this on the next-dollar card.'}
              </span>
            ) : null}
            <Button type="submit" size="sm" disabled={busy} data-testid="tax-advantaged-room-save">
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
