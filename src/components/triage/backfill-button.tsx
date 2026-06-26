'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { backfillCategorization } from '@/server/backfill-actions';

/**
 * Re-run the improved categorizer over the existing review pile (DECISIONS #116).
 * The keyword/merchant layer only runs at ingest, so rows imported before a rule
 * existed keep their old verdict until this re-files them. Reports an honest
 * result: how many were auto-filed vs how many still need a human look.
 */
export function BackfillButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function run() {
    if (pending) return;
    setErr(null);
    setMsg(null);
    startTransition(async () => {
      try {
        const res = await backfillCategorization();
        if (res.refiled === 0) {
          setMsg(
            res.scanned === 0
              ? 'Nothing in review to re-check.'
              : `No new matches — ${res.stillUnsure} still need a look.`,
          );
        } else {
          const aiNote = res.llmRefiled > 0 ? ` (${res.llmRefiled} with AI)` : '';
          setMsg(
            `Auto-filed ${res.refiled} transaction${res.refiled === 1 ? '' : 's'}${aiNote}` +
              (res.stillUnsure > 0 ? ` · ${res.stillUnsure} still need a look.` : '.'),
          );
        }
        router.refresh();
      } catch {
        setErr('Could not re-run the categorizer. Please try again.');
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={run}
        disabled={pending}
        data-testid="backfill-run"
        className="gap-1.5"
      >
        <Sparkles className="size-3.5" aria-hidden /> {pending ? 'Re-checking…' : 'Re-run categorizer'}
      </Button>
      {msg && (
        <p className="text-xs text-muted-foreground" data-testid="backfill-result">
          {msg}
        </p>
      )}
      {err && (
        <p role="alert" className="text-xs text-red-400" data-testid="backfill-error">
          {err}
        </p>
      )}
    </div>
  );
}
