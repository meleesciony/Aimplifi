/**
 * AI Trust Center & Audit Ledger (AI plan §3.2, DECISIONS #242).
 *
 * One place to see (1) the narrowed, durably-true headline invariant — dollar
 * figures the AI has authored: 0 — (2) the measured track record (accuracy +
 * Brier calibration, sample size inline), (3) exactly where a model runs and
 * what it may/never do (static table from code), and (4) the audit ledger of
 * every attempted model call, INCLUDING the ones whose reply the guardrail
 * discarded — logging rejections is itself the trust signal.
 *
 * Grounding: every number on this page comes from the pure scoring engine or a
 * COUNT of persisted rows; every ledger line is formatted by deterministic code
 * from closed-set values (engine/ai-audit/describe.ts) — no model is consulted
 * to render this page, ever. The demo account (shared row) records no trail and
 * the page says so honestly.
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AccuracyMetrics } from '@/components/triage/accuracy-card';
import { formatISODate, isoDate } from '@/lib/dates';
import { DEMO_USER_ID } from '@/lib/demo-user';
import {
  AI_TOUCHPOINTS,
  describeAiEntry,
  describeAiTrailSummary,
  describeTouchpointStats,
  summarizeAiTrail,
  tallyTouchpoints,
} from '@/lib/engine/ai-audit/describe';
import { getAiTouchpointCounts, getAiTrail } from '@/server/ai-audit';
import { getCategorizationAccuracy } from '@/server/accuracy';
import { getThresholdTuning } from '@/server/tuning';

export const metadata = { title: 'AI Trust Center' };

export default async function TrustPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  const userId = session.user.id;
  const isDemo = userId === DEMO_USER_ID;

  const [accuracy, tuning, trail, touchpointCounts] = await Promise.all([
    getCategorizationAccuracy(userId),
    getThresholdTuning(userId),
    getAiTrail(userId),
    getAiTouchpointCounts(userId),
  ]);
  const summary = summarizeAiTrail(trail);
  // Per-touchpoint all-time stats keyed by id (tallyTouchpoints returns one entry
  // per touchpoint, incl. zeros, so every row in the static table has a match).
  const statsById = new Map(tallyTouchpoints(touchpointCounts).map((s) => [s.touchpoint, s]));
  // Env PRESENCE only (same posture as the Settings activation checklist): a
  // boolean is derived server-side; no key material approaches the client.
  const aiConfigured = !!(process.env.XAI_API_KEY || process.env.ANTHROPIC_API_KEY);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">AI Trust Center</h1>

      <Card data-testid="trust-headline">
        <CardHeader className="pb-2">
          <CardDescription>The invariant this app is built on</CardDescription>
          <CardTitle className="text-base">Dollar figures the AI has authored: 0</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Every dollar amount, date, and projection in Aimplifi is computed by tested,
            deterministic code from your own data. Where a model runs at all, it picks from a
            closed list the engine already computed — a category from the fixed list, a known
            question type, an ordering of lines the engine wrote. It cannot author a number, and
            anything outside its closed list is discarded before it can reach you.
          </p>
          <p className="text-xs text-muted-foreground" data-testid="trust-confidence-disclosure">
            The one number the AI does originate is its own stated confidence when it suggests a
            category. That confidence is disclosed — it is what decides whether a suggestion
            auto-files or waits for you — and the scorecard below measures how well-calibrated it
            actually is on your data.
          </p>
        </CardContent>
      </Card>

      <Card data-testid="trust-scorecard">
        <CardHeader className="pb-2">
          <CardDescription>Measured on your data, not asserted</CardDescription>
          <CardTitle className="text-base">Track record</CardTitle>
        </CardHeader>
        <CardContent>
          <AccuracyMetrics result={accuracy} tuning={tuning} />
        </CardContent>
      </Card>

      <Card data-testid="trust-touchpoints">
        <CardHeader className="pb-2">
          <CardDescription>Every place a model runs, its hard limits, and how often it has been asked about your data</CardDescription>
          <CardTitle className="text-base">Where AI runs</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3">
            {AI_TOUCHPOINTS.map((t) => (
              <li key={t.id} className="space-y-0.5">
                <p className="text-sm font-medium">{t.title}</p>
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">May:</span> {t.may}
                </p>
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Never:</span> {t.never}
                </p>
                <p
                  className="text-xs text-muted-foreground"
                  data-testid={`trust-touchpoint-count-${t.id}`}
                >
                  <span className="font-medium text-foreground">On your data:</span>{' '}
                  {describeTouchpointStats(statsById.get(t.id)!)}
                </p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card data-testid="trust-ledger">
        <CardHeader className="pb-2">
          <CardDescription>
            Model calls on your data — including the replies the guardrail threw away
          </CardDescription>
          <CardTitle className="text-base">AI activity ledger</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {trail.length > 0 ? (
            <>
              <p className="text-xs text-muted-foreground" data-testid="trust-ledger-summary">
                {describeAiTrailSummary(summary)}
              </p>
              <ul className="space-y-2">
                {trail.map((e, i) => (
                  <li key={i} className="text-xs text-muted-foreground">
                    <span className="tabular-nums text-foreground">
                      {/* 'long' style: an audit trail can span years, so every line carries its year (#242 P2-5) */}
                      {formatISODate(isoDate(e.date), 'long')}
                    </span>{' '}
                    — {describeAiEntry(e)}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-xs text-muted-foreground" data-testid="trust-ledger-empty">
              {isDemo
                ? 'The demo account is shared by every visitor, so it never consults a model and no AI activity trail is recorded for it — every figure in the demo is computed deterministically, on any deployment. Sign in with your own account to see your ledger.'
                : aiConfigured
                  ? 'No AI activity yet. The first time a model is consulted on your data, it will appear here — including the times its reply is discarded.'
                  : 'No AI provider is configured, so no model is ever called — every categorization and answer is fully deterministic. If a key is added later, every AI touch will appear here.'}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Ledger lines are written by the app’s own code from validated values — model-authored
            text is never stored or shown here.{' '}
            <Link href="/settings" className="underline underline-offset-2">
              Back to Settings
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
