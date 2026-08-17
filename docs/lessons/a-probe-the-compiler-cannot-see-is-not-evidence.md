# A probe the compiler cannot see is not evidence

**Summary:** a measurement script that `tsc --noEmit` never compiles can ship a wrong call as a recorded dollar figure. If the gate cannot see the file, the number is not evidence.

## How it bit (G.2 / O.20k)

`scripts/audit-probes/**/*.mts` sat outside `tsconfig.json`'s `**/*.ts` include. The O.20g probe called `keep({accountId, date})` where `reconciliationTxnKeepFilter` returns `(accountId, date) => boolean`. The object failed every keyed lookup and the closure returned `true` for every row, so DECISIONS #445's magnitudes double-counted every reconciled pair. The same shape appeared in O.20a's first draft. Both were invisible to the Definition-of-Done gate.

G.2's first compile then found the sibling: `inScope.filter(countsInFlows)` binds the array index as `excludedFlowIds`. That is the same class — a second argument the callee did not mean, which JavaScript will happily pass.

## The rule

A probe that writes a number into a decision, a task row, or STATUS must compile under the same gate as the code it measures. `tsconfig.probes.json` + `verify.sh`'s probes tsc stage are that gate. A type error that reveals a wrong call means the cited output is unverified until the probe is re-run.
