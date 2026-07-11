#!/usr/bin/env tsx
/**
 * scripts/ledger.ts — append correctly-formatted entries to the project ledgers
 * (docs/DECISIONS.md, REGRESSION_LEDGER.md, PROGRESS.md) and regenerate
 * docs/DECISIONS_INDEX.md, so sessions stop hand-formatting rows and stop
 * grepping the full multi-hundred-KB ledger files just to find one line.
 *
 * Per docs/SKILLS_PLAN.md §2 (S2). Zero model calls — pure mechanical formatting.
 *
 * Usage:
 *   tsx scripts/ledger.ts decision <phase> "<decision text>" "<rationale text>"
 *   tsx scripts/ledger.ts regression "<symptom>|<root cause>|<rule broken>|<locking test>" [date]
 *   tsx scripts/ledger.ts progress "<title>" "<body markdown>" [date]
 *   tsx scripts/ledger.ts reindex
 *
 * "decision" auto-detects the next decision number from the existing table and
 * regenerates docs/DECISIONS_INDEX.md afterward. "reindex" only regenerates the
 * index (useful after a hand-edit, or to build it the first time).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const DECISIONS_PATH = join(ROOT, "docs", "DECISIONS.md");
const DECISIONS_INDEX_PATH = join(ROOT, "docs", "DECISIONS_INDEX.md");
const REGRESSION_PATH = join(ROOT, "REGRESSION_LEDGER.md");
const PROGRESS_PATH = join(ROOT, "PROGRESS.md");

function today(): string {
  // Local calendar date, not UTC — matches how every other date in this repo's
  // ledgers is written (the session's local day), and avoids an off-by-one
  // near midnight UTC.
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** Escape literal `|` in free text so it can't break a markdown table row. */
function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").trim();
}

function readFile(path: string): string {
  if (!existsSync(path)) {
    throw new Error(`ledger.ts: expected file not found: ${path}`);
  }
  return readFileSync(path, "utf8");
}

/** These ledgers are checked out CRLF on Windows (see docs/lessons/windows-codegen-via-shell.md).
 * Detect the dominant line ending so appended/inserted content matches it — mixing
 * endings within one file causes silent line-splitting bugs (blank-line checks that
 * compare against `""` never match a line that's actually `"\r"`). */
