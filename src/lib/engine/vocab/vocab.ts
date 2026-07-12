/**
 * Learned vocabulary — the mining + matching engine (TASKS 2.3, DECISIONS #225).
 *
 * PURE. No I/O, no Date, no randomness: ledger rows + existing entries in, decided
 * next state out. The weekly cron (server/vocab.ts) does the reading and writing.
 *
 * ── What a learned entry may do ───────────────────────────────────────────────
 * An entry maps ONE normalized phrase to ONE intent KIND — and nothing else. At
 * answer time the server hands that kind to `intentFromKind`, which re-derives every
 * parameter (timeframe, category, merchant, amount, age) from the ASKER'S OWN WORDS,
 * then re-validates through `validateIntent`. That is byte-for-byte the contract the
 * LLM classifier already lives under (DECISIONS #75). So this engine is exactly as
 * powerful as the model route it replaces, minus the model call: a wrong entry can
 * route to a wrong KIND, and can never inject a figure, a window, or a category.
 *
 * ── The phrase key ────────────────────────────────────────────────────────────
 * The key is the PII-scrubbed question (scrub → lowercase → depunctuate). The scrub
 * (assistant/scrub.ts) already masks digits and amounts, so one key spans "can i
 * retire at 60" and "can i retire at 67" — the spans `intentFromKind` re-derives.
 *
 * The masked span is a real WIDENING, and the critic (#226) was right to push on it:
 * "can i pay off my car by 2027" (a date) and "…by 65" (an age) collapse to ONE key.
 * The key alone therefore does NOT guarantee "same question". Two guards close that:
 *   (a) the serve path requires the learned kind to ROUND-TRIP — `intentFromKind` must
 *       still produce that same kind from the words actually typed, so a rule learned
 *       from the date form cannot answer the age form with a different intent
 *       (server/assistant.ts); and
 *   (b) non-ASCII text is never keyed at all (normalizePhrase returns ''), because
 *       normalization would otherwise DELETE it and let two questions naming different
 *       people or stores collapse into one rule.
 * What survives is bounded and honest: a key can only match a question that differs
 * from the mined one in spans the answer path re-derives from the user's own words.
 *
 * ── The ladder (audit §4.2 loop 2) ────────────────────────────────────────────
 *   shadow  — minted from ≥3 agreeing independent resolutions. NOT served. Accrues
 *             held-out evidence (asks that arrive AFTER the mint, still routed by
 *             the LLM, which the entry never influenced).
 *   flagged — ≥2 held-out agreements, zero disagreements. Served, with the same
 *             "I interpreted your question" disclosure the LLM route carries.
 *   active  — served ≥2 times at the flagged band with no rejection. Served,
 *             disclosed as learned, still one click from being forgotten.
 *   retired — TERMINAL. Set by a user rejection, by ONE held-out disagreement, by the
 *             weekly independent re-check (server/vocab.ts), or by the phrase turning
 *             out to be context-dependent. A tombstone: the miner can never re-mint a
 *             retired phrase on the same evidence (no ratchet).
 *
 * ── Why the loop cannot confirm itself ────────────────────────────────────────
 * Rows this engine's own entries resolved are tagged `vocab:<kind>` in the ledger and
 * are NEVER evidence — they are only the `served` count. Evidence comes solely from
 * rows an INDEPENDENT resolver produced (a bare-kind row = an LLM rescue). Without
 * that exclusion a flagged entry would agree with itself forever.
 *
 * That exclusion creates a blind spot the critic (#226) called correctly: once an
 * entry SERVES, it short-circuits the LLM, so no independent row about that phrase is
 * ever written again — held-out evidence freezes, and flagged→active would promote on
 * nothing but the rule's own serves. The fix does not live in this file: the weekly
 * cron replays every SERVED phrase against the classifier that never sees the rule
 * (`auditServableEntries`), and a disagreement retires it. Monitoring therefore
 * survives serving, which is what the audit's constitution (e) actually asks for.
 *
 * ── Why context-dependent phrasings are excluded ──────────────────────────────
 * A `frame:<kind>` row (TASKS 2.1) means the phrase only had meaning against the
 * previous turn ("what about last month?"). A context-FREE rule for it would be a
 * bug. Any such row makes the phrase permanently ineligible, and RETIRES an entry
 * that already exists for it.
 */
