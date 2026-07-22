import { describe, it, expect } from 'vitest';
import { SURFACE_LINK_CARD_CLASS } from '@/components/finance/surface-card-styles';

/**
 * Locks the load-bearing utilities of the shared dashboard link-card surface
 * (#268 follow-up / M.4 consistency). Centralising the five byte-identical card
 * classes into one constant created exactly one new risk that duplication did
 * not have: a single careless edit — most likely during the M.4 beauty pass —
 * silently dropping a required utility from all five cards at once. These assert
 * the utilities that must survive any restyle of the token.
 */
describe('SURFACE_LINK_CARD_CLASS', () => {
  it('keeps the whole card a tappable surface', () => {
    // `block` makes the <a> fill the card; the surface trio is the card look.
    for (const util of ['block', 'rounded-2xl', 'border', 'bg-card']) {
      expect(SURFACE_LINK_CARD_CLASS.split(' ')).toContain(util);
    }
  });

  it('keeps a keyboard-visible focus ring (a11y invariant)', () => {
    // The whole card is the only interactive element, so keyboard users depend
    // on this ring to see focus. A beauty-pass edit must not drop it.
    for (const util of ['focus-visible:ring-2', 'focus-visible:ring-ring/50']) {
      expect(SURFACE_LINK_CARD_CLASS.split(' ')).toContain(util);
    }
  });
});
