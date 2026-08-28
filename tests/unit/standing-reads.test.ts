/**
 * D.3 standing-read locks — lessons INDEX is one ≤220-char line per lesson
 * file; EDGE_CASES.md is an index into tests/edge-cases/; closed TASKS waves
 * do not occupy the live queue.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const MAX_INDEX_LINE = 220;
const LESSONS = join(ROOT, "docs", "lessons");
const INDEX = readFileSync(join(LESSONS, "INDEX.md"), "utf8");
const EDGE_INDEX = readFileSync(join(ROOT, "docs", "EDGE_CASES.md"), "utf8");
const EDGE_DIR = join(ROOT, "tests", "edge-cases");
const TASKS = readFileSync(join(ROOT, "TASKS.md"), "utf8");

describe("lessons INDEX (D.3)", () => {
  const lessonFiles = readdirSync(LESSONS).filter((f) => f.endsWith(".md") && f !== "INDEX.md");
  const entryLines = INDEX.split(/\n/).filter((l) => l.startsWith("- ["));

  it("every lesson file has exactly one INDEX line in - [title](file.md) — hook form", () => {
    const linked = entryLines.map((l) => {
      const m = l.match(/^- \[.+?\]\(([^)]+\.md)\) — /);
      expect(m, l).not.toBeNull();
      return m![1];
    });
    expect(new Set(linked).size).toBe(linked.length);
    expect([...linked].sort()).toEqual([...lessonFiles].sort());
  });

  it("every INDEX lesson line is a single line ≤220 chars", () => {
    const lines = INDEX.split(/\n/);
    const firstEntry = lines.findIndex((l) => l.startsWith("- ["));
    expect(firstEntry).toBeGreaterThan(0);
    for (const line of lines.slice(firstEntry)) {
      if (!line.trim()) continue;
      expect(line.startsWith("- ["), `wrapped INDEX entry: ${line.slice(0, 80)}`).toBe(true);
      expect(line.length, line.slice(0, 80)).toBeLessThanOrEqual(MAX_INDEX_LINE);
    }
  });
});

describe("EDGE_CASES index (D.3)", () => {
  it("docs/EDGE_CASES.md is an index, not the dump", () => {
    expect(EDGE_INDEX).toMatch(/tests\/edge-cases\//);
    expect(EDGE_INDEX).not.toMatch(/^## §Cash-Needed Engine$/m);
    expect(statSync(join(ROOT, "docs", "EDGE_CASES.md")).size).toBeLessThan(20_000);
  });

  it("every tests/edge-cases file is listed exactly once and starts with a ## heading", () => {
    const files = readdirSync(EDGE_DIR).filter((f) => f.endsWith(".md")).sort();
    expect(files.length).toBeGreaterThan(50);
    const listed = [...EDGE_INDEX.matchAll(/\]\(\.\.\/tests\/edge-cases\/([^)]+\.md)\)/g)].map((m) => m[1]);
    expect([...listed].sort()).toEqual(files);
    expect(new Set(listed).size).toBe(listed.length);
    for (const f of files) {
      const body = readFileSync(join(EDGE_DIR, f), "utf8");
      expect(body.startsWith("## "), f).toBe(true);
      expect(existsSync(join(EDGE_DIR, f))).toBe(true);
    }
  });
});

describe("TASKS closed-wave preambles (D.3)", () => {
  it("live TASKS.md no longer carries empty closed-wave headings", () => {
    expect(TASKS).not.toMatch(/^## Wave 1 —/m);
    expect(TASKS).not.toMatch(/^## Wave P —/m);
    expect(TASKS).not.toMatch(/^## O\.17 residuals/m);
    expect(TASKS).not.toMatch(/^## Wave D —/m);
  });
});