import { scrubQuestionText } from '@/lib/engine/assistant/scrub';
import { LLM_ROUTABLE_KINDS } from '@/lib/engine/assistant/llm';

export type VocabStatus = 'shadow' | 'flagged' | 'active' | 'retired';

/** Statuses the Ask path is allowed to serve. */
export const SERVABLE_STATUSES = ['flagged', 'active'] as const;
export type ServableStatus = (typeof SERVABLE_STATUSES)[number];

/** Independent agreeing resolutions required before a phrase is minted at `shadow`. */
export const MIN_SUPPORT = 3;
/** Agreeing resolutions that arrive AFTER the mint (held-out) before serving it. */
export const MIN_HELD_OUT = 2;
/** Flagged-band serves with no rejection before an entry becomes `active`. */
export const MIN_SERVED = 2;
/** A key shorter/longer than this, or with fewer tokens, is not a mineable question. */
export const MIN_PHRASE_LEN = 8;
export const MAX_PHRASE_LEN = 200;
export const MIN_PHRASE_TOKENS = 3;
/** Live (non-retired) entries one user may hold. A ceiling on the routing table the
 *  Ask path loads, and on what a pathological ledger can grow (#226 P2). */
export const MAX_ENTRIES_PER_USER = 200;

/** One UnknownQuestion ledger row, as the miner sees it. */
export interface VocabLedgerRow {
  /** The stored, already-PII-scrubbed question text. */
  scrubbedText: string;
  /** 'unknown' | '<kind>' | 'frame:<kind>' | 'vocab:<kind>' | null. */
  resolvedIntent: string | null;
  /** Event-ordering key (epoch ms). NOT a business date — it orders asks against a
   *  mint, and never enters a money calculation. */
  at: number;
}

/** An existing VocabEntry, as the miner sees it. */
export interface VocabEntryState {
  id: string;
  phrase: string;
  kind: string;
  status: VocabStatus;
  /** Mint time (epoch ms). Display + tie-breaking only — NOT the evidence boundary. */
  createdAt: number;
  /**
   * The `at` of the NEWEST row that supported the mint. Held-out evidence is every row
   * strictly newer than this. Derived from the DATA, not from a clock: a wall-clock
   * boundary (the mint time) would let a row written by a fast-clocked instance land
   * "after" the mint and be recounted as held-out evidence for a rule it actually
   * helped create (#226 P2) — the one gate that makes the loop trustworthy, defeated by
   * clock skew. Ties go to support, which is the conservative direction.
   */
  evidenceThrough: number;
}

export interface VocabEvidence {
  supportCount: number;
  heldOutHits: number;
  heldOutMisses: number;
  servedCount: number;
}

/** The miner's decided next state for one phrase. The server applies it verbatim. */
export interface VocabDecision {
  op: 'mint' | 'update';
  /** Present on `update`. */
  id?: string;
  phrase: string;
  kind: string;
  status: VocabStatus;
  /** True when this run MOVES the entry to a new status (the server stamps
   *  promotedAt / retiredAt only then). */
  changed: boolean;
  evidence: VocabEvidence;
  /** Present on `mint`: the newest supporting row's `at`, stored as the entry's
   *  held-out boundary (see VocabEntryState.evidenceThrough). */
  evidenceThrough?: number;
}

/** An entry the Ask path may serve. */
export interface ServableVocabEntry {
  id: string;
  phrase: string;
  kind: string;
  status: ServableStatus;
}

export interface VocabMatch {
  entryId: string;
  phrase: string;
  kind: string;
  status: ServableStatus;
}

const ROUTABLE = new Set<string>(LLM_ROUTABLE_KINDS as readonly string[]);

/**
 * Canonical phrase key. Runs the SAME PII scrub the ledger stores (idempotent —
 * scrubbing an already-scrubbed string is a no-op), then lowercases and strips
 * punctuation. Accepts a raw question (the Ask path) or a scrubbed one (the miner),
 * so both land in the same key space by construction rather than by convention.
 * Returns '' when the text is not a mineable question.
 */
