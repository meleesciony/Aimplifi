/**
 * Balance-Move Explainer (AI plan §2.3, DECISIONS #240).
 *
 * "When my spending changed, tell me *what* changed in plain English using my
 * actual numbers." The cardinal rule of this codebase is that the LLM never
 * originates a fact — and for a PROSE surface, validating free-form model text
 * for money-truth is unwinnable (a fresh-context critic defeated a free-prose
 * validator, then defeated a placeholder validator that let the model reorder
 * {label} away from its {figure} — in English, adjacency is the binding).
 *
 * So the model gets ATOMIC placeholders: {primary} already reads "Dining, up
 * $240.00 (+40%)" — the label and its own direction-bound figure fused into one
 * substitution unit. The model only picks neutral connective words and may place
 * {second} after {primary}, then {window}. Consequences:
 *   - A figure cannot be fabricated, swapped between categories, or flipped: the
 *     model never sees or types a number, and a label is inseparable from its own
 *     figure.
 *   - A store/brand/category/advice/shame/magnitude/ranking/RELATIONAL word is not
 *     an allowed connective (connectives are purely additive), so the template
 *     grammar rejects it; the substituted sentence is re-scanned (non-ASCII, banned
 *     lexicon, stray numbers, proper nouns) as defense in depth.
 *   - Any doubt → the deterministic template. Because category LABELS are user
 *     free text, that fallback is ALSO scanned; if a hostile label would render a
 *     banned word or a money-lookalike, the surface shows nothing (the movers
 *     list still carries the figures). Descriptive, not advisory.
 *
 * No I/O, no Date, no float money. The tests are the spec (EDGE_CASES §Balance-Move).
 */
import { cents, formatCents } from '@/lib/money';
import type { CategoryMover, SpendingTrends } from './trends';

// ── Tunable, deterministic ──────────────────────────────────────────────────
export const MAX_EXPLAINER_FACTORS = 3;
export const MAX_NARRATIVE_LEN = 240;

// ── Types ───────────────────────────────────────────────────────────────────
export interface MoveFactor {
  /** The category id — the ONLY id an LLM may name as the primary driver. */
  id: string;
  /** Category display name (user free text for custom categories). */
  label: string;
  direction: 'up' | 'down' | 'new';
  /** Signed cents (current − baseline); for 'new' this equals the month's spend. */
  deltaCents: number;
  formattedAbs: string; // "$240.00"
  formattedSigned: string; // "+$240.00" / "-$60.00"
  formattedPct: string | null; // "+40%" / "-20%" / null
  /** Direction-bound phrase: "up $240.00" / "down $60.00" / "new at $500.00". */
  deltaPhrase: string;
  /** The ATOMIC substitution unit: "Dining, up $240.00 (+40%)". Label fused to its
   *  own figure so the model can never rebind a figure to another category. */
  phrase: string;
}

export interface BalanceMoveExplanation {
  triggered: boolean;
  comparedYm: string | null;
  comparisonWindowText: string; // "your 3-month average" — window stated inline
  primaryDriverId: string | null; // always factors[0].id
  factors: MoveFactor[];
  deterministicSentence: string;
  allowedNumberStrings: string[];
  allowedLabelTokens: string[];
}

export interface NarrativeCheck {
  ok: boolean;
  reason?: string;
}

// ── Closed template grammar ─────────────────────────────────────────────────
/** Atomic placeholders only. Each fuses a label to its own figure. */
export const ALLOWED_TEMPLATE_PLACEHOLDERS: ReadonlySet<string> = new Set(['primary', 'second', 'window']);

/**
 * The ONLY non-placeholder words a template may contain. Deliberately NEUTRAL and
 * purely ADDITIVE: no directional verbs (the atom owns direction), no magnitude, no
 * advice, no causal words, no RANKING words ("biggest"/"new"), and — critically —
 * no RELATIONAL / FLOW words ("from"/"to"/"shifted"/"moved"/"compared"/"vs"/"over").
 * A connective must never assert a fact or a flow between categories: "shifted from
 * X to Y" is a (false) claim the engine never computed. The comparison-window intro
 * ("compared with …") is baked into the {window} atom instead, so no comparison
 * connective is needed. Anything outside this set → the deterministic template stands.
 */
