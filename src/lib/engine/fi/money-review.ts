/**
 * Monthly Money Review — candidate-insight set + selection (AI plan §2.4).
 *
 * The recap is assembled from a CLOSED set of candidate insights, each carrying a
 * stable id and a `line` that is a verbatim, already-guardrail-scanned COACH_COPY
 * string with engine cents substituted in code. The model NEVER authors a line — the
 * optional LLM path only returns an ORDERED LIST OF CANDIDATE IDS (validated in-set),
 * exactly like the shipped intent router. There is no generated prose to validate.
 *
 * Two selection modes:
 *  - `selectReview(candidates, null)`  — the deterministic floor (zero-key / demo).
 *    Reproduces `generateMoneyReview`'s three role-winners byte-for-byte.
 *  - `selectReview(candidates, orderedIds)` — the LLM path. Filters to valid in-set
 *    ids, dedupes, ALWAYS keeps every `material` candidate (the pin), bounds the count,
 *    and never invents an entry.
 *
 * Pure and deterministic: no React, no DB, no `Date`, no floats. Money is integer cents.
 */

import { formatMonth } from '@/lib/dates';
import { COACH_COPY, type PendingTransfer } from './coach-copy';
import type { Opportunity, CreepResult, MonthlyFlow } from './insights';
import type { SavingsStreakResult } from './savings-streak';

export type ReviewRole = 'improvement' | 'watch' | 'action';

export type ReviewCandidateId =
  | 'improvement-savings-rate'
  | 'improvement-streak'
  | 'improvement-personal-best'
  | 'improvement-runway'
  | 'watch-price-increase'
  | 'watch-creep'
  // O.20g — the window the app could not compare. Distinct from 'watch-clear':
  // that id carries a claim ("no lifestyle drift detected") this state cannot make.
  | 'watch-creep-not-comparable'
  | 'watch-clear'
  | 'action-transfer'
  | 'action-cancel-sub'
  | 'action-automate';

/** The frozen, exhaustive id set — the LLM may only ever return ids from this list. */
export const REVIEW_CANDIDATE_IDS: readonly ReviewCandidateId[] = [
  'improvement-savings-rate',
  'improvement-streak',
  'improvement-personal-best',
  'improvement-runway',
  'watch-price-increase',
  'watch-creep',
  'watch-creep-not-comparable',
  'watch-clear',
  'action-transfer',
  'action-cancel-sub',
  'action-automate',
] as const;

const REVIEW_CANDIDATE_ID_SET: ReadonlySet<string> = new Set(REVIEW_CANDIDATE_IDS);

export interface ReviewCandidate {
  id: ReviewCandidateId;
  role: ReviewRole;
  /** Deterministic importance rank (higher leads). A pure function of engine numbers, never a model value. */
  priority: number;
  /** A material next-action (cash-needed cover-transfer) that must never be dropped from the recap. */
  material: boolean;
  /** Verbatim COACH_COPY line with engine cents already substituted. No model-authored token. */
  line: string;
}

export interface ReviewCandidateInput {
  /** Ascending months. */
  flows: readonly MonthlyFlow[];
  /**
   * Full-history streak + personal-best (audit P2, critic P1): computed over ALL
   * available history by the SAME helper the savings-rate card uses — never
   * re-derived from the chart slice, or a "personal best so far" over the last
   * 12 months is false when an older month beats the recent best, and the recap
   * and the card contradict each other on the same claim.
   */
  streak: SavingsStreakResult;
  creep: CreepResult;
  opportunities: readonly Opportunity[];
  runwayMonths: number;
  pendingTransfer?: PendingTransfer | null;
}

/**
 * Assemble the full applicable candidate set from typed engine outputs. Each `line` is a
 * COACH_COPY string; no number here originates outside the passed-in engine values.
 */
