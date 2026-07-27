import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SESSION_IDLE_TIMEOUT_MINUTES } from '@/auth.config';
import { DEMO_USER_ID, auth, signIn } from '@/auth';
import { EmailPasswordForm } from '@/components/auth/email-password-form';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { googleSignIn } from '@/server/auth-actions';
import { prisma } from '@/lib/db';

export default async function SignInPage() {
  const session = await auth();
  if (session?.user) redirect('/dashboard');

  const googleEnabled = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

  async function demoSignIn() {
    'use server';
    try {
      await prisma.auditLog.create({ data: { userId: DEMO_USER_ID, action: 'auth.signin', meta: '{}' } });
    } catch {}
    await signIn('demo', { redirectTo: '/dashboard' });
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">
            Aim<span className="text-emerald-500">plifi</span>
          </CardTitle>
          <CardDescription>
            Know exactly how much money you need — and by when — to pay every card in full.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <EmailPasswordForm />

          {googleEnabled && (
            <form action={googleSignIn}>
              <Button type="submit" variant="outline" className="w-full" data-testid="google-sign-in">
                Continue with Google
              </Button>
            </form>
          )}

          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            or just look around
            <span className="h-px flex-1 bg-border" />
          </div>

          <form action={demoSignIn}>
            <Button type="submit" variant="outline" className="w-full" data-testid="demo-sign-in">
              Explore the demo
            </Button>
          </form>
          <p className="text-xs text-muted-foreground">
            The demo uses a realistic seeded dataset — fictional accounts, no sign-up. Create an account
            to track your own money; connect your banks, cards, and brokerages to get started.
          </p>
          <p
            className="text-[11px] leading-relaxed text-muted-foreground"
            data-testid="session-timeout-notice"
          >
            For your security, Aimplifi signs you out after{' '}
            {SESSION_IDLE_TIMEOUT_MINUTES} minutes without activity, so a closed laptop or a
            shared computer doesn&rsquo;t stay signed in. Using the app keeps you signed in.
          </p>
          <p className="text-[11px] leading-relaxed text-muted-foreground" data-testid="consent-notice">
            By creating an account or continuing, you agree to our{' '}
            <Link href="/privacy" className="underline underline-offset-2 hover:text-foreground">
              Privacy Policy
            </Link>
            .
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
