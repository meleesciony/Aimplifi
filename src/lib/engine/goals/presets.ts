/**
 * Named starting points for a new savings goal (COACH_PRINCIPLES_PLAN C14
 * / DECISIONS #521, #522).
 *
 * A preset is a NAME, never an amount — the reader types the dollars on
 * the existing `createGoal` path. No 10% of income, no tithe band, no
 * Coast-FI gate (that framing stays on the FI card), no 529 or other
 * account/tax recommendation, and no ordering against retirement. Pure:
 * no I/O.
 *
 * Pinned to docs/EDGE_CASES.md §Giving goal preset + §Education goal preset.
 */

import { CATEGORY_BY_ID } from '@/lib/engine/categorize/categories';

export const GIVING_GOAL_PRESET_ID = 'giving' as const;
export const EDUCATION_GOAL_PRESET_ID = 'education' as const;

/** Registry order is display order on /goals. */
export const GOAL_PRESET_IDS = [GIVING_GOAL_PRESET_ID, EDUCATION_GOAL_PRESET_ID] as const;

export type GoalPresetId = (typeof GOAL_PRESET_IDS)[number];

/**
 * Taxonomy leaves the education envelope eventually pays, plus the loan
 * leaf it must NOT be confused with. Read from the taxonomy so the hint
 * and the categories cannot drift apart (same rule as GIVING_CATEGORY_LABELS).
 */
export const EDUCATION_CATEGORY_LABELS = {
  education: CATEGORY_BY_ID.get('education')?.name ?? 'Education',
  tuition: CATEGORY_BY_ID.get('tuition')?.name ?? 'Tuition',
  /** A debt the planner already owns — named to be excluded, never filled. */
  studentLoan: CATEGORY_BY_ID.get('student-loan')?.name ?? 'Student Loan',
} as const;

/**
 * Fields a preset may fill. `name` is required; target and monthly are
 * structurally absent so a caller cannot "forget" they were invented.
 */
export interface GoalPresetFields {
  name: string;
}

export interface GoalPreset {
  id: GoalPresetId;
  name: string;
}

/** The C14 leftover after #520: a Giving envelope. */
export const GIVING_GOAL_PRESET: GoalPreset = {
  id: GIVING_GOAL_PRESET_ID,
  name: 'Giving',
};

/** The last C14 leftover (#522). Name = the taxonomy's own label. */
export const EDUCATION_GOAL_PRESET: GoalPreset = {
  id: EDUCATION_GOAL_PRESET_ID,
  name: EDUCATION_CATEGORY_LABELS.education,
};

export const GOAL_PRESETS: readonly GoalPreset[] = [GIVING_GOAL_PRESET, EDUCATION_GOAL_PRESET];

const PRESET_BY_ID: ReadonlyMap<string, GoalPreset> = new Map(GOAL_PRESETS.map((p) => [p.id, p]));

export function goalPresetFields(id: string): GoalPresetFields | null {
  const preset = PRESET_BY_ID.get(id);
  return preset ? { name: preset.name } : null;
}
