#!/usr/bin/env tsx
/**
 * scripts/docs-lint.ts — warn on doc drift the D1–D8 cleanup pass (docs/SKILLS_PLAN.md §5,
 * TASKS.md Wave S.2) just fixed by hand, so it stays fixed. Zero model calls.
 *
 * Per docs/SKILLS_PLAN.md §2 (S3). Checks, each over every tracked `*.md` file
 * (walked from repo root, skipping node_modules/.git/.next):
 *
 *   1. Pulse-leak       — "pulse" outside the frozen allowlist (old seed strings, asset
 *                          filenames, abandoned local paths, the one-line "formerly Pulse
 *                          Finance" rename note) in a *current-facing* doc. Historical
 *                          ledgers (DECISIONS/STATUS/PROGRESS/REGRESSION_LEDGER/TASKS +
 *                          their index) and docs/archive/** and docs/baseline/** are
 *                          exempt — they are records of what was true/written at the time,
 *                          not living docs (D1/D5).
 *   2. Hardcoded counts — a bare "<number> unit/tests/files" claim outside the one status
 *                          home (docs/STATUS.md) and the historical ledgers above (D1).
 *   3. Archive banner   — every docs/archive/*.md must open with a `> **HISTORICAL**` (or
 *                          `> HISTORICAL`) blockquote banner (D2/D4/D5).
 *   4. Verify phrasing  — flags stale/incorrect verify-command spellings now that
 *                          `bash scripts/verify.sh` / `npm run verify` / `npm run verify:e2e`
 *                          are both real (D7).
 *
 * This is a WARNING tool, not a gate: it prints findings and exits 1 only if any are found,
 * but scripts/verify.sh (the Definition-of-Done gate) does not call it — CI's separate
 * `docs-lint` step is allowed to fail without failing the required `verify` job (see
 * .github/workflows/verify.yml).
 *
 * Usage: tsx scripts/docs-lint.ts [--fix-banners]
 *   --fix-banners   for any docs/archive/*.md missing the banner, prepend a generic one
 *                    (still flags it as a finding this run; the next run is clean).
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = join(__dirname, "..");

const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "coverage", "playwright-report", "test-results"]);

function walkMarkdown(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walkMarkdown(full, out);
    } else if (entry.toLowerCase().endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

function toRepoPath(absPath: string): string {
  return relative(ROOT, absPath).split(sep).join("/");
}

// ---------------------------------------------------------------------------
// Shared exemptions
// ---------------------------------------------------------------------------

// Append-only ledgers: a record of what was true/written at the time. D1 says status
// lives ONLY here (so hardcoded counts are expected); their historical entries also
// legitimately mention "Pulse" while narrating pre-rename events (#80-era fixes, the
// relocation, etc.) — rewriting past ledger rows would falsify the record.
const LEDGER_FILES = new Set([
  "docs/DECISIONS.md",
  "docs/DECISIONS_INDEX.md",
  "docs/STATUS.md",
  "PROGRESS.md",
  "REGRESSION_LEDGER.md",
  "TASKS.md",
]);

function isArchived(repoPath: string): boolean {
  return repoPath.startsWith("docs/archive/") || repoPath.startsWith("docs/baseline/");
}

function isLedger(repoPath: string): boolean {
  return LEDGER_FILES.has(repoPath);
}

const BANNER_PATTERN = /^>\s*\*{0,2}HISTORICAL\*{0,2}/im;

// A doc bannered `> HISTORICAL` (D4 — SPEC.md, PHASE_0_ARCHITECTURE.md,
// SCHWAB_PROVIDER_SKETCH.md, plus everything under docs/archive/) is a frozen point-in-time
// record by definition: it is expected to keep its original pre-rename wording and counts,
// same as a ledger entry, so it gets the same exemption without having to physically move it.
function isBanneredHistorical(text: string): boolean {
  const head = text.split(/\r\n|\n/).slice(0, 5).join("\n");
  return BANNER_PATTERN.test(head);
}

// Dated, point-in-time planning/audit docs (filename or leading line carries the date) that
// narrate past state, including "what X used to be called" or "N tests at the time" —
// factual snapshots, not living current-state claims. Named individually rather than by a
// blanket dated-doc rule so new dated docs are still checked by default.
const NARRATIVE_SNAPSHOT_FILES = new Set([
  "docs/SKILLS_PLAN.md", // the plan that describes and tracks the Pulse-leak cleanup itself
  "docs/STRATEGIC_AUDIT_2026-07-09.md",
]);

// Cosmetic/out-of-scope per DECISIONS #216 (S.2): the frozen seed email/RNG string plus a
// couple of docs whose only "pulse" is an example Neon DB name or an asset filename
// describing the (unchanged) old logo asset — explicitly left untouched, not a leak.
const PULSE_OUT_OF_SCOPE_FILES = new Set(["docs/BACKUP_AND_RECOVERY.md", "docs/DEPLOY.md"]);

// ---------------------------------------------------------------------------
// Check 1 — Pulse leak
// ---------------------------------------------------------------------------

// Frozen strings that are factually correct to keep verbatim anywhere (seed data,
// abandoned local paths, asset filenames) — matched literally, case-sensitive where the
// casing itself is the frozen artifact (a filename, a path, a seed constant).
const PULSE_ALLOW_SUBSTRINGS = [
  "demo@pulse.finance",
  "pulse-finance-seed",
  "pulse-finance-icon.svg",
  "pulse-finance-logo-128.png",
  "C:\\dev\\Pulse Finance",
  "C:\\Users\\micha\\OneDrive\\Documents\\Pulse Finance",
  "`pulse`", // cosmetic Neon example DB name (DECISIONS #216 S.2: left untouched, out of scope)
];

// Narrative mentions, allowed anywhere they appear verbatim: explaining the rename happened
// at all ("(formerly Pulse Finance") or narrating it as a past fix in quotes ("Pulse" leaks,
// "Pulse"→"Aimplifi") — the word is the subject being discussed, not a live leak.
const PULSE_ALLOW_PATTERNS = [/\(formerly ["“]?Pulse Finance["”]?/i, /["“]Pulse["”]/];

function findPulseLeaks(repoPath: string, text: string): string[] {
  if (isArchived(repoPath) || isLedger(repoPath) || isBanneredHistorical(text)) return [];
  if (NARRATIVE_SNAPSHOT_FILES.has(repoPath) || PULSE_OUT_OF_SCOPE_FILES.has(repoPath)) return [];
  const findings: string[] = [];
  const lines = text.split(/\r\n|\n/);
  lines.forEach((line, idx) => {
    if (!/pulse/i.test(line)) return;
    let stripped = line;
    for (const s of PULSE_ALLOW_SUBSTRINGS) stripped = stripped.split(s).join("");
    for (const p of PULSE_ALLOW_PATTERNS) stripped = stripped.replace(p, "");
    if (/pulse/i.test(stripped)) {
      findings.push(`${repoPath}:${idx + 1}: unallowlisted "Pulse" mention: ${line.trim()}`);
    }
  });
  return findings;
}

// ---------------------------------------------------------------------------
// Check 2 — hardcoded test counts
// ---------------------------------------------------------------------------

// e.g. "2271 unit", "177 files", "409 tests", "1142 tests passing" — a bare count claim
// that will drift the moment the suite grows, per D1's repeated-reconciliation evidence.
const COUNT_PATTERN = /\b\d{2,6}\s+(unit(?:\s*\/\s*\d+\s*files?)?|tests?|test\s+files?|files?)\b/i;

function findHardcodedCounts(repoPath: string, text: string): string[] {
  if (repoPath === "docs/STATUS.md" || isLedger(repoPath) || isArchived(repoPath)) return [];
  if (isBanneredHistorical(text) || NARRATIVE_SNAPSHOT_FILES.has(repoPath)) return [];
  if (repoPath.startsWith("docs/lessons/")) return []; // incident write-ups citing the count at the time
  if (repoPath.startsWith("tests/edge-cases/")) return []; // hand-verified tables; not live counts
  const findings: string[] = [];
  const lines = text.split(/\r\n|\n/);
  lines.forEach((line, idx) => {
    if (COUNT_PATTERN.test(line)) {
      findings.push(`${repoPath}:${idx + 1}: hardcoded test-count claim outside docs/STATUS.md: ${line.trim()}`);
    }
  });
  return findings;
}

// ---------------------------------------------------------------------------
// Check 3 — archive banner
// ---------------------------------------------------------------------------

function findMissingBanners(repoPath: string, text: string): string[] {
  if (!repoPath.startsWith("docs/archive/")) return [];
  if (repoPath === "docs/archive/README.md") return []; // the archive's own index, not archived content
  if (isBanneredHistorical(text)) return [];
  return [`${repoPath}:1: missing "> HISTORICAL" banner in the first 5 lines`];
}

function prependBanner(absPath: string, text: string): void {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const banner = `> **HISTORICAL** — archived doc; see docs/archive/README.md for context.${eol}${eol}`;
  writeFileSync(absPath, banner + text, "utf8");
}

// ---------------------------------------------------------------------------
// Check 4 — verify-command phrasing drift
// ---------------------------------------------------------------------------

// Known-good spellings (D7): `bash scripts/verify.sh`, `npm run verify`,
// `npm run verify:e2e`, `VERIFY_E2E=1 bash scripts/verify.sh`. Flag spellings that look
// like an attempt at the same command but got a detail wrong.
const STALE_VERIFY_PATTERNS: Array<{ pattern: RegExp; note: string }> = [
  { pattern: /VERIFY_E2E\s*=\s*true/i, note: 'VERIFY_E2E takes "1", not "true"' },
  { pattern: /npm\s+run\s+verify:all\b/, note: "no such alias — use `npm run verify` or `npm run verify:e2e`" },
  { pattern: /\b(?:yarn|pnpm)\s+verify\b/, note: "this repo uses npm, not yarn/pnpm" },
  { pattern: /vitest\s+--run\b/, note: "use `vitest run` (no leading `--`)" },
];

function findStaleVerifyPhrasing(repoPath: string, text: string): string[] {
  if (isArchived(repoPath)) return [];
  const findings: string[] = [];
  const lines = text.split(/\r\n|\n/);
  lines.forEach((line, idx) => {
    for (const { pattern, note } of STALE_VERIFY_PATTERNS) {
      if (pattern.test(line)) {
        findings.push(`${repoPath}:${idx + 1}: stale verify-command phrasing (${note}): ${line.trim()}`);
      }
    }
  });
  return findings;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const fixBanners = process.argv.includes("--fix-banners");
  const files = walkMarkdown(ROOT);
  const allFindings: string[] = [];

  for (const absPath of files) {
    const repoPath = toRepoPath(absPath);
    const text = readFileSync(absPath, "utf8");

    allFindings.push(...findPulseLeaks(repoPath, text));
    allFindings.push(...findHardcodedCounts(repoPath, text));
    allFindings.push(...findStaleVerifyPhrasing(repoPath, text));

    const missingBanners = findMissingBanners(repoPath, text);
    if (missingBanners.length > 0) {
      allFindings.push(...missingBanners);
      if (fixBanners) prependBanner(absPath, text);
    }
  }

  if (allFindings.length === 0) {
    console.log(`docs-lint: clean (${files.length} markdown files checked)`);
    return;
  }

  console.log(`docs-lint: ${allFindings.length} finding(s) across ${files.length} markdown files:\n`);
  for (const f of allFindings) console.log(`  - ${f}`);
  console.log();
  process.exitCode = 1;
}

main();
