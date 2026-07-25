/**
 * Money Signature card (#252, AI plan §Later #11 reworked): habit lines +
 * a "this month" weather line. Server component — pure display of the
 * engine's facts; every string comes from COACH_COPY so the guardrail and
 * identity-lexicon scans cover it. Habit framing, never identity: labels
 * render as pattern descriptions with their facts inline, and the basis
 * line discloses the 3-month persistence rule.
 */
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import {
  SAVING_MIN_ELIGIBLE_MONTHS,
  STEADINESS_WINDOW_MONTHS,
  type MoneySignature,
} from '@/lib/engine/fi/signature';
import { formatMonth } from '@/lib/dates';

function savingLine(s: MoneySignature['savingHabit']): string {
  // latestContrary (#252 critic P1-1): the latest month's banded signal is the
  // OPPOSITE of the hysteresis-lagged label — the unqualified label copy would
  // assert a falsehood against its own inline facts, so render the lag-honest
  // variant instead.
  if (s.label === 'steady' && s.sinceMonth !== null) {
    return s.latestContrary
      ? COACH_COPY.signatureSavingShiftingFromSteady(s.savedMonths, s.eligibleMonths, formatMonth(s.sinceMonth))
      : COACH_COPY.signatureSavingSteady(s.savedMonths, s.eligibleMonths, formatMonth(s.sinceMonth));
  }
  if (s.label === 'variable') {
    return s.latestContrary
      ? COACH_COPY.signatureSavingShiftingFromVariable(s.savedMonths, s.eligibleMonths)
      : COACH_COPY.signatureSavingVariable(s.savedMonths, s.eligibleMonths);
  }
  if (s.shareBps !== null) return COACH_COPY.signatureSavingMixed(s.savedMonths, s.eligibleMonths);
  return COACH_COPY.signatureSavingForming(s.eligibleMonths, SAVING_MIN_ELIGIBLE_MONTHS);
}

function steadinessLine(s: MoneySignature['spendingSteadiness']): string {
  if (s.spreadBps === null) {
    // #252 critic P2-1: with a full window on record a null spread means "no
    // readable spending in the recent window", not "not enough history".
    return s.hasFullWindow
      ? COACH_COPY.signatureSteadinessUnreadable(STEADINESS_WINDOW_MONTHS)
      : COACH_COPY.signatureSteadinessForming(STEADINESS_WINDOW_MONTHS);
  }
  if (s.label === 'steady') {
    return s.latestContrary
      ? COACH_COPY.signatureSteadinessShiftingFromSteady(s.spreadBps)
      : COACH_COPY.signatureSteadinessSteady(s.spreadBps);
  }
  if (s.label === 'variable') {
    return s.latestContrary
      ? COACH_COPY.signatureSteadinessShiftingFromVariable(s.spreadBps)
      : COACH_COPY.signatureSteadinessVariable(s.spreadBps);
  }
  return COACH_COPY.signatureSteadinessMixed(s.spreadBps);
}

export function MoneySignatureCard({
  signature,
  frozenCashNote,
}: {
  signature: MoneySignature;
  /**
   * TASKS L.18, critic P2-1. The weather line prints the SAME runway the /coach runway card prints
   * — cash ÷ six-month average expenses — and the state word itself ("calm" vs "strained") is
   * computed from it, so a savings account frozen HIGH manufactures a reassurance verdict. The
   * runway card was qualified and this one, reading the identical number, was not.
   *
   * REQUIRED, not optional: this is the surface where the omission is hardest to notice, because
   * what is wrong is a mood rather than a figure.
   */
  frozenCashNote: string | null;
}) {
  const { weather } = signature;
  return (
    <Card data-testid="money-signature-card">
      <CardHeader className="pb-2">
        <CardDescription>Patterns, not verdicts</CardDescription>
        <CardTitle className="text-base">{COACH_COPY.signatureTitle()}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p data-testid="signature-weather">
          {COACH_COPY.signatureWeather(
            weather.state,
            weather.runwayMonths,
            weather.latestRateBps,
            weather.latestMonth === null ? null : formatMonth(weather.latestMonth),
          )}
        </p>
        {frozenCashNote ? (
          <p className="text-xs text-amber-500" data-testid="signature-frozen-note">
            {frozenCashNote}
          </p>
        ) : null}
        <p data-testid="signature-saving">{savingLine(signature.savingHabit)}</p>
        <p data-testid="signature-steadiness">{steadinessLine(signature.spendingSteadiness)}</p>
        <p className="text-xs text-muted-foreground">{COACH_COPY.signatureBasis()}</p>
      </CardContent>
    </Card>
  );
}
