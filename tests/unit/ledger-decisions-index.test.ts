import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  collectDecisionEntries,
  collectFromSources,
  droppedNumbers,
  duplicateNumbers,
  nextDecisionNumber,
  parseDecisionHeading,
  parseDecisionRow,
  parseIndexNumbers,
  renderIndexBody,
} from "../../scripts/ledger-parse";

const ROOT = join(__dirname, "..", "..");
const DECISIONS = readFileSync(join(ROOT, "docs", "DECISIONS.md"), "utf8");
const DECISIONS_INDEX = readFileSync(join(ROOT, "docs", "DECISIONS_INDEX.md"), "utf8");

// Since the 2026-08-27 ledger rotation, decisions live in docs/DECISIONS.md PLUS
// verbatim archives (docs/archive/DECISIONS_ARCHIVE_*.md — the lower numbers). The
// index covers the union, so every assertion below must read the union too —
// reading the live file alone would report the archived numbers as "dropped".
const DECISIONS_ARCHIVE_DIR = join(ROOT, "docs", "archive");
const DECISIONS_ARCHIVES = readdirSync(DECISIONS_ARCHIVE_DIR)
  .filter((f) => /^DECISIONS_ARCHIVE_.*\.md$/.test(f))
  .sort()
  .map((f) => readFileSync(join(DECISIONS_ARCHIVE_DIR, f), "utf8"));
const ALL_DECISIONS = [DECISIONS, ...DECISIONS_ARCHIVES].join("\n");

describe("ledger-parse — heading-era decisions", () => {
  it("parses `## #n (phase): title`", () => {
    const heading = parseDecisionHeading(
      "## #338 (O.14a): a fault on our side may not be reported as a wrong password",
    );
    expect(heading).toEqual({
      num: 338,
      title: "(O.14a): a fault on our side may not be reported as a wrong password",
    });
  });

  it("parses `## #n (phase) — title` and `## #n — title` alike", () => {
    expect(parseDecisionHeading("## #345 (O.13e) — Category parity is three questions")?.num).toBe(
      345,
    );
    expect(parseDecisionHeading("## #384 — Median Fixed fallback unions uncovered recurring")).toEqual(
      { num: 384, title: "Median Fixed fallback unions uncovered recurring" },
    );
  });

  it("does not mistake a bare `## #n` for a titled one", () => {
    expect(parseDecisionHeading("## #354")).toEqual({ num: 354, title: "" });
  });

  it("ignores headings that are not decisions", () => {
    expect(parseDecisionHeading("## Phase 3 — the coach")).toBeNull();
    expect(parseDecisionHeading("### #338 nested")).toBeNull();
  });

  it("takes a bare heading's summary from its first bold body line, phase and all", () => {
    const entries = collectDecisionEntries(
      [
        "## #354",
        "",
        "**(W.1a) The wealth-target card renders its inputs, not just its answers.**",
        "",
        "Owner, 2026-07-31, looking at a $10,000,000 target.",
        "",
        "## #355 — next one",
      ].join("\n"),
    );
    expect(entries[0]).toEqual({
      num: 354,
      phase: "W.1a",
      summary: "The wealth-target card renders its inputs, not just its answers.",
    });
  });

  it("reads a LEADING parenthetical as the phase and never a trailing one", () => {
    const [leading, trailing] = collectDecisionEntries(
      ["## #340 (O.13c + critic cycle 1): Simplifi-parity rules", "", "## #384 — Median fallback (not Math.max)"].join(
        "\n",
      ),
    );
    expect(leading).toEqual({
      num: 340,
      phase: "O.13c + critic cycle 1",
      summary: "Simplifi-parity rules",
    });
    // The trailing `(not Math.max)` is part of the sentence, not a phase column.
    expect(trailing).toEqual({ num: 384, phase: "?", summary: "Median fallback (not Math.max)" });
  });
});

describe("ledger-parse — legacy table rows still parse", () => {
  it("keeps the phase column and unescapes pipes", () => {
    expect(parseDecisionRow("| 12 | Phase 2 | Money is integer cents \\| always |")).toEqual({
      num: 12,
      phase: "Phase 2",
      summary: "Money is integer cents | always",
    });
  });

  it("indexes a row missing its phase column as phase `?`", () => {
    expect(parseDecisionRow("| 165 | no phase column here |")?.phase).toBe("?");
  });

  it("returns null for a non-row", () => {
    expect(parseDecisionRow("Some prose about | pipes.")).toBeNull();
  });
});

describe("ledger-parse — guards", () => {
  it("reports a number defined in both formats rather than emitting it twice", () => {
    const entries = collectDecisionEntries(
      ["| 338 | Phase X | legacy row |", "", "## #338 — heading era"].join("\n"),
    );
    expect(duplicateNumbers(entries)).toEqual([338]);
  });

  it("names every number a regeneration would drop", () => {
    const entries = collectDecisionEntries("## #1 — kept");
    expect(droppedNumbers([1, 2, 3], entries)).toEqual([2, 3]);
  });

  it("is silent when nothing is lost", () => {
    expect(droppedNumbers([1], collectDecisionEntries("## #1 — kept\n\n## #2 — new"))).toEqual([]);
  });

  it("counts headings when picking the next decision number", () => {
    // The defect: reading only the table returns 338, a number #338 already used.
    const contents = ["| 337 | Phase Z | last table row |", "", "## #385 — newest heading"].join("\n");
    expect(nextDecisionNumber(contents)).toBe(386);
  });
});

