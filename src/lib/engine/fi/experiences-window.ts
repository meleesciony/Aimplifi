/**
 * DECISIONS #524 — the C5 time-window-of-life line closes the coach-principles
 * plan's last C5 gap ("buy experiences while you can"). This module is the one
 * author of WHETHER the sentence prints; the sentence itself is
 * `COACH_COPY.experiencesWindow` (a values statement, no figures).
 *
 * The gate is the card's content, not the reader's dials: the life-energy card
 * is the plan's own Perkins/Housel surface (P2.2), and the window framing is
 * true of everyone — a reader who never set a dial sees it too, whenever the
 * card has something to qualify. An empty list is an absence, not a verdict:
 * "No large purchases in the last 90 days" already stands there, and a
 * "savor the moment" line over it would qualify nothing.
 */
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';

export function windowLineFor(itemCount: number): string | null {
  return itemCount > 0 ? COACH_COPY.experiencesWindow() : null;
}
