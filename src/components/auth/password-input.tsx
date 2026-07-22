'use client';

/**
 * Password input with a show/hide viewer toggle (owner request, 2026-07-21).
 * The input stays UNCONTROLLED — only its `type` attribute flips — so the DOM
 * owns the typed text (docs/lessons/mutation-form-recipe.md: a controlled input
 * loses text typed before hydration). The toggle is a sibling button, never a
 * submit: it must not trigger the surrounding form action. Visibility is dropped
 * again at submit so the form the browser sees is the pre-viewer form (see the
 * useEffect below).
 */
import { Eye, EyeOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

type PasswordInputProps = Omit<React.ComponentProps<'input'>, 'type'> & {
  'data-testid'?: string;
};

export function PasswordInput({ className, ...props }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const testId = props['data-testid'];

  // Re-hide before the form submits, so the submitted DOM carries a real
  // `type="password"` field exactly as it did before this viewer existed. A
  // browser's password manager inspects the form at submit time to decide whether
  // to offer to save the credential, and a field left as `type="text"` by the
  // viewer need not read as a password field to it. The `type` write is
  // imperative because a React state update would not reach the DOM before the
  // submit handlers run; `setVisible` then keeps state and DOM agreeing.
  useEffect(() => {
    const el = ref.current;
    const form = el?.form;
    if (!el || !form) return;
    const hide = () => {
      el.type = 'password';
      setVisible(false);
    };
    form.addEventListener('submit', hide, true);
    return () => form.removeEventListener('submit', hide, true);
  }, []);

  return (
    <div className="relative">
      <input
        ref={ref}
        type={visible ? 'text' : 'password'}
        className={cn(className, 'pr-10')}
        {...props}
      />
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