export const ALLOWED_CONNECTIVES: ReadonlySet<string> = new Set([
  'the', 'a', 'an', 'and', 'with', 'also', 'alongside', 'plus', 'both', 'your', 'this',
  'that', 'these', 'period', 'overall', 'here', 'spending', 'change', 'changed', 'changes',
  'it', 'its', 'was', 'were', 'is', 'are', 'category', 'categories',
]);

// ── Banned lexicon (final-sentence scan; rework rails 2 & 3) ──────────────────
export const SHAME_WORDS: readonly string[] = [
  'wasted', 'waste', 'wasteful', 'splurge', 'splurged', 'blew', 'blown', 'guilty', 'guilt',
  'irresponsible', 'reckless', 'careless', 'frivolous', 'frittered', 'squandered', 'overspent',
  'overspending', 'shameful', 'shame', 'indulgent', 'indulgence', 'out of control', 'too much',
  'bad habit', 'bad habits', 'should', 'consider', 'cut back', 'cut down', 'reduce', 'recommend',
  'suggest', 'try to', 'watch out', 'limit', 'avoid', 'rein in', 'again', 'as usual', 'habit',
];
export const COMPARATIVE_MAGNITUDE_WORDS: readonly string[] = [
  'doubled', 'double', 'tripled', 'triple', 'quadrupled', 'halved', 'twice', 'thrice',
  'threefold', 'tenfold', 'fold', 'skyrocketed', 'skyrocket', 'plummeted', 'plummet', 'surged',
  'surge', 'soared', 'soar', 'exploded', 'ballooned', 'slashed', 'plunged', 'spiked', 'spike',
  'multiplied', 'outpaced', 'outstripped', 'eclipsed', 'dwarfed', 'overtook', 'most of',
  'much of', 'bulk of', 'majority of', 'vast majority', 'nearly all', 'almost all', 'lion share',
  'fraction of', 'a fraction', 'far more', 'far less', 'way more', 'way less', 'massively',
  'enormously', 'combined',
];
export const CAUSAL_WORDS: readonly string[] = [
  'because', 'due to', 'caused by', 'thanks to', 'as a result', 'result of', 'driven by',
  'blame', 'responsible for', 'owing to', 'stems from', 'led to', 'reason', 'why you',
  'you decided', 'you chose',
];
export const NUMBER_WORDS: readonly string[] = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'twenty', 'thirty', 'forty', 'fifty',
  'sixty', 'seventy', 'eighty', 'ninety', 'hundred', 'thousand', 'million', 'billion', 'dozen',
  'percent', 'dollars', 'dollar', 'cents', 'grand',
];
export const BANNED_NARRATIVE_WORDS: readonly string[] = [
  ...SHAME_WORDS, ...COMPARATIVE_MAGNITUDE_WORDS, ...CAUSAL_WORDS, ...NUMBER_WORDS,
];

const CURRENCY_RE = /\$\s?\d[\d,]*(?:\.\d{1,2})?/g;
const PERCENT_RE = /[+-]?\d+(?:\.\d+)?\s?%/g;
const CAPS_RE = /\b[A-Z][A-Za-z0-9'’&.-]*/g;
const PLACEHOLDER_RE = /\{([a-z_]+)\}/g;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const BANNED_RE = new RegExp(`\\b(?:${BANNED_NARRATIVE_WORDS.map(escapeRe).join('|')})\\b`, 'i');

const collapseWs = (s: string): string => s.replace(/\s+/g, ' ');
const normNum = (s: string): string => s.replace(/\s+/g, '');
const labelTokens = (label: string): string[] =>
  label.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);
const wordTokens = (s: string): string[] => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

// ── The reshaper ────────────────────────────────────────────────────────────
const dirWord = (d: MoveFactor['direction']): string => (d === 'up' ? 'up' : d === 'down' ? 'down' : 'new');