export function normalizePhrase(text: string): string {
  const scrubbed = scrubQuestionText(text ?? '');
  if (!scrubbed) return '';
  // Non-ASCII content is NOT keyable. Normalization strips everything outside
  // [a-z0-9[]], so "how much do I owe 田中 for rent" and "…owe 房东 for rent" would
  // otherwise collapse into ONE rule naming different people — an undocumented
  // wildcard in the middle of the key (#226 P2). Refuse the key instead: such a
  // question keeps its existing LLM / `unknown` route, which is exactly what it had.
  // (Smart quotes first: a curly apostrophe is non-ASCII but carries no meaning we
  // would be dropping — "what’s" and "whats" are the same question.)
  const deQuoted = scrubbed.replace(/[’‘'`]/g, '');
  if (/[^\x20-\x7E]/.test(deQuoted)) return '';
  const key = deQuoted
    .toLowerCase()
    .replace(/[^a-z0-9[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (key.length < MIN_PHRASE_LEN || key.length > MAX_PHRASE_LEN) return '';
  if (key.split(' ').length < MIN_PHRASE_TOKENS) return '';
  if (!/[a-z]/.test(key.replace(/\[(num|amount|email)\]/g, ''))) return '';
  return key;
}

/** How one ledger row bears on a phrase. */
type RowSignal =
  | { sort: 'evidence'; kind: string; at: number }
  | { sort: 'served' }
  | { sort: 'context' } // frame-resolved: the phrase is context-DEPENDENT
  | { sort: 'none' };

function signalOf(row: VocabLedgerRow): RowSignal {
  const r = row.resolvedIntent;
  if (!r || r === 'unknown') return { sort: 'none' };
  // Our own answers are never our own evidence (self-confirmation guard).
  if (r.startsWith('vocab:')) return { sort: 'served' };
  // A follow-up fragment resolved against the previous turn — meaningless alone.
  if (r.startsWith('frame:')) return { sort: 'context' };
  // A bare kind on a parser-`unknown` row = an independent (LLM) rescue.
  return ROUTABLE.has(r) ? { sort: 'evidence', kind: r, at: row.at } : { sort: 'none' };
}

/**
 * Decide the next state of every learned phrase for ONE user, from scratch.
 *
 * Recomputed, never incremented: every COUNT below is derived from the ledger on each
 * run, so evidence cannot ratchet — a miss recomputes a promotion away, and evidence
 * that disappears recomputes the counts down.
 *
 * `status`, honestly, IS durable (the critic was right to name it, #226): an entry
 * that was promoted stays promoted even if its supporting rows later age out of the
 * miner's window, and it will then show zero counts. That is deliberate — a rule that
 * passed its gates should not be un-learned merely because the ledger scrolled — but
 * it means status is not re-derivable from the window alone. What keeps it honest is
 * that every DOWNWARD path stays open forever: a user rejection, a held-out
 * disagreement, a context-dependent row, and the weekly independent re-check can each
 * retire a serving entry at any time, on no evidence budget at all.
 *
 * Returns only phrases with something to write; unchanged entries whose counts also
 * match are omitted (the server writes nothing for them).
 */
export function mineVocab(
  rows: readonly VocabLedgerRow[],
  entries: readonly VocabEntryState[],
  stored: ReadonlyMap<string, VocabEvidence> = new Map(),
): VocabDecision[] {
  const byPhrase = new Map<string, VocabLedgerRow[]>();
  for (const row of rows) {
    const phrase = normalizePhrase(row.scrubbedText);
    if (!phrase) continue;
    const list = byPhrase.get(phrase);
    if (list) list.push(row);
    else byPhrase.set(phrase, [row]);
  }

  const entryByPhrase = new Map(entries.map((e) => [e.phrase, e]));
  const decisions: VocabDecision[] = [];
  // Mints are collected separately: they compete for the per-user ceiling below.
  const mints: VocabDecision[] = [];

  // Every phrase that has EITHER ledger rows or an entry (an entry with no rows left
  // still gets its counts recomputed — to zero).
  const phrases = new Set<string>([...byPhrase.keys(), ...entryByPhrase.keys()]);

  for (const phrase of phrases) {
    const entry = entryByPhrase.get(phrase);
    // Terminal. A rejected or disproven phrase never comes back, on any evidence.
    if (entry?.status === 'retired') continue;

    const signals = (byPhrase.get(phrase) ?? []).map(signalOf);
    const contextDependent = signals.some((s) => s.sort === 'context');
    const servedCount = signals.filter((s) => s.sort === 'served').length;
    const evidence = signals.filter((s): s is Extract<RowSignal, { sort: 'evidence' }> => s.sort === 'evidence');

    if (!entry) {
      // ── Mint ────────────────────────────────────────────────────────────────
      if (contextDependent) continue; // never a context-free rule
      if (evidence.length < MIN_SUPPORT) continue;
      const kind = evidence[0].kind;
      // Unanimous or nothing: a phrase two resolvers read differently is not a rule.
      if (evidence.some((e) => e.kind !== kind)) continue;
      mints.push({
        op: 'mint',
        phrase,
        kind,
        status: 'shadow',
        changed: true,
        evidence: { supportCount: evidence.length, heldOutHits: 0, heldOutMisses: 0, servedCount },
        // The held-out line is drawn at the newest row that MADE this rule — not at
        // the clock instant the miner happened to run.
        evidenceThrough: Math.max(...evidence.map((e) => e.at)),
      });
      continue;
    }

    // ── Update an existing entry ──────────────────────────────────────────────
    const support = evidence.filter((e) => e.at <= entry.evidenceThrough).length;
    const heldOut = evidence.filter((e) => e.at > entry.evidenceThrough);
    const heldOutHits = heldOut.filter((e) => e.kind === entry.kind).length;
    const heldOutMisses = heldOut.length - heldOutHits;
    const next: VocabEvidence = { supportCount: support, heldOutHits, heldOutMisses, servedCount };

    // Fail-safe demotions first. A disagreement, or a phrase that turns out to be
    // context-dependent, retires the entry — the question falls back to the LLM /
    // honest `unknown`, which costs the user nothing. Serving a wrong kind costs
    // them a true figure under a false question; the asymmetry sets the bias.
    if (heldOutMisses > 0 || contextDependent) {
      decisions.push({ op: 'update', id: entry.id, phrase, kind: entry.kind, status: 'retired', changed: true, evidence: next });
      continue;
    }

    let status: VocabStatus = entry.status;
    if (entry.status === 'shadow' && heldOutHits >= MIN_HELD_OUT) status = 'flagged';
    else if (entry.status === 'flagged' && servedCount >= MIN_SERVED) status = 'active';

    const changed = status !== entry.status;
    const prior = stored.get(entry.id);
    const countsMoved =
      !prior ||
      prior.supportCount !== next.supportCount ||
      prior.heldOutHits !== next.heldOutHits ||
      prior.heldOutMisses !== next.heldOutMisses ||
      prior.servedCount !== next.servedCount;
    if (!changed && !countsMoved) continue;

    decisions.push({ op: 'update', id: entry.id, phrase, kind: entry.kind, status, changed, evidence: next });
  }

  // Ceiling on the live routing table (#226 P2): a pathological ledger — thousands of
  // distinct phrasings, each asked three times — would otherwise grow an unbounded
  // per-user rule set that every parser-unknown ask then loads. Best-supported first,
  // phrase as the tiebreak so the choice is deterministic and not insertion-ordered.
  const live = entries.filter((e) => e.status !== 'retired').length;
  const room = Math.max(0, MAX_ENTRIES_PER_USER - live);
  mints.sort((a, b) => b.evidence.supportCount - a.evidence.supportCount || a.phrase.localeCompare(b.phrase));

  return [...decisions, ...mints.slice(0, room)];
}

/**
 * Look up a question in the user's servable vocabulary. Returns the KIND only — the
 * caller re-derives every parameter from the question itself. Null when nothing
 * matches, which leaves the existing LLM / `unknown` path exactly as it was.
 */
export function matchVocab(question: string, entries: readonly ServableVocabEntry[]): VocabMatch | null {
  if (entries.length === 0) return null;
  const key = normalizePhrase(question);
  if (!key) return null;
  const hit = entries.find((e) => e.phrase === key && ROUTABLE.has(e.kind));
  return hit ? { entryId: hit.id, phrase: hit.phrase, kind: hit.kind, status: hit.status } : null;
}
