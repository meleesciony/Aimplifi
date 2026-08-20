'use client';

/**
 * Public "Explore the demo" CTA (DECISIONS #489). Uses the #164/#166/#167
 * mutation recipe (onSubmit + own busy + withDeadline + assign on success) —
 * NOT `<form action={fn}>`, which rendered live as `action=""` and left a
 * document POST on /sign-in with zero auth cookies.
 *
 * On ActionDeadline: the session cookie is usually already set (#164), so land
 * on /dashboard rather than report a false failure.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';
import { ActionDeadline, withDeadline } from '@/components/triage/action-deadline';
import { demoSignIn } from '@/server/auth-actions';

export function DemoSignInButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await withDeadline(demoSignIn(), FORM_ACTION_DEADLINE_MS);
      if (res.ok) {
        window.location.assign('/dashboard');
        return;
      }
      setBusy(false);
    } catch (err) {
      if (err instanceof ActionDeadline) {
        window.location.assign('/dashboard');
        return;
      }
      setError('Something went wrong — please try again.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <Button
        type="submit"
        variant="outline"
        className="w-full"
        disabled={busy}
        data-testid="demo-sign-in"
      >
        {busy ? '…' : 'Explore the demo'}
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-400">
          {error}
        </p>
      )}
    </form>
  );
}
