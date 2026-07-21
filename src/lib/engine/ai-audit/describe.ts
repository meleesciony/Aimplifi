/**
 * AI Trust Center — audit-trail formatter (AI plan §3.2, DECISIONS #242).
 *
 * Pure, deterministic mapping from persisted `ai.*` AuditLog rows to the human
 * lines the Trust Center ledger renders — no React, no DB, no model call. The
 * cardinal rule shapes every line here:
 *   - Only CLOSED-SET values ever reach a rendered line: a category id is shown
 *     via CATEGORY_BY_ID (unknown id → a generic noun, never echoed raw), an
 *     intent kind is shown only because parseIntentKind already pinned it to
 *     LLM_ROUTABLE_KINDS before it was logged, and counts are plain integers.
 *     Model-authored TEXT (e.g. the balance-move template) is never persisted
 *     into these rows, so it can never render here.
 *   - A malformed or unrecognized row degrades to an honest generic line, never
 *     a throw and never a guessed specific.
 *
 * The adjudicated §3.2 headline is deliberately NARROW (the broad "numbers the
 * AI computed: 0" is self-falsifying — the model's own confidence is a number we
 * store and score). The durable invariant this page states is:
 *   "AI-originated dollar figures / financial facts: 0."
 * The model's confidence is disclosed as the one AI-originated signal, and it is
 * exactly what the Brier scorecard measures.
 */
import { LLM_ROUTABLE_KINDS } from '@/lib/engine/assistant/llm';
import { CATEGORY_BY_ID } from '@/lib/engine/categorize/categories';

/** Where a model was consulted. Closed set — parseAiAuditRow rejects others. */
export const AI_TOUCHPOINT_IDS = [
  'categorize',
  'intent',
  'vocab_recheck',
  'review_order',
  'move_draft',
  'extract',
] as const;
export type AiTouchpointId = (typeof AI_TOUCHPOINT_IDS)[number];

/**
 * What happened on ONE attempted provider call (no call ⇒ no row):
 *   - replied     — the model returned something that passed the closed-set
 *                   validator; the app then applied its own rules before using it.
 *   - rejected    — the model replied but the validator threw the reply away
 *                   (the guardrail fired). Logging these is itself the trust
 *                   signal: proof a bad guess was discarded, not shown.
 *   - unavailable — provider error / timeout; the deterministic path stood.
 */
export const AI_OUTCOMES = ['replied', 'rejected', 'unavailable'] as const;
export type AiOutcome = (typeof AI_OUTCOMES)[number];

/**
 * Outcome sink an LLM-touchpoint module calls EXACTLY ONCE per ATTEMPTED
 * provider call (no key ⇒ no call ⇒ never invoked). `meta` must contain only
 * closed-set values already validated by the touchpoint's parser — never raw
 * model text. Implementations must never throw (the caller also guards).
 */
export type AiOutcomeSink = (outcome: AiOutcome, meta: Record<string, unknown>) => Promise<void> | void;

/** One parsed ledger entry (from an `ai.<touchpoint>.<outcome>` AuditLog row). */
export interface AiAuditEntry {
  touchpoint: AiTouchpointId;
  outcome: AiOutcome;
  /** Calendar date (YYYY-MM-DD) the row was written — display grouping only. */
  date: string;
  /** Validated, closed-set details (see describeAiEntry for how each renders). */
  meta: {
    categoryId?: string;
    confidenceBps?: number;
    kind?: string;
    count?: number;
  };
}

const TOUCHPOINT_SET = new Set<string>(AI_TOUCHPOINT_IDS);
const OUTCOME_SET = new Set<string>(AI_OUTCOMES);

/**
 * Static, hardcoded description of each touchpoint for the Trust Center's
 * "where AI runs" table. This table is the page's contract copy — it comes from
 * code, never from a model, per the §3.2 grounding design.
 */