function toFactor(m: CategoryMover): MoveFactor {
  const abs = Math.abs(m.deltaCents);
  const formattedAbs = formatCents(cents(abs));
  // Round to a whole percent; omit at the ±0 edge so the atom never shows a
  // direction-inconsistent "(+0%)" / negative-zero "(0%)" (critic cycle-3 P2-7).
  const pctInt = m.pctChange === null ? 0 : Math.round(m.pctChange * 100);
  const formattedPct =
    m.direction === 'new' || m.pctChange === null || pctInt === 0
      ? null
      : `${pctInt > 0 ? '+' : ''}${pctInt}%`;
  const deltaPhrase = m.direction === 'new' ? `new at ${formattedAbs}` : `${dirWord(m.direction)} ${formattedAbs}`;
  const phrase = `${m.name}, ${deltaPhrase}${formattedPct ? ` (${formattedPct})` : ''}`;
  return {
    id: m.categoryId,
    label: m.name,
    direction: m.direction,
    deltaCents: m.deltaCents,
    formattedAbs,
    formattedSigned: formatCents(cents(m.deltaCents), { signDisplay: 'always' }),
    formattedPct,
    deltaPhrase,
    phrase,
  };
}

/** The deterministic one-liner. NOTE: category labels are user free text, so this
 *  is NOT guaranteed clean — `resolveMoveSentence` re-scans it and suppresses the
 *  surface if a hostile label would render a banned word or a money-lookalike. */
function buildDeterministicSentence(factors: readonly MoveFactor[], windowText: string): string {
  const [a, b] = factors;
  if (!a) return '';
  const lead =
    a.direction === 'new'
      ? `${a.label} is new this period at ${a.formattedAbs}`
      : `The biggest change was ${a.label}, ${a.deltaPhrase}`;
  const second = b ? `, with ${b.label} ${b.deltaPhrase}` : '';
  const tail = a.direction === 'new' && !b ? '' : `, compared with ${windowText}`;
  return `${lead}${second}${tail}.`;
}

export function explainBalanceMove(trends: SpendingTrends): BalanceMoveExplanation {
  const factors = trends.movers.slice(0, MAX_EXPLAINER_FACTORS).map(toFactor);
  const monthsAvg = trends.baselineMonths.length;
  const comparisonWindowText = monthsAvg <= 0 ? 'your earlier months' : `your ${monthsAvg}-month average`;
  const deterministicSentence = buildDeterministicSentence(factors, comparisonWindowText);

  const allowedNumberStrings: string[] = [];
  const allowedLabelTokens: string[] = [];
  for (const f of factors) {
    allowedNumberStrings.push(f.formattedAbs, f.formattedSigned);
    if (f.formattedPct) allowedNumberStrings.push(f.formattedPct);
    allowedLabelTokens.push(...labelTokens(f.label));
  }

  return {
    triggered: factors.length > 0,
    comparedYm: trends.comparedYm,
    comparisonWindowText,
    primaryDriverId: factors[0]?.id ?? null,
    factors,
    deterministicSentence,
    allowedNumberStrings: [...new Set(allowedNumberStrings)],
    allowedLabelTokens: [...new Set(allowedLabelTokens)],
  };
}

// ── Template grammar validation ─────────────────────────────────────────────
function placeholderAllowed(name: string, e: BalanceMoveExplanation): boolean {
  if (!ALLOWED_TEMPLATE_PLACEHOLDERS.has(name)) return false;
  if (name === 'second' && e.factors.length < 2) return false;
  return true;
}

/**
 * Validate an LLM template BEFORE substitution. Enforces the fixed atomic grammar
 * `{primary} [ {second} ] {window}` (that exact order, window last, no dup/reorder),
 * whitelisted connectives only, and no literal number/currency. `{primary}` before
 * `{second}` keeps the ranking truthful; `{window}` is required so the comparison
 * window is always disclosed.
 */
