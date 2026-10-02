# `git stash pop` takes whatever is on top — never chain it behind a push you did not verify

**One line:** `git stash push -- <two files> | tail -1 && git merge --ff-only … && git stash pop` ran
the pop after the push had FAILED ("Cannot save the current worktree state"), so the pop reached for
the top of a stash list that already held six of other sessions' parked work — on a checkout
carrying an 11,000-line uncommitted slice. Git refused the apply. Nothing but that refusal stood
between one line of shell and someone else's month-old WIP landing on top of unshipped work.

## What happened (2026-10-02, after shipping U.1a from a separate worktree)

The main checkout was one commit behind `origin/main` and held the unshipped Ask-analyst slice. Two
of its dirty files (`PROGRESS.md`, `docs/STATUS.md`) were also changed by the incoming commit, so a
fast-forward needed them out of the way. The plan was stash those two, fast-forward, pop.

Three things were wrong with the command, and each alone would have been survivable:

1. **The exit status that gated the chain was `tail`'s.** `git stash push … | tail -1 && …` continues
   whenever `tail` succeeds, which is always. The stash failure was printed and ignored.
2. **`git stash pop` names no stash.** It means "the newest entry", and this repository's stash list
   is shared by every worktree and every session that ever parked something.
3. **Nobody had looked at `git stash list` first.** It held six entries, the top one labelled
   "ORPHANED V.1 start…".

What made it recoverable was done BEFORE the command, not after: a full `git diff HEAD` patch,
copies of the two overlapping files, and a `sha1sum` of every other dirty file. The post-mortem was
one `sha1sum -c` and two `cmp`s — 43 of 43 identical, both ledgers identical — instead of an
afternoon of archaeology.

## The rules

1. **Snapshot before you touch a checkout that holds someone's uncommitted work**: the full patch,
   a copy of each file you will rewrite, and a hash of every other dirty file. Then "did I break
   anything?" is a command, not a judgment.
2. **Do not use the stash to move work across a pull in a shared repository.** It is a global,
   positional stack. Build the merged file off to the side (`git merge-file` on copies: ours, the
   old base, theirs), check it, then set the file to HEAD, fast-forward, and copy the result in.
   Every step is inspectable and none of them is "whatever is on top".
3. **If a stash is unavoidable, address it by identity**: `git stash push -m <unique>` then
   `git stash list | grep <unique>` to get its ref, and `git stash pop <that ref>` — never a bare pop.
4. **A pipeline's exit status is the last command's.** `cmd | tail && next` gates `next` on `tail`.
   For a state-changing step, run it bare and read its own exit code before the next one starts
   (`proof-is-the-full-output.md` is the same rule for gates).
5. **One state-changing action per command when the tree is not yours.** Chaining saves a round
   trip and removes the one moment at which the failure could have been read.