export const AI_TOUCHPOINTS: readonly {
  id: AiTouchpointId;
  title: string;
  may: string;
  never: string;
}[] = [
  {
    id: 'categorize',
    title: 'Transaction categorization',
    may: 'Suggest one category from the app’s fixed list for an unrecognized merchant, with a stated confidence.',
    never: 'Invent a category, set an amount, or bypass the transfer/income sign rules — invalid picks are discarded.',
  },
  {
    id: 'intent',
    title: 'Ask Aimplifi routing',
    may: 'Pick which known question type an unrecognized phrasing means.',
    never: 'Produce an answer or a number — every figure comes from the tested engine for that question type.',
  },
  {
    id: 'vocab_recheck',
    title: 'Learned-phrase re-check',
    may: 'Re-classify a learned phrase weekly; a disagreement retires the learned rule.',
    never: 'Create or edit a rule — it can only cause an existing learned rule to stop serving.',
  },
  {
    id: 'review_order',
    title: 'Monthly review ordering',
    may: 'Reorder the recap lines the engine already wrote (by id).',
    never: 'Write a line, change a number, or remove a line the deterministic recap shows.',
  },
  {
    id: 'move_draft',
    title: 'Balance-move wording',
    may: 'Propose a sentence template with placeholders.',
    never: 'Fill in a figure — the engine substitutes every number and label itself.',
  },
  {
    id: 'extract',
    title: 'Statement text extraction',
    may: 'Point at where each statement field appears in text you pasted, with a stated confidence.',
    never: 'Author a number or date — every value is copied out of your own text by code, checked to exist verbatim, and saved only after you confirm it.',
  },
];

/** Raw shape of an AuditLog row as the read path hands it over. */
export interface RawAuditRow {
  action: string;
  /** JSON-encoded meta exactly as persisted (AuditLog.meta). */
  meta: string;
  /** ISO timestamp (AuditLog.createdAt serialized). */
  createdAt: string;
}

/**
 * The `ai.<touchpoint>.<outcome>` action grammar, both parts closed-set. Shared
 * by the ledger parser (`parseAiAuditRow`) and the per-touchpoint tally
 * (`tallyTouchpoints`) so both read origin the exact same way — a future or
 * corrupt action is rejected identically by both, never guessed by one.
 */
function parseAiAction(action: string): { touchpoint: AiTouchpointId; outcome: AiOutcome } | null {
  const parts = action.split('.');
  if (parts.length !== 3 || parts[0] !== 'ai') return null;
  const [, touchpoint, outcome] = parts;
  if (!TOUCHPOINT_SET.has(touchpoint) || !OUTCOME_SET.has(outcome)) return null;
  return { touchpoint: touchpoint as AiTouchpointId, outcome: outcome as AiOutcome };
}

/**
 * Parse one AuditLog row into a ledger entry. Returns null for anything that is
 * not a well-formed `ai.<touchpoint>.<outcome>` action — including rows from a
 * future version this build doesn't know — so the ledger never renders a row it
 * can't honestly describe.
 */
export function parseAiAuditRow(row: RawAuditRow): AiAuditEntry | null {
  const parsed = parseAiAction(row.action);
  if (!parsed) return null;
  const { touchpoint, outcome } = parsed;

  const date = row.createdAt.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  let raw: unknown = {};
  try {
    raw = JSON.parse(row.meta);
  } catch {
    raw = {}; // malformed meta → generic line, never a throw
  }
  const obj = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const meta: AiAuditEntry['meta'] = {};
  if (typeof obj.categoryId === 'string') meta.categoryId = obj.categoryId;
  if (typeof obj.confidenceBps === 'number' && Number.isFinite(obj.confidenceBps)) {
    meta.confidenceBps = obj.confidenceBps;
  }
  // The renderer enforces the closed set itself rather than trusting the writer's
  // pinning promise (#242 critic P2-4): an unpinned kind — a future writer, a
  // migrated row — is dropped, so arbitrary text can never reach the trust page.
  if (typeof obj.kind === 'string' && (LLM_ROUTABLE_KINDS as readonly string[]).includes(obj.kind)) {
    meta.kind = obj.kind;
  }
  if (typeof obj.count === 'number' && Number.isInteger(obj.count) && obj.count >= 0) {
    meta.count = obj.count;
  }

  return { touchpoint, outcome, date, meta };
}

/** Confidence bps → whole-percent string ("72%"). Clamped to [0, 100]. */
function pct(bps: number): string {
  const clamped = Math.min(Math.max(bps, 0), 10000);
  return `${Math.round(clamped / 100)}%`;
}