describe("the real ledger", () => {
  it("reads at least one verbatim archive, so the union below cannot silently shrink", () => {
    // Guards the guard: if the archive glob ever matches nothing (renamed files,
    // moved directory), the union would quietly become the live file alone and the
    // no-loss invariant would weaken without a red test. Fail loudly instead.
    expect(DECISIONS_ARCHIVES.length).toBeGreaterThan(0);
  });

  it("indexes every decision in docs/DECISIONS.md and its archives, in both formats", () => {
    const entries = collectDecisionEntries(ALL_DECISIONS);
    const headings = ALL_DECISIONS.split(/\r?\n/).filter((l) => /^##\s*#\d+/.test(l)).length;
    const rows = ALL_DECISIONS.split(/\r?\n/).filter((l) => /^\|\s*\d+\s*\|/.test(l)).length;

    expect(headings).toBeGreaterThan(0); // the format this parser was blind to
    expect(rows).toBeGreaterThan(0); // the format it could already read
    expect(entries.length).toBe(headings + rows);
    expect(duplicateNumbers(entries)).toEqual([]);
  });

  it("leaves nothing in the committed index unaccounted for", () => {
    const entries = collectDecisionEntries(ALL_DECISIONS);
    expect(droppedNumbers(parseIndexNumbers(DECISIONS_INDEX), entries)).toEqual([]);
  });

  it("carries exactly one index row per decision", () => {
    const entries = collectDecisionEntries(ALL_DECISIONS);
    const indexed = parseIndexNumbers(DECISIONS_INDEX);
    expect(new Set(indexed).size).toBe(indexed.length); // no number indexed twice
    expect(indexed.sort((a, b) => a - b)).toEqual(entries.map((e) => e.num));
  });

  it("index lines are `#n — title → file` pointing at a file that exists and holds that number", () => {
    const archiveNames = readdirSync(DECISIONS_ARCHIVE_DIR).filter((f) =>
      /^DECISIONS_ARCHIVE_.*\.md$/.test(f),
    );
    const sources = [
      { file: "docs/DECISIONS.md", contents: DECISIONS },
      ...archiveNames.map((f) => ({
        file: `docs/archive/${f}`,
        contents: readFileSync(join(DECISIONS_ARCHIVE_DIR, f), "utf8"),
      })),
    ];
    const byNum = new Map(collectFromSources(sources).map((e) => [e.num, e.file]));
    const lines = DECISIONS_INDEX.split(/\r?\n/).filter((l) => /^- #\d+ — /.test(l));
    expect(lines.length).toBe(byNum.size);
    for (const line of lines) {
      const match = line.match(/^- #(\d+) — .+ → (docs\/\S+)$/);
      expect(match, line).not.toBeNull();
      const num = Number(match![1]);
      const file = match![2];
      expect(existsSync(join(ROOT, file)), file).toBe(true);
      expect(byNum.get(num)).toBe(file);
    }
  });
});

describe("ledger-parse — index format", () => {
  it("parseIndexNumbers reads the pre-D.2 bold-prose lines and the D.2 one-line form", () => {
    // The anti-deletion lock must still see today's numbers on the first
    // regenerate after a format change — a parser that only matched the new
    // shape would return [] against the old index and the lock would go silent.
    expect(
      parseIndexNumbers(
        [
          "- **#12** (Phase 0): Money = integer cents | Auditability",
          "- #13 — Business dates are date-only → docs/archive/DECISIONS_ARCHIVE_1_to_401.md",
          "# Decisions Index",
          "- #14 — next → docs/DECISIONS.md",
        ].join("\n"),
      ),
    ).toEqual([12, 13, 14]);
  });

  it("renderIndexBody emits `#n — title → file`, strips a trailing `| rationale`, and refuses a missing file", () => {
    expect(
      renderIndexBody([
        {
          num: 12,
          phase: "0",
          summary: "Money = integer cents | Auditability; floats forbidden",
          file: "docs/archive/DECISIONS_ARCHIVE_1_to_401.md",
        },
        {
          num: 524,
          phase: "P",
          summary: "C5 time-window-of-life line on the life-energy card",
          file: "docs/DECISIONS.md",
        },
      ]),
    ).toEqual([
      "- #12 — Money = integer cents → docs/archive/DECISIONS_ARCHIVE_1_to_401.md",
      "- #524 — C5 time-window-of-life line on the life-energy card → docs/DECISIONS.md",
    ]);
    expect(() =>
      renderIndexBody([{ num: 1, phase: "0", summary: "no file" }]),
    ).toThrow(/#1 has no source file/);
  });
});
