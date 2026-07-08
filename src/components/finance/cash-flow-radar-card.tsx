/**
 * Cash Flow Radar (DECISIONS #172 — AI plan §1.2, Competitive-Gap Gap 2 §1).
 * Forward warning system for the payment account: the committed-only projection
 * (scheduled flows + loan payments + card dues, future cycles labeled estimated),
 * the first projected dip, the card it follows, and the minimum timed
 * cover-transfer — deposit sources only. The spending-pace band is a separately
 * labeled estimate and never drives the alert (adjudicated conditions 1–3).
 * Every figure is engine output (computeRadar); no model computes anything here.
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCents, type Cents } from '@/lib/money';
import { formatISODate, formatRelativeDays, isoDate } from '@/lib/dates';
import type { RadarResult } from '@/lib/engine/radar/radar';

const fmt = (n: number) => formatCents(n as Cents);

function joinNames(names: string[]): string {
  const unique = [...new Set(names)];
  if (unique.length <= 1) return unique[0] ?? '';
  return `${unique.slice(0, -1).join(', ')} and ${unique[unique.length - 1]}`;
}

export function CashFlowRadarCard({
  radar,
  paymentAccountName,
}: {
  radar: RadarResult;
  paymentAccountName: string;
}) {
  const today = isoDate(radar.today);
  const dip = radar.committed.firstNegativeDate;

  const STATUS = {
    ok: {
      chip: 'Clear',
      chipCls: 'border-emerald-900/50 bg-emerald-950/40 text-emerald-300',
      desc: `Your committed cash flow stays above $0 for the next ${radar.horizonDays} days.`,
    },
    watch: {
      chip: 'Watch',
      chipCls: 'border-border bg-accent text-muted-foreground',
      desc: 'Committed flows stay covered — but a heavy-spending stretch could dip below $0.',
    },
    alert: {
      chip: 'Heads-up',
      chipCls: 'border-amber-900/50 bg-amber-950/40 text-amber-300',
      desc: dip
        ? `${paymentAccountName} is projected to dip below $0 ${formatRelativeDays(today, isoDate(dip))} (${formatISODate(isoDate(dip))}). Here’s the smallest move that keeps the whole ${radar.horizonDays} days covered.`
        : '',
    },
  }[radar.status];

  // "which card causes it": dues on the dip date, else the most recent dues before
  // it (with whatever lands ON the dip date named as the tipping event). A
  // synthesized future cycle keeps its estimated label here too (condition 3).
  const collidingNames = joinNames(
    radar.collidingCards.map((c) => `${c.cardName}${c.isEstimated ? ' (estimated)' : ''}`),
  );
  const collidingDate = radar.collidingCards[0]?.dueDate;
  const collidesOnDip = collidingDate != null && dip != null && collidingDate === dip;
  const tipLabels = joinNames(radar.dipEvents.map((e) => e.label));

  const topSource = radar.coverTransfer?.sources[0] ?? null;
  const burn = radar.burn;

  return (
    <Card data-testid="cash-flow-radar-card">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">Cash flow radar</CardTitle>
          <span
            className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium ${STATUS.chipCls}`}
            data-testid="radar-status"
          >
            {STATUS.chip}
          </span>
        </div>
        <CardDescription>{STATUS.desc}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {radar.status === 'alert' && dip && (
          <>
            {radar.collidingCards.length > 0 && (
              <p data-testid="radar-colliding">
                {collidesOnDip
                  ? `Your ${collidingNames} payment on ${formatISODate(isoDate(dip))} pushes the balance under.`
                  : `It follows your ${collidingNames} payment${radar.collidingCards.length > 1 ? 's' : ''} on ${formatISODate(isoDate(collidingDate!))}${tipLabels ? ` — then ${tipLabels} on ${formatISODate(isoDate(dip))} tips the balance under` : ''}.`}
              </p>
            )}
            {radar.coverTransfer && (
              <div className="rounded-md border border-border bg-accent/40 p-3" data-testid="radar-cover">
                <div className="font-medium">
                  Stay covered for the full {radar.horizonDays} days: move {fmt(radar.coverTransfer.amountCents)} to{' '}
                  {paymentAccountName} by {formatISODate(isoDate(radar.coverTransfer.byDate))}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {topSource
                    ? `e.g. from ${topSource.name} (${fmt(topSource.balanceCents)} available${topSource.sufficient ? '' : ' — not enough on its own'})`
                    : 'No other checking or savings account is available to fund this.'}
                  {' · '}Aimplifi never moves money — this is a proposal, and the move is yours to make.
                </div>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Projected lowest point: {fmt(radar.committed.lowestCents)} on{' '}
              {formatISODate(isoDate(radar.committed.lowestDate))}
              {radar.includesEstimatedDues ? ' (includes estimated future statements)' : ''}. No shame in a
              tight stretch — knowing early is the whole point.
            </p>
          </>
        )}

        {radar.status === 'watch' && burn?.conservative?.firstNegativeDate && (
          <p data-testid="radar-watch-note">
            On a heavy-spending pace (~{fmt(burn.heavyDailyCents)}/day), the balance could go under around{' '}
            {formatISODate(isoDate(burn.conservative.firstNegativeDate))}. Committed bills alone stay covered.
          </p>
        )}

        {/* Spending-pace band — a labeled estimate, never part of the committed alarm. */}
        <p className="text-xs text-muted-foreground" data-testid="radar-burn">
          {!burn || !burn.hasEnoughHistory
            ? 'Still learning your day-to-day spending pace — needs about 4 weeks of history.'
            : burn.heavyDailyCents === 0
              ? `No day-to-day ${paymentAccountName} spending in the last ${burn.sampleDays} days, so the committed line above is the whole picture.`
              : `Day-to-day ${paymentAccountName} spend (last ${burn.sampleDays} days): typically ${fmt(burn.typicalDailyCents)}/day, ${fmt(burn.heavyDailyCents)}/day in a heavy week — a realistic ${radar.horizonDays}-day end lands between ${fmt(burn.conservative!.endingCents)} and ${fmt(burn.expected!.endingCents)}.`}
        </p>

        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Assumptions</summary>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {radar.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </details>
      </CardContent>
    </Card>
  );
}
