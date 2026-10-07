/**
 * UI.1 (DECISIONS #793) — one glyph and tone per Today-feed proposal.
 *
 * Pure so it can be tested without the feed's server actions. The glyph is
 * decorative (the row renders it `aria-hidden`); the kind is already carried by
 * the title and the testid. Tone follows the copy's own register, and the
 * critic's rule that a glyph must never contradict its sentence:
 *   - money that is due, short, or rising in cost is WARNING amber — a price
 *     increase is a cost, so it never gets the green "gains" arrow;
 *   - a check or an opportunity is BRAND;
 *   - a paused deposit depends on the TIER: while the feed is still asking the
 *     reader whether the pause is real it is an action (warning); once confirmed
 *     it is handled (muted) — the same row must not look identical in both.
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
  goal_behind_pace: { Icon: Target, tone: 'brand' },
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
  const tone: GlyphTone = kind === 'income_pause' && tier === 'handled' ? 'muted' : base.tone;
  return { Icon: base.Icon, tone, toneClass: GLYPH_TONE_CLASS[tone] };
}