/** Category id → display name; unknown/absent → an honest generic noun. */
function categoryNoun(id: string | undefined): string {
  if (id === undefined) return 'a category';
  const cat = CATEGORY_BY_ID.get(id);
  return cat ? cat.name : 'a category';
}

/** Intent kind → a readable noun phrase ("net_worth" → "net worth"). */
function kindNoun(kind: string | undefined): string {
  return kind === undefined ? 'a known question type' : `“${kind.replace(/_/g, ' ')}”`;
}

const REJECTED_TAIL = ' — the guardrail discarded it; nothing was shown or changed.';
// "usable reply" not "in time" (#242 critic P2-3): this tail also covers HTTP
// errors and malformed bodies, not just timeouts — the line must not overclaim.
const UNAVAILABLE_TAIL = ' — the provider didn’t return a usable reply; the deterministic result stood.';

/**
 * One human line per entry. Every specific in the line is a closed-set value
 * (validated before logging) or a plain count; the phrasing never claims the
 * reply was APPLIED — application always went through the app's own rules,
 * which the touchpoint table states.
 */
export function describeAiEntry(e: AiAuditEntry): string {
  switch (e.touchpoint) {
    case 'categorize': {
      if (e.outcome === 'replied') {
        const conf = e.meta.confidenceBps !== undefined ? ` (${pct(e.meta.confidenceBps)} confident)` : '';
        return `The AI suggested ${categoryNoun(e.meta.categoryId)} for a transaction${conf}; the app’s own rules decided whether to apply it.`;
      }
      if (e.outcome === 'rejected') return `The AI’s category suggestion was invalid${REJECTED_TAIL}`;
      return `The AI was asked to suggest a category${UNAVAILABLE_TAIL}`;
    }
    case 'intent': {
      if (e.outcome === 'replied') {
        return `The AI read an unrecognized question as ${kindNoun(e.meta.kind)}; the engine for that question type computed the answer.`;
      }
      if (e.outcome === 'rejected') return `The AI’s reading of a question was not a known question type${REJECTED_TAIL}`;
      return `The AI was asked to read a question${UNAVAILABLE_TAIL}`;
    }
    case 'vocab_recheck': {
      if (e.outcome === 'replied') {
        return `The weekly re-check re-classified a learned phrase as ${kindNoun(e.meta.kind)}; a disagreement retires the learned rule.`;
      }
      if (e.outcome === 'rejected') return `The weekly re-check got no valid classification for a learned phrase${REJECTED_TAIL}`;
      return `The weekly re-check of a learned phrase ran${UNAVAILABLE_TAIL}`;
    }
    case 'review_order': {
      if (e.outcome === 'replied') {
        const n = e.meta.count;
        return `The AI reordered your monthly review${n !== undefined ? ` (${n} line${n === 1 ? '' : 's'})` : ''}; every line and figure was already written by the engine.`;
      }
      if (e.outcome === 'rejected') return `The AI’s review ordering was invalid${REJECTED_TAIL}`;
      return `The AI was asked to order your monthly review${UNAVAILABLE_TAIL}`;
    }
    case 'move_draft': {
      if (e.outcome === 'replied') {
        return 'The AI proposed a wording template for “What changed”; the engine substituted every figure and label itself.';
      }
      if (e.outcome === 'rejected') return `The AI’s wording template was invalid${REJECTED_TAIL}`;
      return `The AI was asked to word a balance change${UNAVAILABLE_TAIL}`;
    }
    case 'extract': {
      if (e.outcome === 'replied') {
        const n = e.meta.count;
        return `The AI pointed at${n !== undefined ? ` ${n}` : ''} field location${n === 1 ? '' : 's'} in statement text you pasted; the app copied each value out of your text itself, for you to review.`;
      }
      if (e.outcome === 'rejected') return `The AI’s statement field locations were invalid${REJECTED_TAIL}`;
      return `The AI was asked to locate fields in pasted statement text${UNAVAILABLE_TAIL}`;
    }
  }
}

/** Ledger roll-up for the Trust Center header chips. */
export interface AiTrailSummary {
  total: number;
  replied: number;
  rejected: number;
  unavailable: number;
}

