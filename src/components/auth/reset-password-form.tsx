'use client';

/**
 * Reset-password confirm form (#257). The token arrives from the page (URL) as a
 * prop and rides a hidden field; success replaces the form with a sign-in link
 * (no auto-sign-in — the fresh password is proven at the sign-in form, and every
 * pre-reset session was just revoked server-side).
 */
import Link from 'next/link';
import { useActionState } from 'react';
import { PasswordInput } from '@/components/auth/password-input';
import { type ResetConfirmState, confirmPasswordReset } from '@/server/password-reset-actions';
import { AUTH_INPUT_CLASS } from '@/components/auth/field-styles';

const inputClass = AUTH_INPUT_CLASS;

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState<ResetConfirmState, FormData>(
    confirmPasswordReset,
    {},
  );

  if (state?.success) {
    return (
      <div className="space-y-2" data-testid="reset-success">
        <p role="status" className="text-sm text-muted-foreground">
          Password updated. You’ve been signed out everywhere — sign in with your new password.
        </p>
        <Link
          href="/sign-in"
          data-testid="reset-success-sign-in"
          className="inline-block w-full rounded-md bg-primary px-3 py-2 text-center text-sm font-medium text-primary-foreground hover:bg-primary/80"
        >
          Go to sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-2" data-testid="reset-confirm-form">
      <input type="hidden" name="token" value={token} />
      <PasswordInput
        name="password"
        required
        minLength={8}
        autoComplete="new-password"
        placeholder="New password (8+ characters)"
        aria-label="New password"
        data-testid="reset-password-input"
        className={inputClass}
      />
      <button
        type="submit"
        disabled={pending}
        data-testid="reset-confirm-submit"
        className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/80 disabled:opacity-50"
      >
        {pending ? '…' : 'Set new password'}
      </button>
      {state?.error && (
        <p role="alert" data-testid="reset-confirm-error" className="text-xs text-red-400">
          {state.error}
        </p>
      )}
    </form>
  );
}