export function buildReviewCandidates(input: ReviewCandidateInput): ReviewCandidate[] {
  const { flows, streak, creep, opportunities, runwayMonths, pendingTransfer } = input;
  const last = flows[flows.length - 1];
  const prev = flows[flows.length - 2];
  const out: ReviewCandidate[] = [];

  // ── improvement role ──────────────────────────────────────────────────────
  const savingsRateUp =
    !!last &&
    !!prev &&
    last.savingsRateBps !== null &&
    prev.savingsRateBps !== null &&
    last.savingsRateBps > prev.savingsRateBps;
  if (savingsRateUp) {
    out.push({
      id: 'improvement-savings-rate',
      role: 'improvement',
      priority: 65,
      material: false,
      line: COACH_COPY.reviewImprovement(
        formatMonth(last.month),
        prev.savingsRateBps as number,
        last.savingsRateBps as number,
      ),
    });
  }
  if (streak.isPersonalBest && last && last.savingsRateBps !== null) {
    out.push({
      id: 'improvement-personal-best',
      role: 'improvement',
      priority: 70,
      material: false,
      line: COACH_COPY.savingsPersonalBest(last.savingsRateBps, formatMonth(last.month)),
    });
  }
  if (streak.streakMonths >= 2 && last && last.savingsRateBps !== null) {
    out.push({
      id: 'improvement-streak',
      role: 'improvement',
      priority: 60,
      material: false,
      line: COACH_COPY.savingsStreak(streak.streakMonths, last.savingsRateBps),
    });
  }
  // Always-available improvement fallback (matches generateMoneyReview's runway fallback).
  out.push({
    id: 'improvement-runway',
    role: 'improvement',
    priority: 40,
    material: false,
    line: COACH_COPY.reviewImprovementRunway(runwayMonths),
  });

  // ── watch role ────────────────────────────────────────────────────────────
  const priceIncrease = opportunities.find((o) => o.kind === 'price-increase');
  if (priceIncrease) {
    out.push({
      id: 'watch-price-increase',
      role: 'watch',
      priority: 80,
      material: false,
      line: COACH_COPY.reviewCreep(priceIncrease.merchant, priceIncrease.monthlyCents),
    });
  }
  if (creep.flagged) {
    out.push({
      id: 'watch-creep',
      role: 'watch',
      priority: 55,
      material: false,
      line: COACH_COPY.reviewCreepSpending(creep),
    });
  }
  // O.20g — a window the app could not compare is NOT an all clear, and it used
  // to fall into the branch below and print one. It sits between the two: above
  // "nothing to watch", below a real flag.
  const creepNotComparable = !creep.incomeMeasured || !creep.spendMeasured;
  if (!priceIncrease && !creep.flagged && creepNotComparable) {
    out.push({
      id: 'watch-creep-not-comparable',
      role: 'watch',
      priority: 40,
      material: false,
      line: COACH_COPY.reviewCreepNotComparable(creep),
    });
  }
  // "All clear" only when there's nothing to watch — exactly when generateMoneyReview shows it.
  if (!priceIncrease && !creep.flagged && !creepNotComparable) {
    out.push({
      id: 'watch-clear',
      role: 'watch',
      priority: 30,
      material: false,
      line: COACH_COPY.creepClear(creep),
    });
  }

  // ── action role ───────────────────────────────────────────────────────────
  const unused = opportunities.find((o) => o.kind === 'unused-subscription');
  if (pendingTransfer) {
    out.push({
      id: 'action-transfer',
      role: 'action',
      priority: 100,
      material: true, // the cash-needed cover-transfer — pinned, never reorderable out of the recap
      line: COACH_COPY.reviewNextAction(
        COACH_COPY.nextActionTransfer(
          pendingTransfer.amountCents,
          pendingTransfer.byDate,
          pendingTransfer.frozenFunding,
        ),
      ),
    });
  }
  if (unused) {
    out.push({
      id: 'action-cancel-sub',
      role: 'action',
      priority: 50,
      material: false,
      line: COACH_COPY.reviewNextAction(COACH_COPY.nextActionCancelSub(unused.merchant, unused.monthlyCents)),
    });
  }
  // Always-available action fallback (matches generateMoneyReview's automate fallback).
  if (!pendingTransfer && !unused) {
    out.push({
      id: 'action-automate',
      role: 'action',
      priority: 20,
      material: false,
      line: COACH_COPY.reviewNextAction(COACH_COPY.nextActionAutomate()),
    });
  }

  return out;
}

function byId(candidates: readonly ReviewCandidate[], id: ReviewCandidateId): ReviewCandidate | undefined {
  return candidates.find((c) => c.id === id);
}

/**
 * The deterministic floor — reproduces `generateMoneyReview`'s three role-winners in
 * [improvement, watch, action] order. The extra pool candidates (streak, personal-best)
 * are intentionally NOT chosen here, so the zero-key recap is unchanged from today.
 */
function selectDeterministic(candidates: readonly ReviewCandidate[]): ReviewCandidate[] {
  const improvement = byId(candidates, 'improvement-savings-rate') ?? byId(candidates, 'improvement-runway');
  const watch =
    byId(candidates, 'watch-price-increase') ??
    byId(candidates, 'watch-creep') ??
    // O.20g — omitting the new id here dropped the watch role ENTIRELY for
    // every reader in the refusal state (`buildReviewCandidates` emits this one
    // and suppresses `watch-clear`, so the chain fell through to `undefined`
    // and was filtered out below). That silently shrank the recap to two lines,
    // broke this module's own byte-for-byte-with-`generateMoneyReview`
    // contract, and — because `selectFromOrder` backfills from here — made the
    // "Personalized" badge fire whenever a model returned a line the floor
    // could not.
    byId(candidates, 'watch-creep-not-comparable') ??
    byId(candidates, 'watch-clear');
  const action =
    byId(candidates, 'action-transfer') ??
    byId(candidates, 'action-cancel-sub') ??
    byId(candidates, 'action-automate');
  return [improvement, watch, action].filter((c): c is ReviewCandidate => c !== undefined);
}