export function summarizeAiTrail(entries: readonly AiAuditEntry[]): AiTrailSummary {
  const s: AiTrailSummary = { total: entries.length, replied: 0, rejected: 0, unavailable: 0 };
  for (const e of entries) s[e.outcome] += 1;
  return s;
}

/** The ledger's roll-up sentence — pure so the populated state is unit-testable (#242 critic P2-6). */
export function describeAiTrailSummary(s: AiTrailSummary): string {
  return `Last ${s.total} event${s.total === 1 ? '' : 's'}: ${s.replied} answered · ${s.rejected} discarded by the guardrail · ${s.unavailable} provider unavailable.`;
}

/**
 * All-time per-touchpoint activity — the measured track record behind each
 * touchpoint's static may/never contract on the Trust Center. Every field is a
 * COUNT of persisted `ai.*` rows (see server/ai-audit.getAiTouchpointCounts), so
 * this surface authors no number; it is deliberately distinct from the ledger's
 * `AiTrailSummary`, which is a global window over the most recent 50 events.
 */
export interface AiTouchpointStats {
  touchpoint: AiTouchpointId;
  /** replied + rejected + unavailable — every ATTEMPTED call for this touchpoint. */
  total: number;
  replied: number;
  rejected: number;
  unavailable: number;
}

/**
 * A COUNT of persisted AuditLog rows grouped by `action`, as the server's
 * `groupBy` read hands it over. `count` is a plain non-negative integer.
 */
export interface AiActionCount {
  action: string;
  count: number;
}

/**
 * Roll per-action AuditLog counts into one `AiTouchpointStats` per touchpoint, in
 * `AI_TOUCHPOINTS` order, INCLUDING an all-zero entry for every touchpoint never
 * run (so the page always renders the full contract table). Reuses `parseAiAction`
 * — the exact ACTION grammar the ledger uses — so an action that doesn't name a
 * known touchpoint+outcome is ignored, never guessed into a count and never a
 * throw. (The ledger parser additionally requires a well-formed date; a count
 * needs none, so the two surfaces can differ only on that axis, never on which
 * actions they accept.) A negative or fractional count (unrepresentable) is dropped, never
 * summed. Counts are copied verbatim; this function authors no number.
 */
export function tallyTouchpoints(counts: readonly AiActionCount[]): AiTouchpointStats[] {
  const stats = new Map<AiTouchpointId, AiTouchpointStats>(
    AI_TOUCHPOINT_IDS.map((id) => [id, { touchpoint: id, total: 0, replied: 0, rejected: 0, unavailable: 0 }]),
  );
  for (const { action, count } of counts) {
    if (!Number.isInteger(count) || count < 0) continue;
    const parsed = parseAiAction(action);
    if (!parsed) continue;
    const s = stats.get(parsed.touchpoint)!;
    s[parsed.outcome] += count;
    s.total += count;
  }
  return AI_TOUCHPOINTS.map((t) => stats.get(t.id)!);
}

/**
 * The measured one-liner under a touchpoint's may/never contract: how often this
 * surface was ASKED about the user's data, how many replies its guardrail
 * discarded (the trust signal §3.2 exists to show), and — only when it happened —
 * how many attempts got no usable reply at all. "Asked", not "Ran": `total`
 * counts every ATTEMPTED call including the `unavailable` ones where the provider
 * returned nothing and the deterministic path stood, so calling those "runs"
 * would overclaim (and collapse the three-way split the ledger keeps). The
 * no-reply clause is shown only when `unavailable > 0` so the common case stays
 * clean while the arithmetic stays honest (replied = total − rejected − no-reply).
 * All-time counts; a never-asked touchpoint reads honestly. Authors no number —
 * every value is a copied count.
 */
export function describeTouchpointStats(s: AiTouchpointStats): string {
  if (s.total === 0) return 'Not asked about your data yet.';
  const noReply = s.unavailable > 0 ? ` · ${s.unavailable} got no reply` : '';
  return `Asked ${s.total} time${s.total === 1 ? '' : 's'} · ${s.rejected} discarded by the guardrail${noReply}.`;
}
