'use client';

/**
 * "Sign out of all devices" (Gap 6 §3 — multi-device session invalidation). A
 * native `<form action>` so the server-side signOut redirect is unchanged; the
 * button reflects a live busy state via useFormStatus (mirrors DeleteSubmit) so
 * the beat between the epoch bump and the redirect gives feedback and blocks a
 * double-submit. Not data-destructive (you simply sign back in), so — like the
 * one-tap Clear precedent — it needs no typed-confirmation gate; the warning
 * precedes the control and is announced with it (aria-describedby).
 */
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { revokeOtherSessions } from '@/server/account-actions';

function RevokeSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="outline"
      disabled={pending}
      aria-describedby="revoke-warning"
      data-testid="revoke-sessions-submit"
    >
      {pending ? 'Signing out…' : 'Sign out of all devices'}
    </Button>
  );
}

export function SignOutEverywhere() {
  return (
    <div className="space-y-2">
      <p id="revoke-warning" className="text-sm text-muted-foreground">
        Ends every signed-in session — this device and any other. Use it if you signed in
        on a shared or lost device. You&apos;ll need to sign in again here.
      </p>
      <form action={revokeOtherSessions} data-testid="revoke-sessions-form">
        <RevokeSubmit />
      </form>
    </div>
  );
}
