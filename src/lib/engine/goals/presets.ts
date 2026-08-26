/**
 * Named starting points for a new savings goal (COACH_PRINCIPLES_PLAN C14
 * / DECISIONS #521).
 *
 * A preset is a NAME, never an amount — the reader types the dollars on
 * the existing `createGoal` path. No 10% of income, no tithe band, no
 * Coast-FI gate (that framing stays on the FI card). Pure: no I/O.
 */

export const GIVING_GOAL_PRESET_ID = 'giving' as const;

export type GoalPresetId = typeof GIVING_GOAL_PRESET_ID;

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

/** The C14 leftover: a Giving envelope. College/education is a later slice. */
export const GIVING_GOAL_PRESET: GoalPreset = {
  id: GIVING_GOAL_PRESET_ID,
  name: 'Giving',
};

export function goalPresetFields(id: string): GoalPresetFields | null {
  if (id === GIVING_GOAL_PRESET_ID) return { name: GIVING_GOAL_PRESET.name };
  return null;
}
