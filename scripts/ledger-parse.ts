/**
 * scripts/ledger-parse.ts — pure parsing helpers behind `scripts/ledger.ts`.
 *
 * Split out of ledger.ts so the DECISIONS.md → DECISIONS_INDEX.md mapping is
 * unit-testable without touching the filesystem. No `fs`, no `__dirname`, no
 * side effects: everything here is a pure function of file CONTENTS.
 *
 * `docs/DECISIONS.md` has TWO formats and always will — the legacy pipe table
 * (#1–#337) is not being rewritten:
 *
 *   1. `| n | phase | decision | rationale |`   (legacy, #1–#337)
 *   2. `## #n (phase) — title` / `## #n (phase): title` / `## #n — title`
 *      / a bare `## #n` whose first bold body line carries the title
 *      (heading era, #338–)
 *
 * Reading only format 1 is what made `reindex` destructive: it regenerated the
 * index with 329 rows and silently dropped 46 heading-era decisions (see
 * docs/STATUS.md, and the Cursor agent that deleted #374–#382 in good faith by
 * running the command the index header itself prescribes).
 */

export type DecisionEntry = {
  num: number;
  phase: string;
  summary: string;
  /** Repo-relative path, set when collecting per-file for the index. */
  file?: string;
};

const SUMMARY_MAX = 220;

function tidy(text: string): string {
  return text
    .replace(/\\\|/g, "|") // unescape table cells for display
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(text: string): string {
  return text.length > SUMMARY_MAX ? `${text.slice(0, SUMMARY_MAX)}…` : text;
}

/**
 * Pull a LEADING `(phase)` off a title, e.g. `(O.15 slice 2) — One action menu`.
 * Only a parenthetical that opens the string counts: `#384 — Median … (not
 * Math.max)` has a trailing parenthetical that is part of the sentence, not a
 * phase, and must not be mistaken for one.
 */
function splitLeadingPhase(title: string): { phase: string; rest: string } {
  const match = title.match(/^\(([^)]*)\)\s*(?:[—:–-]+\s*)?(.*)$/);
  if (!match) return { phase: "?", rest: title.trim() };
  return { phase: match[1].trim() || "?", rest: match[2].trim() };
}

/** Best-effort parse of one `| n | phase | rest... |` row for the index. Some
 * legacy rows contain unescaped `|` inside inline code spans (valid GFM,
 * invalid naive split), so this deliberately does NOT try to split decision
 * from rationale — it keeps everything after the phase column as one summary,
 * which is exact for correctly-escaped rows and still useful (grep-able,
 * truncated) for the legacy ones. */
export function parseDecisionRow(line: string): DecisionEntry | null {
  const withPhase = line.match(/^\|\s*(\d+)\s*\|\s*([^|]*?)\s*\|\s*(.*)\|\s*$/);
  // Fallback for legacy malformed rows missing the Phase column (e.g. #165):
  // `| n | rest... |` with only 3 top-level pipes. Still indexed, phase "?".
  const withoutPhase = line.match(/^\|\s*(\d+)\s*\|\s*(.*)\|\s*$/);
  const match = withPhase ?? withoutPhase;
  if (!match) return null;
  const [num, phase, rest] = withPhase
    ? [match[1], match[2], match[3]]
    : [match[1], "?", match[2]];
  return { num: Number(num), phase: phase.trim() || "?", summary: truncate(tidy(rest)) };
}

/** `## #n …` — returns the number and whatever title the heading itself carries
 * (possibly empty, for the bare `## #354` shape). */
