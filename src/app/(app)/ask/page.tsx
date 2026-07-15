import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { EmptyDashboard } from '@/components/onboarding/empty-dashboard';
import { AskView } from '@/components/finance/ask-view';
import { getVisibleGroups } from '@/server/categories';
import { prisma } from '@/lib/db';

export const metadata = { title: "Ask Aimplifi" };

export default async function AskPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  const userId = session.user.id;
  if ((await prisma.account.count({ where: { userId, OR: [{ currency: null }, { currency: 'USD' }] } })) === 0) return <EmptyDashboard />;
  const assistEnabled = !!(process.env.XAI_API_KEY || process.env.ANTHROPIC_API_KEY);
  // Correction-chip picker options (Glass-Box slice 2b): the same visible-groups
  // read every category picker uses (system minus hidden, plus this user's custom).
  const categoryGroups = await getVisibleGroups(userId);
  return (
    <AskView
      assistEnabled={assistEnabled}
      categoryOptions={categoryGroups.flatMap((g) => g.categories)}
    />
  );
}