/**
 * The LLM path: the model returned an ordered list of ids. The recap shows ONE line per role
 * (improvement / watch / action) — the model chooses which candidate fills each role and the
 * order of the roles. Guarantees, in order of precedence:
 *  1. the material action can never be dropped or replaced (the cash-needed pin);
 *  2. the result is NEVER poorer than the deterministic floor — every role the floor would
 *     show is backfilled, so a bad or empty model reply can never shrink the recap below the
 *     zero-key baseline (critic P1-2); the model can reorder and swap a role's candidate, but
 *     never delete the recap;
 *  3. one line per role → no duplicate render keys/test ids (critic P2-1).
 */
function selectFromOrder(
  candidates: readonly ReviewCandidate[],
  orderedIds: readonly string[],
  max: number,
): ReviewCandidate[] {
  const present = new Map(candidates.map((c) => [c.id, c] as const));
  const byRole = new Map<ReviewRole, ReviewCandidate>();
  const order: ReviewRole[] = [];
  const take = (c: ReviewCandidate): void => {
    if (!byRole.has(c.role)) {
      byRole.set(c.role, c);
      order.push(c.role);
    }
  };

  // 1. The model's order: the first valid, present id for a role fills that role's slot.
  for (const raw of orderedIds) {
    if (typeof raw !== 'string') continue;
    const c = present.get(raw as ReviewCandidateId);
    if (c) take(c);
  }
  // 2. Material pin: the material action is ALWAYS the line shown for its role — override a
  //    non-material pick and add the role if the model skipped it. Never droppable.
  const material = candidates.filter((c) => c.material).sort((a, b) => b.priority - a.priority)[0];
  if (material) {
    if (!byRole.has(material.role)) order.push(material.role);
    byRole.set(material.role, material);
  }
  // 3. Backfill from the deterministic floor so the recap is never poorer than zero-key.
  for (const f of selectDeterministic(candidates)) take(f);

  // 4. One line per role in display order; cap at `max` without ever dropping the material line.
  const result = order.map((r) => byRole.get(r) as ReviewCandidate);
  while (result.length > max) {
    let idx = -1;
    for (let i = result.length - 1; i >= 0; i -= 1) {
      if (!result[i].material) {
        idx = i;
        break;
      }
    }
    if (idx === -1) break; // only the material line remains — keep it
    result.splice(idx, 1);
  }
  return result;
}

/**
 * Select the recap lines. `orderedIds === null` → the deterministic floor (demo/zero-key).
 * A non-null (even empty) array → the LLM path, which still guarantees the material pin.
 */
export function selectReview(
  candidates: readonly ReviewCandidate[],
  orderedIds: readonly string[] | null,
  opts?: { max?: number },
): ReviewCandidate[] {
  const max = opts?.max ?? 3;
  if (orderedIds === null) return selectDeterministic(candidates);
  return selectFromOrder(candidates, orderedIds, max);
}

/**
 * Build the ordering prompt. The model's ENTIRE job is to return an ordered JSON array of
 * candidate ids — it selects and orders, exactly like the intent router picks a route. It
 * never writes a line (the lines are shown verbatim), never a number, never an id we didn't
 * give it. Whatever it returns is re-validated by `parseReviewOrder` + `selectReview`, so a
 * hostile response can only reorder our own pre-scanned lines and can never drop the pinned
 * action or inject text.
 */
export function buildReviewPrompt(candidates: readonly ReviewCandidate[], max = 3): string {
  const list = candidates.map((c) => `- "${c.id}" (${c.role}): ${c.line}`).join('\n');
  return [
    'You order a monthly money recap. Below are candidate lines, each ALREADY WRITTEN with',
    'its own id and role. You never write, edit, number, or invent a line — you only choose',
    'which ids should lead and in what order.',
    '',
    'Candidates:',
    list,
    '',
    'Rules:',
    `- Pick the ${max} most useful ids for this person and order them by which should lead.`,
    '- Prefer covering different roles (improvement, watch, action) over repeating one role.',
    '- Always include any "action" id — the next step matters most.',
    '- Use ONLY ids from the list above. Do not invent an id. Do not output any other text.',
    '',
    'Respond with ONLY a JSON array of id strings, e.g. ["action-transfer","watch-price-increase","improvement-savings-rate"].',
  ].join('\n');
}

/**
 * Parse a raw LLM response into a validated ordered id list, or null to fall back to the
 * deterministic floor. Mirrors `parseIntentKind`: rejects anything that isn't an array of
 * strings drawn from the closed id set. (Presence-in-`candidates` filtering happens in
 * `selectReview`; this guards the shape and the closed vocabulary.)
 */
export function parseReviewOrder(raw: unknown): ReviewCandidateId[] | null {
  if (!Array.isArray(raw)) return null;
  const ids: ReviewCandidateId[] = [];
  for (const v of raw) {
    if (typeof v === 'string' && REVIEW_CANDIDATE_ID_SET.has(v)) ids.push(v as ReviewCandidateId);
  }
  return ids.length > 0 ? ids : null;
}
