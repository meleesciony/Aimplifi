# A junctioned worktree cannot build

**One-line summary:** a git worktree whose `node_modules` is a junction to the main checkout's runs
`tsc`, `eslint` and `vitest` fine, but `next build` fails — Turbopack refuses a `node_modules` that
points outside the project root — so Playwright then has no build to start. Build and e2e run in the
main tree.

## How it bit (2026-10-06, #789 fix cycle 2)

The main tree held the #791 ship, so #789's fix cycle was made in a second worktree
(`C:\dev\_maker_789`) with `node_modules` junctioned to `C:\dev\Aimplifi\node_modules` — the pattern
the critic worktrees use. Its `VERIFY_E2E=1 bash scripts/verify.sh` passed typecheck, lint and the
unit suite, then:

    Error [TurbopackInternalError]: Symlink [project]/node_modules is invalid, it points out of the
    filesystem root

and the E2E stage failed with "Could not find a production build in the '.next' directory". Half a
gate run was spent before the build stage reached it.

## The rule

- A junctioned worktree is for reading, `tsc`, `eslint`, `vitest` and scratch `tsx` probes — the
  critic's toolset. Do not plan a full `VERIFY_E2E=1` gate there.
- To gate work made in a junctioned worktree: commit it, release the branch (`git switch --detach` in
  the worktree), remove the junction link-only (`[IO.Directory]::Delete(path, $false)`), remove the
  worktree, and switch the main tree to the branch. Then gate there.
- Tell a critic in a junctioned worktree not to run `next build` or Playwright; give it the maker's
  gate output instead.
