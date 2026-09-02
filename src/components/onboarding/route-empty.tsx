/**
 * Route-specific zero-account empty states (TASKS 1.5 / DECISIONS #199).
 *
 * Coach, goals, and calendar used to render the shared EmptyDashboard welcome
 * (cash-needed framing). These keep the same connect panel + account-count
 * gate, but explain what *this* page will show once accounts exist.
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConnectOnboardingPanel } from '@/components/onboarding/connect-onboarding-panel';
import { StepIndicator } from '@/components/onboarding/step-indicator';
import { INBOX_EMPTY_DESCRIPTION, INBOX_EMPTY_FOOTNOTE, INBOX_EMPTY_TITLE } from '@/lib/copy/inbox-copy';
import { GET_STARTED_DESCRIPTION } from '@/lib/copy/onboarding-empty-copy';

function RouteEmptyShell({
  pageTitle,
  cardTitle,
  description,
  testId,
  footnote,
}: {
  pageTitle: string;
  cardTitle: string;
  description: string;
  testId: string;
  footnote: string;
}) {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{pageTitle}</h1>
      <Card className="border-dashed" data-testid={testId}>
        <CardHeader>
          <StepIndicator step={1} />
          <CardDescription>{GET_STARTED_DESCRIPTION}</CardDescription>
          <CardTitle className="text-xl">{cardTitle}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <ConnectOnboardingPanel footnote={footnote} />
        </CardContent>
      </Card>
    </div>
  );
}

export function EmptyCoach() {
  return (
    <RouteEmptyShell
      pageTitle="FI Coach"
      cardTitle="Your savings rate, FI timeline, and money review live here"
      description="Once accounts and a few weeks of spending are in, Coach shows your savings rate, FI number, opportunities, and a monthly money review — educational framing, not advice."
      testId="coach-empty"
      footnote="Your data is private to your account. After you connect a bank or paste a CSV, Coach fills in from the same spending and balances you already see elsewhere."
    />
  );
}

export function EmptyGoals() {
  return (
    <RouteEmptyShell
      pageTitle="Goals"
      cardTitle="Goals with a clear effect on your FI date"
      description="Connect a bank or paste a CSV first so Goals can show each target against your savings rate and expected return — including debt-freedom planning when you have loans."
      testId="goals-empty"
      footnote="Your data is private to your account. Connect a bank or paste a CSV, then set goals that show their FI-date impact with assumptions stated inline."
    />
  );
}

export function EmptyTriage() {
  return (
    <RouteEmptyShell
      pageTitle="Inbox"
      cardTitle={INBOX_EMPTY_TITLE}
      description={INBOX_EMPTY_DESCRIPTION}
      // NOT "triage-empty" — that testid is the drained-queue "Inbox zero" state
      // inside TriageInbox (phase2-triage.spec.ts asserts it); this is first-run.
      testId="triage-first-run-empty"
      footnote={INBOX_EMPTY_FOOTNOTE}
    />
  );
}

export function EmptyCalendar() {
  return (
    <RouteEmptyShell
      pageTitle="Cash-flow calendar"
      cardTitle="See dues, inflows, and shortfalls on a calendar"
      description="Once a bank is connected or a CSV is pasted, this calendar maps scheduled income, card and loan due dates, and projected cash shortfalls for the month ahead."
      testId="calendar-empty"
      footnote="Your data is private to your account. Connect a bank or paste a CSV, then open Calendar again to see the month’s cash-flow map."
    />
  );
}