export function parseDecisionHeading(line: string): { num: number; title: string } | null {
  const match = line.match(/^##\s*#(\d+)\s*(?:[—:–-]+\s*)?(.*)$/);
  if (!match) return null;
  return { num: Number(match[1]), title: match[2].trim() };
}

/**
 * Every decision in the file, in numeric order, from BOTH formats.
 *
 * For a heading with no title of its own, the summary falls back to the first
 * non-empty body line before the next `##` — which by house style is the bold
 * one-line thesis (`**(W.1a) The wealth-target card renders its inputs…**`).
 */
export function collectDecisionEntries(contents: string, file?: string): DecisionEntry[] {
  const lines = contents.split(/\r?\n/);
  const entries: DecisionEntry[] = [];
  const loc = file !== undefined ? { file } : {};

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    const heading = parseDecisionHeading(line);
    if (heading) {
      let title = heading.title;
      if (!title) {
        for (let j = i + 1; j < lines.length; j += 1) {
          if (/^##\s/.test(lines[j])) break;
          const candidate = lines[j].trim();
          if (!candidate) continue;
          // House style: the thesis line is bold-wrapped. Strip the wrapper so
          // the index reads as prose rather than as markup.
          title = candidate.replace(/^\*\*(.*)\*\*$/, "$1").trim();
          break;
        }
      }
      const { phase, rest } = splitLeadingPhase(title);
      entries.push({ num: heading.num, phase, summary: truncate(tidy(rest)), ...loc });
      continue;
    }

    const row = parseDecisionRow(line);
    if (row) entries.push({ ...row, ...loc });
  }

  return entries.sort((a, b) => a.num - b.num);
}

/** Union of per-file collections, sorted by number. Each entry is stamped with its source. */
export function collectFromSources(sources: { file: string; contents: string }[]): DecisionEntry[] {
  return sources
    .flatMap((s) => collectDecisionEntries(s.contents, s.file))
    .sort((a, b) => a.num - b.num);
}

/** Decision numbers already present in an existing DECISIONS_INDEX.md.
 * Accepts the pre-D.2 bold-prose lines (`- **#n** (Phase …): …`) AND the
 * D.2 one-line form (`- #n — title → file`) so the anti-deletion lock still
 * sees today's numbers on the first regenerate after a format change. */
export function parseIndexNumbers(indexContents: string): number[] {
  return indexContents
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*-\s+(?:\*\*)?#(\d+)\b/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => Number(m[1]));
}

/** Numbers indexed today that the regenerated index would NOT contain. Any
 * non-empty result means regenerating is a DELETION, which is the failure this
 * module exists to make impossible. */
export function droppedNumbers(existingIndex: number[], entries: DecisionEntry[]): number[] {
  const next = new Set(entries.map((e) => e.num));
  return [...new Set(existingIndex.filter((n) => !next.has(n)))].sort((a, b) => a - b);
}

/** Numbers appearing more than once across the two formats — a real ambiguity
 * about which text describes decision #n, never something to silently emit twice. */
export function duplicateNumbers(entries: DecisionEntry[]): number[] {
  const seen = new Set<number>();
  const dupes = new Set<number>();
  for (const entry of entries) {
    if (seen.has(entry.num)) dupes.add(entry.num);
    seen.add(entry.num);
  }
  return [...dupes].sort((a, b) => a - b);
}

/** The next free decision number, counting BOTH formats. Reading only the table
 * returns 338 — a number six months of heading-era decisions already used. */
export function nextDecisionNumber(contents: string): number {
  const entries = collectDecisionEntries(contents);
  const max = entries.reduce((acc, entry) => Math.max(acc, entry.num), 0);
  return max + 1;
}

/** One line per decision: `- #n — title → file`. Title is the summary with
 * any trailing `| rationale` from a legacy table row stripped — the body
 * lives in the pointed-at file. Throws if an entry has no source file:
 * a line without a path is an index that cannot be followed. */
export function renderIndexBody(entries: DecisionEntry[]): string[] {
  return entries.map((e) => {
    if (!e.file) {
      throw new Error(`renderIndexBody: decision #${e.num} has no source file`);
    }
    const title = e.summary.split(" | ")[0];
    return `- #${e.num} — ${title} → ${e.file}`;
  });
}