export function validateTemplate(template: string, e: BalanceMoveExplanation): NarrativeCheck {
  const text = collapseWs(template.trim());
  if (!text) return { ok: false, reason: 'empty' };
  if (text.length > MAX_NARRATIVE_LEN) return { ok: false, reason: 'too-long' };
  if (/[\n\r]/.test(template)) return { ok: false, reason: 'multiline' };
  if (/[^\x20-\x7E]/.test(text)) return { ok: false, reason: 'non-ascii' };

  const seq = [...text.matchAll(PLACEHOLDER_RE)].map((m) => m[1]);
  for (const name of seq) if (!placeholderAllowed(name, e)) return { ok: false, reason: `placeholder:${name}` };

  // Fixed order: primary, then optional second, then window — exactly. This kills
  // reordering (which, with adjacency = binding, is a figure swap) and duplicates.
  let i = 0;
  if (seq[i] !== 'primary') return { ok: false, reason: 'missing-primary' };
  i++;
  if (seq[i] === 'second') i++;
  if (seq[i] !== 'window') return { ok: false, reason: 'missing-window' };
  i++;
  if (i !== seq.length) return { ok: false, reason: 'placeholder-order' };

  const residue = text.replace(PLACEHOLDER_RE, ' ');
  if (/[0-9$%]/.test(residue)) return { ok: false, reason: 'literal-number' };
  for (const w of wordTokens(residue)) {
    if (!ALLOWED_CONNECTIVES.has(w)) return { ok: false, reason: `non-connective:${w}` };
  }
  return { ok: true };
}

/** Substitute the atomic placeholders with engine values. The {window} atom carries
 *  its own "compared with …" intro so no comparison connective is ever needed. */
function substitute(template: string, e: BalanceMoveExplanation): string {
  const map: Record<string, string> = {
    primary: e.factors[0]!.phrase,
    second: e.factors[1]?.phrase ?? '',
    window: `compared with ${e.comparisonWindowText}`,
  };
  return collapseWs(template.replace(PLACEHOLDER_RE, (_, name: string) => map[name] ?? '')).trim();
}

/**
 * Final defense-in-depth scan on a fully rendered sentence (LLM-substituted OR the
 * deterministic template). Numbers should already be engine-authored; this
 * independently re-checks non-ASCII, banned lexicon, a stray number (any digit left
 * after masking the real figures + the window), and an invented proper noun — which
 * also catches a hostile custom-category LABEL. (No foreign-category scan: the
 * atomic grammar makes it impossible for the model to emit a category word — every
 * model word is a whitelisted connective and category names arrive only inside
 * allowed label atoms — so such a scan could only false-positive on a benign
 * custom-category name and silently kill the surface. Critic cycle-3 P1-2.)
 */
export function validateSentence(
  sentence: string,
  input: {
    allowedNumberStrings: readonly string[];
    allowedLabelTokens: readonly string[];
    comparisonWindowText: string;
  },
): NarrativeCheck {
  const text = collapseWs(sentence.trim());
  if (!text) return { ok: false, reason: 'empty' };
  if (text.length > MAX_NARRATIVE_LEN) return { ok: false, reason: 'too-long' };
  if (/[\n\r]/.test(sentence)) return { ok: false, reason: 'multiline' };
  if (/[^\x20-\x7E]/.test(text)) return { ok: false, reason: 'non-ascii' };

  const terminals = text.match(/[.!?](?!\d)/g) ?? [];
  if (terminals.length > 1) return { ok: false, reason: 'multi-sentence' };
  if (terminals.length === 1 && !/[.!?]$/.test(text)) return { ok: false, reason: 'mid-terminal' };

  const banned = BANNED_RE.exec(text);
  if (banned) return { ok: false, reason: `banned:${banned[0].toLowerCase()}` };

  // Mask the real figures, the window, AND the factors' own label tokens (a common
  // finance category like "401k"/"529 Plan"/"Taxes 2026" carries digits that are the
  // user's label, not a fabricated figure — critic cycle-4 P2-1). Any digit still
  // left is an ungrounded number.
  let masked = text;
  for (const s of [...input.allowedNumberStrings, input.comparisonWindowText, ...input.allowedLabelTokens]) {
    if (s) masked = masked.split(s).join(' ');
  }
  if (/[0-9]/.test(masked)) return { ok: false, reason: 'stray-number' };

  const allowedNums = new Set(input.allowedNumberStrings.map(normNum));
  for (const tok of text.match(CURRENCY_RE) ?? []) {
    if (!allowedNums.has(normNum(tok))) return { ok: false, reason: `currency:${tok}` };
  }
  for (const tok of text.match(PERCENT_RE) ?? []) {
    if (!allowedNums.has(normNum(tok))) return { ok: false, reason: `percent:${tok}` };
  }

  const allowedLabelSet = new Set(input.allowedLabelTokens);
  for (const m of text.match(CAPS_RE) ?? []) {
    const w = m.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (w.length > 1 && !allowedLabelSet.has(w) && !ALLOWED_CONNECTIVES.has(w)) {
      return { ok: false, reason: `proper-noun:${m}` };
    }
  }
  return { ok: true };
}

