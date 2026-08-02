import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  collectDecisionEntries,
  droppedNumbers,
  duplicateNumbers,
  nextDecisionNumber,
  parseDecisionHeading,
  parseDecisionRow,
  parseIndexNumbers,
} from "../../scripts/ledger-parse";

const ROOT = join(__dirname, "..", "..");
const DECISIONS = readFileSync(join(ROOT, "docs", "DECISIONS.md"), "utf8");
const DECISIONS_INDEX = readFileSync(join(ROOT, "docs", "DECISIONS_INDEX.md"), "utf8");

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
  it("indexes every decision in docs/DECISIONS.md, in both formats", () => {
    const entries = collectDecisionEntries(DECISIONS);
    const headings = DECISIONS.split(/\r?\n/).filter((l) => /^##\s*#\d+/.test(l)).length;
    const rows = DECISIONS.split(/\r?\n/).filter((l) => /^\|\s*\d+\s*\|/.test(l)).length;

    expect(headings).toBeGreaterThan(0); // the format this parser was blind to
    expect(rows).toBeGreaterThan(0); // the format it could already read
    expect(entries.length).toBe(headings + rows);
    expect(duplicateNumbers(entries)).toEqual([]);
  });

  it("leaves nothing in the committed index unaccounted for", () => {
    const entries = collectDecisionEntries(DECISIONS);
    expect(droppedNumbers(parseIndexNumbers(DECISIONS_INDEX), entries)).toEqual([]);
  });

  it("carries exactly one index row per decision", () => {
    const entries = collectDecisionEntries(DECISIONS);
    const indexed = parseIndexNumbers(DECISIONS_INDEX);
    expect(new Set(indexed).size).toBe(indexed.length); // no number indexed twice
    expect(indexed.sort((a, b) => a - b)).toEqual(entries.map((e) => e.num));
  });
});
