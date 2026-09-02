import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SESSION_IDLE_TIMEOUT_MINUTES, SESSION_REMEMBER_TIMEOUT_DAYS } from '@/auth.config';
import { auth } from '@/auth';
import { DemoSignInButton } from '@/components/auth/demo-sign-in-button';
import { EmailPasswordForm } from '@/components/auth/email-password-form';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SIGN_IN_DEMO_FOOTNOTE } from '@/lib/copy/onboarding-empty-copy';
import { googleSignIn } from '@/server/auth-actions';

export default async function SignInPage() {
  const session = await auth();
  if (session?.user) redirect('/dashboard');

  const googleEnabled = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">
            Aim<span className="text-brand-500">plifi</span>
          </CardTitle>
          <CardDescription>
            Aimplifi makes you deliberately wealthier — a financial coach with a bank feed:
            it shows where your money actually goes, protects the spending you love, and
            keeps your long game on track.
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

          <DemoSignInButton />
          <p className="text-xs text-muted-foreground" data-testid="sign-in-demo-footnote">
            {SIGN_IN_DEMO_FOOTNOTE}
          </p>
          <p
            className="text-[11px] leading-relaxed text-muted-foreground"
            data-testid="session-timeout-notice"
          >
            For your security, Aimplifi signs you out after{' '}
            {SESSION_IDLE_TIMEOUT_MINUTES} minutes without activity, so a closed laptop or a
            shared computer doesn&rsquo;t stay signed in. Using the app keeps you signed in.
            Check &ldquo;Remember me on this device&rdquo; to stay signed in for{' '}
            {SESSION_REMEMBER_TIMEOUT_DAYS} days on this computer — not on a shared or public
            one.
          </p>
          <p id="auth-remember-hint" className="sr-only">
            Stays signed in for {SESSION_REMEMBER_TIMEOUT_DAYS} days on this device. Do not use
            on a shared or public computer.
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