// ── LLM prompt (pure; the network call lives in src/server/balance-move-llm.ts) ─
/** Build the atomic-template rewording prompt. The model gets no figures and no
 *  bare labels — only whole "{primary}" units and the closed connective grammar. */
export function buildMovePrompt(e: BalanceMoveExplanation): string {
  const hasSecond = e.factors.length >= 2;
  return [
    'You arrange a spending-change summary into ONE natural sentence. Each category and its',
    'amount is ALREADY WRITTEN for you as a single placeholder — you never type a number,',
    'amount, percent, category name, or store name yourself.',
    '',
    'Placeholders (whole phrases we substitute — do not split or edit them):',
    `- {primary} = the top-changing category with its amount already inside (e.g. "Dining, up $240.00").`,
    hasSecond
      ? '- {second} = the next category with its amount already inside.'
      : '- (only one category changed this period — do NOT use {second}).',
    '- {window} = the comparison, already phrased as "compared with your … average" (do not add your own "compared"/"vs").',
    '',
    'Hard rules:',
    `- primaryDriverId MUST be exactly "${e.primaryDriverId}".`,
    '- ONE sentence, at most ~30 words, ending with a period.',
    `- Placeholders MUST appear in this order: {primary}${hasSecond ? ', then optionally {second},' : ''} then {window} last.`,
    '- {primary} and {window} are REQUIRED.',
    '- Between placeholders use ONLY plain ADDITIVE connective words (the, and, with, also, alongside, this, spending, changed, …). No "from"/"to"/"vs"/"compared"/"shifted" — those assert a flow the data does not support.',
    '- Do NOT type any digit, $, %, category name, store, brand, ranking word ("biggest"/"new"), advice, shame, cause, or magnitude word.',
    '',
    'Respond with ONLY a JSON object: {"primaryDriverId": "...", "template": "..."}',
    `Example: {"primaryDriverId": "${e.primaryDriverId ?? ''}", "template": "The change was {primary},${hasSecond ? ' with {second},' : ''} {window}."}`,
  ].join('\n');
}

// ── Compose: LLM polish, else the safe (and re-scanned) template ─────────────
export interface LlmMoveDraft {
  primaryDriverId: string;
  /** An atomic-placeholder + connective TEMPLATE — never free prose, never a figure. */
  template: string;
}

export interface ResolvedMoveSentence {
  sentence: string;
  interpreted: boolean;
  rejectedReason?: string;
}

export function resolveMoveSentence(
  explanation: BalanceMoveExplanation,
  llm: LlmMoveDraft | null,
): ResolvedMoveSentence {
  const scanInput = {
    allowedNumberStrings: explanation.allowedNumberStrings,
    allowedLabelTokens: explanation.allowedLabelTokens,
    comparisonWindowText: explanation.comparisonWindowText,
  };
  // The deterministic sentence embeds user-controlled category labels, so it is
  // re-scanned too; a hostile label that would render a banned word / money-
  // lookalike suppresses the surface (empty sentence) rather than shipping it.
  const fallback = (reason?: string): ResolvedMoveSentence => {
    const check = validateSentence(explanation.deterministicSentence, scanInput);
    if (!check.ok) return { sentence: '', interpreted: false, rejectedReason: reason ?? `fallback-${check.reason}` };
    return { sentence: explanation.deterministicSentence, interpreted: false, ...(reason ? { rejectedReason: reason } : {}) };
  };

  if (!explanation.triggered || explanation.primaryDriverId === null) {
    return { sentence: '', interpreted: false };
  }
  if (!llm) return fallback();
  if (llm.primaryDriverId !== explanation.primaryDriverId) return fallback('driver-mismatch');

  const templateCheck = validateTemplate(llm.template, explanation);
  if (!templateCheck.ok) return fallback(templateCheck.reason);

  const sentence = substitute(llm.template, explanation);
  const sentenceCheck = validateSentence(sentence, scanInput);
  if (!sentenceCheck.ok) return fallback(sentenceCheck.reason);

  return { sentence, interpreted: true };
}