function detectEol(text: string): "\r\n" | "\n" {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function ensureTrailingNewline(text: string, eol: string): string {
  return text.endsWith(eol) ? text : `${text}${eol}`;
}

// ---------------------------------------------------------------------------
// decision
// ---------------------------------------------------------------------------

function nextDecisionNumber(contents: string): number {
  const rows = contents.split("\n").filter((line) => /^\|\s*\d+\s*\|/.test(line));
  let max = 0;
  for (const row of rows) {
    const match = row.match(/^\|\s*(\d+)\s*\|/);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}

function appendDecision(phase: string, decision: string, rationale: string): void {
  const contents = readFile(DECISIONS_PATH);
  const eol = detectEol(contents);
  const num = nextDecisionNumber(contents);
  const row = `| ${num} | ${escapeCell(phase)} | ${escapeCell(decision)} | ${escapeCell(rationale)} |`;
  const updated = ensureTrailingNewline(contents, eol) + row + eol;
  writeFileSync(DECISIONS_PATH, updated, "utf8");
  console.log(`DECISIONS.md: appended #${num} (Phase ${phase})`);
  regenerateDecisionsIndex();
}

/** Best-effort parse of one `| n | phase | rest... |` row for the index. Some
 * legacy rows contain unescaped `|` inside inline code spans (valid GFM,
 * invalid naive split), so this deliberately does NOT try to split decision
 * from rationale — it keeps everything after the phase column as one summary,
 * which is exact for correctly-escaped rows and still useful (grep-able,
 * truncated) for the legacy ones. */
function parseDecisionRow(line: string): { num: string; phase: string; summary: string } | null {
  const withPhase = line.match(/^\|\s*(\d+)\s*\|\s*([^|]*?)\s*\|\s*(.*)\|\s*$/);
  // Fallback for legacy malformed rows missing the Phase column (e.g. #165):
  // `| n | rest... |` with only 3 top-level pipes. Still indexed, phase "?".
  const withoutPhase = line.match(/^\|\s*(\d+)\s*\|\s*(.*)\|\s*$/);
  const match = withPhase ?? withoutPhase;
  if (!match) return null;
  const [num, phase, rest] = withPhase ? [match[1], match[2], match[3]] : [match[1], "?", match[2]];
  const clean = rest
    .replace(/\\\|/g, "|") // unescape for display
    .replace(/\s+/g, " ")
    .trim();
  const summary = clean.length > 220 ? `${clean.slice(0, 220)}…` : clean;
  return { num, phase: phase.trim(), summary };
}

function regenerateDecisionsIndex(): void {
  const contents = readFile(DECISIONS_PATH);
  const eol = detectEol(contents);
  const lines = contents.split(/\r?\n/);
  const entries = lines
    .map(parseDecisionRow)
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((a, b) => Number(a.num) - Number(b.num));

  const header = [
    "# Decisions Index",
    "",
    "Auto-generated by `scripts/ledger.ts` — one line per `docs/DECISIONS.md` row, so a",
    "session can find a decision by number or keyword without loading the full ledger.",
    "Do not hand-edit; run `tsx scripts/ledger.ts reindex` to regenerate.",
    "",
  ];
  const body = entries.map((e) => `- **#${e.num}** (Phase ${e.phase}): ${e.summary}`);
  const out = [...header, ...body].join(eol);
  writeFileSync(DECISIONS_INDEX_PATH, ensureTrailingNewline(out, eol), "utf8");
  console.log(`DECISIONS_INDEX.md: regenerated (${entries.length} entries)`);
}

// ---------------------------------------------------------------------------
// regression
// ---------------------------------------------------------------------------

function appendRegression(spec: string, date: string): void {
  const parts = spec.split("|").map((s) => s.trim());
  if (parts.length !== 4) {
    throw new Error(
      `ledger.ts regression: expected "symptom|root cause|rule broken|locking test" (4 parts separated by |), got ${parts.length}`,
    );
  }
  const [symptom, cause, rule, test] = parts;
  const contents = readFile(REGRESSION_PATH);
  const eol = detectEol(contents);
  const row = `| ${date} | ${escapeCell(symptom)} | ${escapeCell(cause)} | ${escapeCell(rule)} | ${escapeCell(test)} |`;
  const updated = ensureTrailingNewline(contents, eol) + row + eol;
  writeFileSync(REGRESSION_PATH, updated, "utf8");
  console.log(`REGRESSION_LEDGER.md: appended ${date} entry`);
}

// ---------------------------------------------------------------------------
// progress
// ---------------------------------------------------------------------------

function prependProgress(title: string, body: string, date: string): void {
  const contents = readFile(PROGRESS_PATH);
  const eol = detectEol(contents);
  const lines = contents.split(/\r?\n/);
  // PROGRESS.md convention: `# PROGRESS.md — session resume log` as line 1,
  // then newest session first. Insert the new section right after that title
  // (and the blank line that follows it, if present) so `tail`-readers who
  // open the file always see the latest state first.
  let insertAt = 1;
  if (lines[insertAt] === "") insertAt += 1;
  const section = [`## ${date} — ${title}`, "", body.trim(), ""];
  const updatedLines = [...lines.slice(0, insertAt), ...section, ...lines.slice(insertAt)];
  writeFileSync(PROGRESS_PATH, ensureTrailingNewline(updatedLines.join(eol), eol), "utf8");
  console.log(`PROGRESS.md: prepended "${date} — ${title}"`);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage(): never {
  console.error(
    [
      "Usage:",
      '  tsx scripts/ledger.ts decision <phase> "<decision text>" "<rationale text>"',
      '  tsx scripts/ledger.ts regression "<symptom>|<root cause>|<rule broken>|<locking test>" [date]',
      '  tsx scripts/ledger.ts progress "<title>" "<body markdown>" [date]',
      "  tsx scripts/ledger.ts reindex",
    ].join("\n"),
  );
  process.exit(1);
}

function main(): void {
  const [cmd, ...rest] = process.argv.slice(2);

  switch (cmd) {
    case "decision": {
      const [phase, decision, rationale] = rest;
      if (!phase || !decision || !rationale) usage();
      appendDecision(phase, decision, rationale);
      return;
    }
    case "regression": {
      const [spec, date] = rest;
      if (!spec) usage();
      appendRegression(spec, date || today());
      return;
    }
    case "progress": {
      const [title, body, date] = rest;
      if (!title || !body) usage();
      prependProgress(title, body, date || today());
      return;
    }
    case "reindex": {
      regenerateDecisionsIndex();
      return;
    }
    default:
      usage();
  }
}

main();
