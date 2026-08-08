'use client';

/**
 * The holding account picker (C.23 / DECISIONS #431) — names the home the
 * monthly reserve set-aside lives in. A NAME, never a transfer: no write in
 * the reserve path moves money, and the sentence the picker feeds (" — set
 * aside in Checking") must not read as though the app executed one.
 *
 * Same mutation recipe as `ReserveForm` (#164/#166): explicit submit (a
 * `<select>` under React 19's form-action auto-reset is the exact hazard the
 * recipe exists for — we avoid form actions entirely), own busy flag,
 * deadline-bounded await, full reload on success.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { setReserveHoldingAccount } from '@/server/reserve-actions';
import { withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';

const inputCls = 'rounded-md border bg-background px-2 py-1.5 text-sm text-foreground';

export function HoldingAccountPicker({
  accounts,
  currentId,
  canWrite,
}: {
  accounts: { id: string; name: string }[];
  currentId: string | null;
  /** Demo fence rendered by the caller; the action refuses demo server-side too. */
  canWrite: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Local value so the reader can change the pick before saving; the saved
  // value is whatever the SERVER re-renders after the reload.
  const [value, setValue] = useState<string>(currentId ?? '');

  if (!canWrite) return null;

  async function onSave() {
    setBusy(true);
    setError(null);
    try {
      const res = await withDeadline(
        setReserveHoldingAccount(value === '' ? null : value),
        FORM_ACTION_DEADLINE_MS,
      );
      if (res.ok) {
        // The reloaded clause sentence is the confirmation that cannot lie.
        window.location.reload();
        return;
      }
      setError(res.error ?? 'That choice could not be saved — try again.');
    } catch {
      // Deadline: the write usually COMMITTED — re-sync rather than report a
      // false failure (#164 recovery rule).
      window.location.reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-xs text-muted-foreground" htmlFor="reserves-holding-account">
        Set aside in
      </label>
      <select
        id="reserves-holding-account"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className={inputCls}
        data-testid="reserves-holding-account"
      >
        <option value="">Don&apos;t name one</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={onSave}
        disabled={busy}
        data-testid="reserves-holding-account-save"
      >
        {busy ? 'Saving…' : 'Save'}
      </Button>
      {error ? (
        <span role="alert" className="text-xs text-red-500" data-testid="reserves-holding-account-error">
          {error}
        </span>
      ) : null}
    </div>
  );
}
