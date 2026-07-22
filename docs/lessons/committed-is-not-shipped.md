# Committed is not shipped — and an unpushed branch silently falsifies diagnoses

`main` was **8 commits ahead of `origin/main`** for four sessions (#257–#261). Every
one of those sessions ended with a green verify and a commit, and every one of them
reported itself as done. None of the work existed anywhere but one laptop.

The owner found it, not the agent, and the way they found it is the lesson: they
asked why they could not see the password reveal (#258) that had been built and
"shipped" the day before. It had never left the machine.

## The expensive part was not the delay

Production was pinned at `9e3e56f` (#257). The previous session had recorded a
leading hypothesis for an owner-reported password bug — that #258's `type` flip
broke the browser's save prompt — and this session shipped a fix for it. **#258 was
never live on the deployed site**, so that hypothesis could not explain anything the
owner experienced there. The whole diagnostic frame rested on an unchecked
assumption that local `HEAD` was what the owner was using.

CLAUDE.md rule 0 says never assert a cause without checking the evidence. "Which
code is the user actually running" is part of that evidence, and it is one command:

```
git status -sb          # ahead/behind
git log --oneline origin/main..main
```

## Rules that came out of it

1. **Commit, push, deploy, then verify live — before asking the owner to check
   anything.** This is now CLAUDE.md rule 5, at the owner's explicit instruction.
2. **A status code is not a verification.** The previous deployment serves `200`
   just fine. Fetch the live route and grep for a marker unique to the change —
   a new `data-testid`, a new `aria-label`:
   `curl -s https://www.aimplifi.app/sign-in | grep 'auth-password-toggle'`.
   Vercel's deployment record also carries `githubCommitSha`, which says exactly
   which commit is serving traffic.
3. **Before diagnosing anything the owner reports on the deployed app, establish
   what is deployed.** If the suspect commit is not in production, the suspect is
   not the cause — for that surface.
4. **Check `git diff origin/main..main --stat -- prisma/` before pushing.** A schema
   diff means `prisma db push` runs against the live database on deploy; no diff
   means the push is code-only.
