/**
 * One-shot ledger rotation (measurement node, not a gate): moves the eight
 * fully-closed wave sections out of TASKS.md verbatim into
 * docs/archive/TASKS_DONE_ARCHIVE.md, per the CLAUDE.md ledger-ceiling rule
 * and the 2026-08-28 closed-wave-preamble precedent. The live file keeps its
 * CRLF line endings; content is compared line-wise after the move.
 * Run: node scripts/rotate-tasks-2026-09-11.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

const tasksPath = 'TASKS.md';
const archivePath = 'docs/archive/TASKS_DONE_ARCHIVE.md';

const text = readFileSync(tasksPath, 'utf8');
const lines = text.split('\n');

// Section ranges are 1-based, inclusive at both ends (heading through the
// blank line before the next heading). Verified against the tree this commit
// is based on: every range contains zero task rows.
const moves = [
  { id: 'O', start: 125, end: 146 },
  { id: 'O.16', start: 147, end: 182 },
  { id: 'O.12', start: 221, end: 287 },
  { id: 'O.18', start: 441, end: 456 },
  { id: 'O.19 (totals)', start: 497, end: 520 },
  { id: 'C', start: 536, end: 574 },
  { id: 'G', start: 625, end: 630 },
  { id: 'O.19 (accounts)', start: 631, end: 645 },
];

// Sanity: headings sit exactly where the ranges say.
for (const m of moves) {
  const heading = lines[m.start - 1];
  if (!heading.startsWith('## Wave')) {
    console.error(`RANGE GUARD FAILED for ${m.id}: line ${m.start} is not a Wave heading: ${JSON.stringify(heading)}`);
    process.exit(1);
  }
}

const moved = moves.flatMap((m) => lines.slice(m.start - 1, m.end));

const keep = lines.filter((_, idx) => !moves.some((m) => idx + 1 >= m.start && idx + 1 <= m.end));

const archive = readFileSync(archivePath, 'utf8');
const marker = '<!-- moved 2026-09-11 from TASKS.md: closed waves O/O.16/O.12/O.18/O.19(totals)/C/G/O.19(accounts); rows already in the done-row table above; preambles moved verbatim per D.3 -->\n\n';
const nextArchive =
  archive.replace(/\n*$/, '\n\n') + marker + moved.join('\n').replace(/\n*$/, '\n');
writeFileSync(archivePath, nextArchive);

// Re-join without rewriting endings of kept lines: split on \n kept each
// line's own \r intact; the blank separator lines the ranges include end in \r,
// so joining with \n reproduces the original CRLF bytes exactly.
writeFileSync(tasksPath, keep.join('\n'));

console.log(`moved ${moves.length} sections, ${moved.length} lines; TASKS.md now ${keep.length} lines`);
