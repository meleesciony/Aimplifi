/**
 * Deadline for LIGHT form mutations (set/clear a budget target, create/delete
 * a goal, save dials): the write commits in milliseconds; if the confirmation
 * stream is severed (the #164/#166 action-application race) there is no value
 * in staring at "Saving…" — reload after 8s and let the re-rendered page show
 * the truth (8s not 3s: withDeadline abandons the AWAIT, not the WRITE — under
 * heavy load a commit can outrun a too-early reload and the page shows
 * pre-commit state; #166 full-suite witness). Triage keeps the longer ACTION_DEADLINE_MS (15s): its actions do
 * real multi-row work and recover by re-syncing data, not reloading.
 */
export const FORM_ACTION_DEADLINE_MS = 8_000;
