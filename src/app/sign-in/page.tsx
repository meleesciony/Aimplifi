import { redirect } from 'next/navigation';
import { DEMO_USER_ID, auth, signIn } from '@/auth';
import { prisma } from '@/lib/db';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export default async function SignInPage() {
  const session = await auth();
  if (session?.user) redirect('/dashboard');

  async function demoSignIn() {
    'use server';
    // login audit (docs/PRIVACY.md) — never blocks sign-in if the DB is empty
    try {
      await prisma.auditLog.create({
        data: { userId: DEMO_USER_ID, action: 'auth.signin', meta: '{}' },
      });
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
            Know exactly how much money you need — and by when — to pay every
            card in full.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <form action={demoSignIn}>
            <Button type="submit" className="w-full" data-testid="demo-sign-in">
              Explore the demo
            </Button>
          </form>
          <p className="text-xs text-muted-foreground">
            Demo mode uses a realistic seeded dataset — fictional accounts, no
            bank credentials, no sign-up. Live bank connections activate when
            Plaid is configured (see Settings).
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
