'use client';

/**
 * Password input with a show/hide viewer toggle (owner request, 2026-07-21).
 * The input stays UNCONTROLLED — only its `type` attribute flips — so the DOM
 * owns the typed text (docs/lessons/mutation-form-recipe.md: a controlled input
 * loses text typed before hydration). The toggle is a sibling button, never a
 * submit: it must not trigger the surrounding form action.
 */
import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

type PasswordInputProps = Omit<React.ComponentProps<'input'>, 'type'> & {
  'data-testid'?: string;
};

export function PasswordInput({ className, ...props }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const testId = props['data-testid'];
  return (
    <div className="relative">
      <input type={visible ? 'text' : 'password'} className={cn(className, 'pr-10')} {...props} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        data-testid={testId ? `${testId}-toggle` : undefined}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
      >
        {visible ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
      </button>
    </div>
  );
}
