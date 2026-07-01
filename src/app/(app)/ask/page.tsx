import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { EmptyDashboard } from '@/components/onboarding/empty-dashboard';
import { AskView } from '@/components/finance/ask-view';
import { prisma } from '@/lib/db';

export const metadata = { title: "Ask Aimplifi" };

export default async function AskPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  const userId = session.user.id;
  if ((await prisma.account.count({ where: { userId, OR: [{ currency: null }, { currency: 'USD' }] } })) === 0) return <EmptyDashboard />;
  const assistEnabled = !!(process.env.XAI_API_KEY || process.env.ANTHROPIC_API_KEY);
  return <AskView assistEnabled={assistEnabled} />;
}
