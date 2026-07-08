/**
 * Shared caption for the guided first-run connect flow (Competitive-Gap Gap 3
 * §3). The numbering follows the app's ACTUAL top-to-bottom reveal on the
 * dashboard, not the plan doc's prose order: connect → get an instant
 * (best-guess) number → confirm the account to lock it in. Deliberately NOT
 * "connect → confirm → number" — the dashboard has always shown the
 * cash-needed card first, above the fold, before any onboarding nudge
 * (dashboard/page.tsx: "never displaces the above-the-fold answer"), and a
 * hostile-critic pass caught that numbering the confirm step "2" and the
 * card above it "3" made a guided sequence read backwards on the one page
 * that shows both at once. Renumbering to match reading order (rather than
 * moving the card, which would fight that earlier deliberate decision) fixes
 * it without touching the payoff-first layout.
 *
 * The three steps live on three DIFFERENT existing surfaces (EmptyDashboard,
 * the dashboard's cash-needed card, OnboardingNudge) — this is just the
 * consistent label tying them into one perceived sequence. No state, no
 * routing: each surface already knows which step it is from data it already
 * has (accountCount, needsOnboarding()).
 */
const STEP_LABELS = [
  'Connect your bank',
  'See your Cash-Needed number',
  'Confirm your payment account',
] as const;

export function StepIndicator({ step }: { step: 1 | 2 | 3 }) {
  return (
    <p
      className="text-xs font-semibold uppercase tracking-wide text-emerald-500"
      data-testid={`onboarding-step-${step}`}
    >
      Step {step} of 3 · {STEP_LABELS[step - 1]}
    </p>
  );
}
