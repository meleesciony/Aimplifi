'use client';

import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { backfillCategorization } from '@/server/backfill-actions';
import { ACTION_DEADLINE_MS, ActionDeadline, withDeadline } from '@/components/triage/action-deadline';
import { setFlash, takeFlash } from '@/components/finance/flash';

/**
 * Re-run the improved categorizer over the existing review pile (DECISIONS #116).
 * The keyword/merchant layer only runs at ingest, so rows imported before a rule
 * existed keep their old verdict until this re-files them. Reports an honest
 * result: how many were auto-filed vs how many still need a human look.
 *
 * Reliable-mutation recipe (#167, extends #164/#166): plain pending state +
 * deadline-bounded await (the triage 15s budget — backfill scans the whole
 * pile and may consult the LLM). When rows WERE refiled, success is a full
 * reload with the honest count riding setFlash across it — the old
 * router.refresh() never updated TriageInbox's client-held groups at all, so
 * "Auto-filed 12" could sit beside the 12 undrained rows. A no-op result
 * ("no new matches") changes nothing on the page and stays inline.
 */
export function BackfillButton() {
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // The honest count set before the confirming reload.
  useEffect(() => {
    const m = takeFlash('backfill');
    // eslint-disable-next-line react-hooks/set-state-in-effect -- post-hydration one-shot sessionStorage read (#167); a lazy useState initializer would hydration-mismatch (server renders no flash)
    if (m) setMsg(m);
  }, []);

  async function run() {
    if (pending) return;
    setErr(null);
    setMsg(null);
    setPending(true);
    try {
      const res = await withDeadline(backfillCategorization(), ACTION_DEADLINE_MS);
      if (res.refiled === 0) {
        setMsg(
          res.scanned === 0
            ? 'Nothing in review to re-check.'
            : `No new matches — ${res.stillUnsure} still need a look.`,
        );
        setPending(false);
        return;
      }
      const aiNote = res.llmRefiled > 0 ? ` (${res.llmRefiled} with AI)` : '';
      // A tag written here goes into a tax-year total, so it is COUNTED rather than
      // folded into the filing number (O.15 slice 6): the two describe different
      // sets, and a reader who is not told a deduction claim was written has no
      // reason to go and check it.
      const tagNote =
        res.taxTagged > 0
          ? ` · ${res.taxTagged} tagged for taxes by your rules`
          : '';
      setFlash(
        'backfill',
        `Auto-filed ${res.refiled} transaction${res.refiled === 1 ? '' : 's'}${aiNote}${tagNote}` +
          (res.stillUnsure > 0 ? ` · ${res.stillUnsure} still need a look.` : '.'),
      );
      // Reload: the drained queue is the confirmation that can't lie.
      // pending stays true so the button is disabled until the new page.
      window.location.reload();
    } catch (e) {
      if (e instanceof ActionDeadline) {
        // The backfill usually COMMITTED and only the confirmation stream was
        // severed — re-sync rather than report a false failure (#164 rule).
        window.location.reload();
        return;
      }
      setErr('Could not re-run the categorizer. Please try again.');
      setPending(false);
    }
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
