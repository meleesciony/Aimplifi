import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata = { title: 'Forgot password' };

export default async function ForgotPasswordPage() {
  const session = await auth();
  if (session?.user) redirect('/dashboard');

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">Forgot your password?</CardTitle>
          <CardDescription>
            Enter the email you sign in with and we’ll send a reset link.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ForgotPasswordForm />
          <Link
            href="/sign-in"
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            data-testid="back-to-sign-in"
          >
            ← Back to sign in
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
