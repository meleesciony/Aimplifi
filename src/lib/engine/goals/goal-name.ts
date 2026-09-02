/**
 * Household name for a savings goal already on /goals.
 *
 * Create already requires a name. After that the only write was delete.
 * This overlay is a NAME only — target, saved, monthly contribution,
 * and target date stay put.
 */
export const MAX_GOAL_NAME = 60;

export function goalNameError(raw: string): string | undefined {
  const name = raw.trim();
  if (!name) return 'Give the goal a name — "Emergency fund", "Italy trip".';
  if (name.length > MAX_GOAL_NAME) {
    return `Keep the name under ${MAX_GOAL_NAME} characters.`;
  }
  return undefined;
}
