# A plan doc's verdict is the authoring-time decision, not the current build state

**Hook:** reconcile a plan against STATUS + git before building from it — a section's
"build-later"/"needs-rework" verdict describes what was decided when it was written, and is NOT
updated when the feature ships.

At the #248 "continue", `AI_DIFFERENTIATION_PLAN.md` still carried "build-later" (§3.1),
"needs-rework" (§3.2, §3.4), and "build-later, bordering needs-rework" (§3.3) verdicts — yet all of
§3.1–§3.4 were already SHIPPED (#238/#239, #242, #247, #246). A fresh explorer, handed the plan doc,
faithfully read those verdicts and reported §3.1/§3.2 as the top *unbuilt* candidates. Two full
explorer passes were spent discovering, file by file, that the code already existed (the `source`
column, `provenance.ts`, the whole `/trust` page, `AuditLog`, the narrowed headline claim). The
first explorer wasn't wrong about the *doc*; the doc was stale about the *code*.

This is the same class the DECISIONS #242 index line already noted ("after the stale STATUS pointer
was corrected") — stale planning text has bitten more than once here.

**What to do:**
- **STATUS.md + git log are the source of truth for what's shipped.** A planning doc says what to
  build and why; it does not track completion. Before scoping from any plan verdict, grep the commits
  (`git log --oneline --all --grep=<feature>`) and the actual code (does the column/file/route exist?)
  and trust that over the verdict.
- **When you ship a feature the plan described, un-stale the plan in the same slice.** Tag the shipped
  section (a one-line "✅ SHIPPED (#NNN)" note above the old verdict) so the next session — or the
  next subagent handed only that doc — can't re-scope finished work. #248 did this for §3.1–§3.4.
- **Give an explorer the reconciliation job explicitly**, not just "read the plan." Ask "is this
  buildable NOW and NOT already shipped — verify against git and the code, the plan verdict may be
  stale," or it will report the doc's stale conclusion back to you with confidence.

Cheap tokens: one `git log --grep` per candidate up front would have replaced two explorer passes.
