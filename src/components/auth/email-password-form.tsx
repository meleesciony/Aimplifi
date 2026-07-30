'use client';

/**
 * Email/password sign-in + sign-up (DECISIONS #43). One form, a mode toggle in a
 * hidden field; the `authenticate` action dispatches to sign-in or sign-up.
 */
import { useActionState, useState } from 'react';
import { PasswordInput } from '@/components/auth/password-input';
import { type AuthFormState, authenticate } from '@/server/auth-actions';
import { AUTH_INPUT_CLASS } from '@/components/auth/field-styles';

const inputClass = AUTH_INPUT_CLASS;

export function EmailPasswordForm() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(authenticate, {});

  return (
    <form action={formAction} className="space-y-2" data-testid="auth-form" data-mode={mode}>
      <input type="hidden" name="mode" value={mode} />
      <input
        type="email"
        name="email"
        required
        autoComplete="email"
        // React resets this uncontrolled form once the action returns, so a
        // rejection used to empty BOTH fields (measured in tests/e2e/auth.spec.ts)
        // and every retry was a full re-entry. `defaultValue` is what the reset
        // restores TO, so echoing the submitted address back puts it straight
        // back. Keyed on the address so a NEW value replaces the mounted default.
        key={state?.email ?? ''}
        defaultValue={state?.email ?? ''}
        placeholder="you@email.com"
        aria-label="Email"
        data-testid="auth-email"
        className={inputClass}
      />
      <PasswordInput
        name="password"
        required
        minLength={8}
        autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
        placeholder={mode === 'signin' ? 'Password' : 'Create a password (8+ characters)'}
        aria-label="Password"
        data-testid="auth-password"
        className={inputClass}
      />
      <button
        type="submit"
        disabled={pending}
        data-testid="auth-submit"
        className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/80 disabled:opacity-50"
      >
        {pending ? '…' : mode === 'signin' ? 'Sign in' : 'Create account'}
      </button>
      {state?.error && (
        <p role="alert" data-testid="auth-error" className="text-xs text-red-400">
          {state.error}
        </p>
      )}
      <div className="flex items-center justify-between">
        <button
          type="button"
          data-testid="auth-toggle"
          onClick={() => setMode((m) => (m === 'signin' ? 'signup' : 'signin'))}
          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          {mode === 'signin' ? 'New here? Create an account' : 'Have an account? Sign in'}
        </button>
        {mode === 'signin' && (
          <a
            href="/forgot-password"
            data-testid="forgot-password-link"
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            Forgot password?
          </a>
        )}
      </div>
    </form>
  );
}
