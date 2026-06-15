/**
 * One-time onboarding nudge: shown on the dashboard until the user has confirmed
 * which account funds their card payments (the single input the cash-needed
 * answer is built on). Gated by needsOnboarding() in the dashboard; dormant for
 * the seeded demo user, who always has a payment account. Rendered BELOW the
 * cash-needed card so it never displaces the above-the-fold answer.
 */
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export function OnboardingNudge() {
  return (
    <Card data-testid="onboarding-nudge" className="border-emerald-500/40">
      <CardContent className="flex flex-col gap-3 pt-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium">Make this yours in 30 seconds</p>
          <p className="text-sm text-muted-foreground">
            Tell Pulse which account pays your cards so the amount above is measured against
            your real balance — and set your money dials to personalize your coaching.
          </p>
        </div>
        <Link
          href="/settings"
          className={buttonVariants({ size: 'sm' })}
          data-testid="onboarding-nudge-cta"
        >
          Set up
        </Link>
      </CardContent>
    </Card>
  );
}
