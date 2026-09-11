import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { CurrencyExclusionBanner } from '@/components/finance/currency-exclusion-banner';
import {
  PAGE_LEAD_CLASS,
  PAGE_LEAD_WIDE_CLASS,
  PAGE_SECTION_LABEL_CLASS,
  PAGE_STACK_CLASS,
  PAGE_TITLE_CLASS,
} from '@/components/finance/page-chrome';
import { EmptyTriage } from '@/components/onboarding/route-empty';
import { AccuracyCard } from '@/components/triage/accuracy-card';
import { BackfillButton } from '@/components/triage/backfill-button';
import { TriageInbox } from '@/components/triage/triage-inbox';
import { CategoryManager } from '@/components/settings/category-manager';
import { CustomCategoryManager } from '@/components/settings/custom-category-manager';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { businessToday } from '@/lib/business-today';
import { prisma } from '@/lib/db';
import { CUSTOM_CATEGORY_GROUPS } from '@/lib/engine/categorize/assign';
import { getCategorizationAccuracy } from '@/server/accuracy';
import { getTriageGroups } from '@/server/triage';
import { getCategoryCatalog, getVisibleCategories } from '@/server/categories';
import { getCustomCategories } from '@/server/category-meta';
import { getWithheldAccountSummary } from '@/server/transactions';
import { INBOX_PAGE_SUBTITLE } from '@/lib/copy/inbox-copy';
import { isDemoUser } from '@/lib/demo-user';
import { listTxnMoveAccounts } from '@/server/txn-move-accounts';

export const metadata = { title: "Review" };

export default async function TriagePage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  // Zero-account first-run → the branded connect empty every sibling route has
  // (2026-07-21 agent review A3): a bare empty inbox reads as "nothing to do",
  // not "not set up yet". Same USD-or-null gate as cards/coach/goals/calendar.
  if ((await prisma.account.count({ where: { userId: session.user.id, OR: [{ currency: null }, { currency: 'USD' }] } })) === 0) return <EmptyTriage />;
  const userId = session.user.id;
  const [groups, accuracy, categories, withheld, accounts, categoryCatalog, customCategories] = await Promise.all([
    getTriageGroups(userId), // merchant-group void (Phase 3c, DECISIONS #143)
    getCategorizationAccuracy(userId),
    getVisibleCategories(userId),
    getWithheldAccountSummary(userId),
    listTxnMoveAccounts(userId, ''),
    getCategoryCatalog(userId),
    getCustomCategories(userId),
  ]);
  const canEditCategories = !isDemoUser(userId);

  return (
    <div className={PAGE_STACK_CLASS}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className={PAGE_TITLE_CLASS}>Inbox</h1>
          <p className={`${PAGE_LEAD_CLASS} ${PAGE_LEAD_WIDE_CLASS}`} data-testid="inbox-subtitle">
            {INBOX_PAGE_SUBTITLE}
          </p>
        </div>
        <BackfillButton />
      </div>
      {/* currency-guard disclosure (#135 residual): withheld non-USD accounts must not
          vanish silently. Renders nothing for all-USD users (the overwhelming case). */}
      <CurrencyExclusionBanner summary={withheld} />
      <div className="mx-auto max-w-md space-y-4">
        <AccuracyCard result={accuracy} />
        <TriageInbox
          initialGroups={groups}
          categories={categories}
          today={businessToday(userId)}
          canRenamePayee={!isDemoUser(session.user.id)}
          accounts={accounts}
        />
        <Card data-testid="inbox-categories-card">
          <CardHeader className="pb-2">
            <CardDescription>Make the category list your own while filing</CardDescription>
            <CardTitle className="text-base">Categories</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div data-testid="inbox-custom-categories">
              <h3 className={`mb-2 ${PAGE_SECTION_LABEL_CLASS}`}>
                Your categories
              </h3>
              <CustomCategoryManager
                categories={customCategories}
                groups={CUSTOM_CATEGORY_GROUPS}
                canWrite={canEditCategories}
              />
            </div>
            <div>
              <h3 className={`mb-2 ${PAGE_SECTION_LABEL_CLASS}`}>
                Built-in categories
              </h3>
              <CategoryManager
                catalog={categoryCatalog}
                canRename={canEditCategories}
                canRemove={canEditCategories}
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
