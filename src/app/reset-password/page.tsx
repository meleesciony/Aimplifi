import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata = { title: 'Reset password' };

/**
 * Landing page for the emailed reset link (#257). The token rides ?token= and is
 * passed into the form as a hidden field; validity is judged only on submit (the
 * server never confirms a token exists before it's consumed — probing the URL
 * yields nothing).
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect('/dashboard');
  const { token } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">Set a new password</CardTitle>
          <CardDescription>
            {token
              ? 'Choose a new password for your account. The link from your email works once, for 30 minutes.'
              : 'This page needs the link from your reset email.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {token ? (
            <ResetPasswordForm token={token} />
          ) : (
            <Link
              href="/forgot-password"
              className="text-sm underline underline-offset-2 hover:text-foreground"
              data-testid="reset-missing-token-link"
            >
              Request a reset link
            </Link>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
