'use client';

/**
 * Add or edit a transaction note. Compact idle for Home recent strip.
 * Same mutation recipe as TxnDescriptorControl — plain onSubmit with busy state.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  updateTransactionNote,
  type TxnNoteResult,
} from '@/server/transaction-note-actions';
import { TXN_NOTE_MAX_CHARS } from '@/lib/engine/tax/note';
import { withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';

const inputCls = 'rounded-md border bg-background px-2 py-1.5 text-sm text-foreground';

function compactIdleLabel(note: string | null): string {
  if (!note) return 'Note';
  if (note.length <= 24) return note;
  return `${note.slice(0, 24)}…`;
}

export function TxnNoteControl({
  transactionId,
  note,
  triggerTestId = 'detail-note',
  compact = false,
}: {
  transactionId: string;
  note: string | null;
  triggerTestId?: string;
  compact?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TxnNoteResult | null>(null);

  async function runNote(fd: FormData) {
    setBusy(true);
    try {
      const res = await withDeadline(updateTransactionNote(transactionId, fd), FORM_ACTION_DEADLINE_MS);
      setResult(res);
      if (res.ok) {
        window.location.reload();
        return;
      }
    } catch {
      window.location.reload();
      return;
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const fd = new FormData(e.currentTarget);
    await runNote(fd);
  }

  async function onClear() {
    if (busy) return;
    const fd = new FormData();
    fd.set('note', '');
    await runNote(fd);
  }

  if (!editing) {
    return (
      <button
        type="button"
        className={
          compact
            ? 'shrink-0 text-xs text-foreground underline decoration-muted-foreground/50 decoration-dotted underline-offset-4 hover:decoration-foreground'
            : 'text-foreground underline decoration-muted-foreground/50 decoration-dotted underline-offset-4 hover:decoration-foreground'
        }
        data-testid={triggerTestId}
        aria-label={note ? 'Edit note' : 'Add note'}
        onClick={() => setEditing(true)}
      >
        {compact ? compactIdleLabel(note) : note ?? 'Note'}
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-1 space-y-1" data-testid="txn-note-form">
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`txn-note-${transactionId}`}>
          Note
        </label>
        <textarea
          id={`txn-note-${transactionId}`}
          name="note"
          rows={compact ? 2 : 3}
          maxLength={TXN_NOTE_MAX_CHARS}
          defaultValue={note ?? ''}
          placeholder="What was this for?"
          aria-invalid={result?.errors?.note ? true : undefined}
          aria-describedby={result?.errors?.note ? 'txn-note-error' : undefined}
          className={`min-w-0 flex-1 ${inputCls}`}
          data-testid="txn-note-input"
        />
        <Button type="submit" size="sm" disabled={busy} data-testid="txn-note-save">
          {busy ? 'Saving…' : 'Save'}
        </Button>
        {note ? (
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void onClear()}>
            Clear
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
      {result?.errors?.note ? (
        <p id="txn-note-error" className="text-xs text-red-500" role="alert">
          {result.errors.note}
        </p>
      ) : null}
      {result?.error ? (
        <p className="text-xs text-red-500" role="alert" data-testid="txn-note-form-error">
          {result.error}
        </p>
      ) : null}
    </form>
  );
}
