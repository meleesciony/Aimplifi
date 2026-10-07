/**
 * UI.1 (DECISIONS #793) — one glyph and tone per Today-feed proposal.
 *
 * Pure so it can be tested without the feed's server actions. The glyph is
 * decorative (the row renders it `aria-hidden`); the kind is already carried by
 * the title and the testid. Tone follows the copy's own register, and the
 * critic's rule that a glyph must never contradict its sentence:
 *   - money that is due, short, or rising in cost is WARNING amber — a price
 *     increase is a cost, so it never gets the green "gains" arrow;
 *   - a goal behind pace is WARNING too — /goals badges the same verdict amber,
 *     and brand and positive are one emerald here (U.2), so green would say
 *     "on track";
 *   - a check or an opportunity is BRAND;
 *   - the HANDLED tier is always MUTED, whatever the kind: "Autopay covers
 *     this — nothing to do" and a confirmed income pause must not wear the
 *     same amber as a critical due (critic cycles 1 and 2). The card promises
 *     "everything autopay handles kept quiet"; the glyph keeps that promise.
 */
import {
  CirclePause,
  CreditCard,
  Handshake,
  Repeat,
  ScanSearch,
  ShieldCheck,
  Target,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import type { ProposalKind, ProposalTier } from '@/lib/engine/nudge/types';

export type GlyphTone = 'warning' | 'brand' | 'muted';

export const GLYPH_TONE_CLASS: Record<GlyphTone, string> = {
  warning: 'bg-warning-500/15 text-warning-400',
  brand: 'bg-brand-500/12 text-brand-400',
  muted: 'bg-muted text-muted-foreground',
};

const KIND_GLYPH: Record<ProposalKind, { Icon: LucideIcon; tone: GlyphTone }> = {
  payment_due: { Icon: CreditCard, tone: 'warning' },
  cash_flow_dip: { Icon: TrendingDown, tone: 'warning' },
  cash_needed_shortfall: { Icon: TriangleAlert, tone: 'warning' },
  unusual_charge: { Icon: ScanSearch, tone: 'brand' },
  income_pause: { Icon: CirclePause, tone: 'warning' },
  goal_behind_pace: { Icon: Target, tone: 'warning' },
  'unused-subscription': { Icon: Repeat, tone: 'brand' },
  'price-increase': { Icon: TrendingUp, tone: 'warning' },
  'insurance-reshop': { Icon: ShieldCheck, tone: 'brand' },
  'negotiable-bill': { Icon: Handshake, tone: 'brand' },
};

export function proposalGlyph(
  kind: ProposalKind,
  tier: ProposalTier,
): { Icon: LucideIcon; tone: GlyphTone; toneClass: string } {
  const base = KIND_GLYPH[kind];
  const tone: GlyphTone = tier === 'handled' ? 'muted' : base.tone;
  return { Icon: base.Icon, tone, toneClass: GLYPH_TONE_CLASS[tone] };
}
