'use client';

/**
 * Forgot-password request form (#257). On submit the server always answers with
 * the same neutral confirmation (no account-enumeration), so the success state
 * simply replaces the form with that message.
 */
import { useActionState } from 'react';
import { type ResetRequestState, requestPasswordReset } from '@/server/password-reset-actions';

const inputClass =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50';

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState<ResetRequestState, FormData>(
    requestPasswordReset,
    {},
  );

  if (state?.message) {
    return (
      <p role="status" data-testid="reset-request-sent" className="text-sm text-muted-foreground">
        {state.message}
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-2" data-testid="reset-request-form">
      <input
        type="email"
        name="email"
        required
        autoComplete="email"
        placeholder="you@email.com"
        aria-label="Email"
        data-testid="reset-email"
        className={inputClass}
      />
      <button
        type="submit"
        disabled={pending}
        data-testid="reset-request-submit"
        className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/80 disabled:opacity-50"
      >
        {pending ? '…' : 'Email me a reset link'}
      </button>
      {state?.error && (
        <p role="alert" data-testid="reset-request-error" className="text-xs text-red-400">
          {state.error}
        </p>
      )}
    </form>
  );
}
