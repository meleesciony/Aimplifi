'use client';

/**
 * Always-on header Sign out (DECISIONS #492). Uses the #164/#166/#167
 * mutation recipe (onSubmit + own busy + withDeadline + assign on success) —
 * NOT `<form action={fn}>`, which rendered live as `action=""` and could clear
 * the session on the server while the client never navigated to /sign-in.
 *
 * On ActionDeadline: the session cookie is usually already cleared (#164), so
 * land on /sign-in rather than report a false failure.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';
import { ActionDeadline, withDeadline } from '@/components/triage/action-deadline';
import { doSignOut } from '@/server/auth-actions';

export function SignOutButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await withDeadline(doSignOut(), FORM_ACTION_DEADLINE_MS);
      if (res.ok) {
        window.location.assign('/sign-in');
        return;
      }
      setBusy(false);
    } catch (err) {
      if (err instanceof ActionDeadline) {
        window.location.assign('/sign-in');
        return;
      }
      setError('Something went wrong — please try again.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="shrink-0 sm:pt-0.5" data-testid="sign-out-form">
      <Button variant="ghost" size="sm" type="submit" disabled={busy}>
        {busy ? '…' : 'Sign out'}
      </Button>
      {error && (
        <p role="alert" className="sr-only">
          {error}
        </p>
      )}
    </form>
  );
}
