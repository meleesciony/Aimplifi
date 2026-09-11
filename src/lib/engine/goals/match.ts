/**
 * Match a user-typed name against stored savings-goal names (DECISIONS #738).
 *
 * Ask's `goal_status` intent extracts a name query from the question; this module
 * decides whether that query uniquely identifies one of the reader's savings
 * goals. It originates no money figure — the matched row is then handed to
 * `goalProgress`, the same engine the /goals card uses.
 *
 * Conservative by construction: exact (normalized) first, then unique whole-word
 * containment. Ambiguous and empty are first-class outcomes — never a guess.
 * No fuzzy / Levenshtein: a close miss is `none`, not the wrong goal. Judged by
 * what it abstains on (docs/lessons/context-carrying-features-must-abstain.md).
 */

export type GoalNameMatch =
  | { kind: 'unique'; name: string }
  | { kind: 'ambiguous'; names: string[] }
  | { kind: 'none' };

/** Lowercase, punctuation → space, collapsed whitespace. Matching key only. */
export function normalizeGoalName(s: string): string {
  return s
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True when `needle`'s tokens appear as a contiguous whole-word span inside
 * `haystack`. Both strings must already be `normalizeGoalName` output.
 * "car" does not match "card"; "japan" does match "japan trip".
 */
function wholeWordContained(haystack: string, needle: string): boolean {
  if (!needle || !haystack) return false;
  if (haystack === needle) return true;
  const hay = haystack.split(' ');
  const need = needle.split(' ');
  if (need.length > hay.length) return false;
  for (let i = 0; i <= hay.length - need.length; i++) {
    if (need.every((w, j) => hay[i + j] === w)) return true;
  }
  return false;
}

/** Leftover tokens after removing one contiguous `span` from `tokens`. */
function tokensOutsideSpan(tokens: readonly string[], span: readonly string[]): string[] | null {
  if (span.length === 0 || span.length > tokens.length) return null;
  for (let i = 0; i <= tokens.length - span.length; i++) {
    if (span.every((w, j) => tokens[i + j] === w)) {
      return [...tokens.slice(0, i), ...tokens.slice(i + span.length)];
    }
  }
  return null;
}

/** Words that may surround a stored name in a status question ("my X fund"). */
const REVERSE_FILLER = new Set(['my', 'the', 'a', 'an', 'goal', 'goals', 'fund', 'funds']);

/**
 * Tokens in `question` that are not the stored `name` span. Timeframe / store
 * abstention must read THIS leftover, not the whole question — otherwise a
 * goal named "June wedding" is identified and then discarded as `unknown`
 * because June is a month (critic #738 cycle 4 P1-1).
 */
export function leftoverAfterGoalName(question: string, name: string): string {
  const qTokens = normalizeGoalName(question).split(' ').filter(Boolean);
  const nTokens = normalizeGoalName(name).split(' ').filter(Boolean);
  const extra = tokensOutsideSpan(qTokens, nTokens);
  return (extra ?? qTokens).join(' ');
}

export function matchGoalName(query: string, names: readonly string[]): GoalNameMatch {
  const q = normalizeGoalName(query);
  if (q.length < 2) return { kind: 'none' };

  const exact = names.filter((n) => normalizeGoalName(n) === q);
  if (exact.length === 1) return { kind: 'unique', name: exact[0]! };
  if (exact.length > 1) return { kind: 'ambiguous', names: exact };

  const contained = names.filter((n) => {
    const nn = normalizeGoalName(n);
    // Query as a span inside the stored name: "japan" → "Japan trip".
    if (wholeWordContained(nn, q)) return true;
    // Reverse: stored name as a span inside a longer query, only when every
    // leftover token is filler (my / goal / fund). Otherwise "car loan payoff"
    // uniquely hits a "Car loan" savings row — wrong-goal money
    // (critic #738 cycle 2 P0-2). One-token stored names never reverse
    // (critic #738 P1-4).
    const nameTokens = nn.split(' ').filter(Boolean);
    if (nameTokens.length < 2) return false;
    const extra = tokensOutsideSpan(q.split(' ').filter(Boolean), nameTokens);
    return extra !== null && extra.every((t) => REVERSE_FILLER.has(t));
  });
  if (contained.length === 1) return { kind: 'unique', name: contained[0]! };
  if (contained.length > 1) return { kind: 'ambiguous', names: contained };
  return { kind: 'none' };
}
