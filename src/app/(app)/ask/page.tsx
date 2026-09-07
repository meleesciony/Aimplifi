import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { EmptyDashboard } from '@/components/onboarding/empty-dashboard';
import { AskView } from '@/components/finance/ask-view';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LearnedPhrases } from '@/components/settings/learned-phrases';
import { getVisibleGroups } from '@/server/categories';
import { listLearnedPhrases } from '@/server/vocab';
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
  const [categoryGroups, learnedPhrases] = await Promise.all([
    getVisibleGroups(userId),
    listLearnedPhrases(userId),
  ]);
  return (
    <div className="space-y-4">
      <AskView
        assistEnabled={assistEnabled}
        categoryOptions={categoryGroups.flatMap((g) => g.categories)}
      />
      {learnedPhrases.length > 0 ? (
        <Card data-testid="ask-learned-phrases-card">
          <CardHeader className="pb-2">
            <CardDescription>Undo what Ask learned from how you phrase questions</CardDescription>
            <CardTitle className="text-base">Learned phrasings</CardTitle>
          </CardHeader>
          <CardContent>
            <LearnedPhrases phrases={learnedPhrases} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
