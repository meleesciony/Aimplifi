'use client';

/**
 * Employer-match Settings card (W.6(b) follow-up / DECISIONS #528): a closed
 * status, not a percentage. Form-state idiom is RichLifeForm's: direct
 * server-action invocation with a busy flag and a deadline reload — NOT
 * `useActionState` (mutation-form-recipe).
 */
import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { parseEmployerMatch } from '@/lib/engine/settings/employer-match';
import type { EmployerMatch } from '@/lib/engine/fi/next-dollar';
import {
  updateEmployerMatch,
  type EmployerMatchResult,
} from '@/server/employer-match-actions';

const OPTIONS: { value: EmployerMatch; label: string }[] = [
  { value: 'unknown', label: "Not sure yet" },
  { value: 'uncaptured', label: "I have a match I'm not fully capturing" },
  { value: 'captured', label: 'I already capture the full match' },
  { value: 'none', label: "I don't have an employer match" },
];

export function EmployerMatchForm({
  current,
  canWrite = true,
}: {
  /** Stored column; null = never written = unknown. */
  current: string | null;
  /** False on the shared demo: one visitor's status would re-rank Coach
   *  for the next (same shape as RichLifeForm's canWrite). */
  canWrite?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<EmployerMatchResult | null>(null);
  const selected =
    result?.ok && result.status != null ? result.status : parseEmployerMatch(current);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const res = await withDeadline(updateEmployerMatch(null, fd), FORM_ACTION_DEADLINE_MS);
      setResult(res);
    } catch {
      window.location.reload();
      return;
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card data-testid="employer-match-card">
      <CardHeader className="pb-2">
        <CardDescription>Workplace 401(k) match</CardDescription>
        <CardTitle className="text-base">Employer match</CardTitle>
      </CardHeader>
      <CardContent>
        {!canWrite && (
          <p className="text-sm text-muted-foreground" data-testid="employer-match-demo-note">
            The demo is a shared account, so a match status can&rsquo;t be saved here —
            create your own free account and Coach will use it on the next-dollar card.
          </p>
        )}
        {canWrite ? (
          <form onSubmit={onSubmit} className="space-y-3" data-testid="employer-match-form">
            <fieldset className="space-y-2" key={selected}>
              <legend className="text-sm">
                Does your workplace match retirement contributions?
              </legend>
              <p className="text-xs text-muted-foreground" id="employer-match-hint">
                This is a rung on the next-dollar order, not a percentage compared to a
                loan. Tax-advantaged contribution room is still not collected.
              </p>
              {OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className="tap-target flex cursor-pointer items-center gap-2 text-sm"
                >
                  <input
                    type="radio"
                    name="employerMatch"
                    value={opt.value}
                    defaultChecked={selected === opt.value}
                    aria-describedby="employer-match-hint"
                    data-testid={`employer-match-${opt.value}`}
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
                data-testid="employer-match-saved"
              >
                <CheckCircle2 className="size-4" aria-hidden />
                {result.status === 'unknown'
                  ? 'Cleared — Coach skips the match rung until you set it.'
                  : 'Saved — Coach uses this on the next-dollar card.'}
              </span>
            ) : null}
            <Button type="submit" size="sm" disabled={busy} data-testid="employer-match-save">
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
