'use client';

/**
 * The "My Rich Life" setting (C.13 / plan P1.3): one freeform line, saved via
 * the fenced server action.
 *
 * Form-state idiom is MoneyDialsForm's, deliberately: direct server-action
 * invocation with its own busy flag and a deadline reload — NOT React
 * `useActionState` (#166 / `mutation-form-recipe`: React 19's form-action
 * auto-reset could revert the input on the error return, and the "save
 * committed" case is a reload on deadline).
 */
import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { updateRichLife, type RichLifeResult } from '@/server/rich-life-actions';

const fieldClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground';

export function RichLifeForm({
  current,
  canWrite = true,
}: {
  /** The stored vision; null = never written. */
  current: string | null;
  /** False on the shared demo: one visitor's line would echo to the next
   *  (same shape as MoneyDialsForm's canWrite). The value stays readable via
   *  the /coach echo while it exists; the demo row never has one. */
  canWrite?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RichLifeResult | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const res = await withDeadline(updateRichLife(null, fd), FORM_ACTION_DEADLINE_MS);
      setResult(res);
    } catch {
      // Deadline: the save usually COMMITTED — the reload shows the truth.
      window.location.reload();
      return;
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card data-testid="rich-life-card">
      <CardHeader className="pb-2">
        <CardDescription>What the numbers are in service of</CardDescription>
        <CardTitle className="text-base">My Rich Life</CardTitle>
      </CardHeader>
      <CardContent>
        {!canWrite && (
          <p className="text-sm text-muted-foreground" data-testid="rich-life-demo-note">
            The demo is a shared account, so your Rich Life line can&rsquo;t be saved here —
            create your own free account and it&rsquo;ll be waiting for you.
          </p>
        )}
        {canWrite ? (
          <form onSubmit={onSubmit} className="space-y-3" data-testid="rich-life-form">
            <label htmlFor="rich-life-vision" className="block text-sm">
              In one line, what does a rich life look like for you?
            </label>
            {/* Deliberately NO maxLength (critic F1): a control cap would clamp
                the reader's answer to the first 120 chars and make the action's
                over-cap REJECT unreachable — a silently truncated vision is the
                exact "rewords it without telling them" the engine forbids. The
                rejection path instead keeps the typed text and names the limit. */}
            <input
              id="rich-life-vision"
              name="vision"
              type="text"
              placeholder="What you're building toward — e.g. three months of travel every year"
              defaultValue={current ?? ''}
              aria-describedby={result?.error ? 'rich-life-error' : undefined}
              className={fieldClass}
              data-testid="rich-life-input"
            />
            {result?.error ? (
              <span id="rich-life-error" role="alert" className="block text-xs text-red-400">
                {result.error}
              </span>
            ) : result?.ok ? (
              <span
                // F7: the confirmation must be announced (role="status" live
                // region), not a silent paint — the error already uses alert.
                role="status"
                className="flex items-center gap-1 text-xs text-positive-500"
                data-testid="rich-life-saved"
              >
                <CheckCircle2 className="size-4" aria-hidden />
                {result.hasVision
                  ? 'Saved — it appears at the top of your FI Coach.'
                  : 'Vision cleared — the FI Coach shows no Rich Life line.'}
              </span>
            ) : null}
            <Button type="submit" size="sm" disabled={busy} data-testid="rich-life-save">
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
