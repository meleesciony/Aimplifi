# Mutation forms use onSubmit, never useActionState

**Hook:** In this app a client mutation form uses a plain `onSubmit` (own `busy` useState +
`withDeadline` + inline errors + reload/navigate on success) — NOT `useActionState`/`<form action={fn}>`.
`useActionState`'s React-19 auto-reset silently reverts uncontrolled `<select>`s to their first option on
the validation-error return, which for an account/category picker is a silent MIS-FILE, and its `pending`
can wedge on the Next action-application race. This bit #166 (goal/budget forms) and bit again in #170
(add-transaction) when the recipe was re-derived from scratch.

## Why (the trap)

`<form action={fn}>` — including the dispatch from `useActionState` — schedules an unconditional
`requestFormReset` on every submit (verified in the react-dom-client source). When the action *returns*
(the error path, no `redirect`), the transition commits and React resets the form's **uncontrolled**
fields to their `defaultValue`:

- text inputs with no `defaultValue` → cleared;
- a `<select>` with no matching `defaultValue` → snaps back to the **first** option.

For add-transaction that means: user picks "Savings", typos the amount, submits → inline error renders
**and the account reverts to the first account** → the corrected resubmit files the transaction to the
WRONG account. Echoing the submitted values back as `defaultValue` was tried and did **not** reliably
restore the `<select>` across the reset (proven by an e2e that failed at
`expect(account).toHaveValue(chosen)`).

## The recipe that works (see `src/components/finance/goal-form.tsx`)

A plain `onSubmit` never triggers React's form reset, so uncontrolled inputs are **untouched on failure —
nothing to restore**:

```tsx
async function onSubmit(e) {
  e.preventDefault();
  if (busy) return;                       // double-submit guard
  const fd = new FormData(e.currentTarget);
  setBusy(true);
  try {
    const res = await withDeadline(action(null, fd), FORM_ACTION_DEADLINE_MS);
    setResult(res);
    if (res.ok) { window.location.assign('/dest'); return; }  // busy stays true — page is leaving
    setBusy(false);                       // inline errors render; inputs preserved
  } catch (e) {
    if (e instanceof ActionDeadline) { window.location.assign('/dest'); return; } // write likely committed
    setResult({ ok: false, errors: ['Something went wrong — please try again.'] }); // real failure: surface, stay
    setBusy(false);
  }
}
```

Server action: validate at the boundary and **return** `{ ok, errors }` — never `throw` (a throw hits the
app error boundary and nukes the page + input). Wrap engine validators that throw (e.g.
`prepareManualTransaction` → `centsFromDollarString`/`isoDate` throw on bad amount/date) in try/catch and
map to a friendly, non-leaky string. On success, `return { ok: true }` and let the CLIENT navigate (a full
`window.location.assign` can't show stale state) — don't `redirect()` from the action if you want the
onSubmit result back.

## Not every surface needs converting

Judge each surface (LOOP rule 3): only convert one with a real same-page stale-UI or error-boundary
defect. `import-csv` was correctly LEFT on `useActionState` in #170 — it renders a self-contained inline
imported/skipped/per-row-error report with no same-page stale list, so it already satisfies the invariant;
flash+reload would regress the per-row report. (Its latent account-select reset is milder there — rows are
filed server-side with the correct account before the reset, so no mis-file.)

## Verify the reset behavior with an e2e, don't assume

The regression lock that catches this: select a NON-default option, submit bad input, assert the option
(and typed fields) survive the error. A `useActionState` form fails it; an `onSubmit` form passes.

## The same family: a CONTROLLED input loses text typed before hydration (#216)

Same root principle, different mechanism — **React state that hydration can clobber must never be the
source of truth for what the user typed.** The register's search box was controlled
(`value={search}` from `useState`, plus a `useEffect(() => setSearch(current.search), [current.search])`
resync). Text entered before hydration attached `onChange` never reaches React state, so the first
render blanks the DOM box; the submit handler then reads a stale `''` and pushes the UNFILTERED URL.
Because that URL equals the current one, the navigation doesn't even commit — the query vanishes with
no error and the user is left staring at an unfiltered list that looks like a legitimate result.

Fix: let the DOM own the typed text — uncontrolled `name="q"` + `defaultValue`, `key={current.search}`
so a URL-driven change (Clear) remounts it, and read the live value at submit:

```tsx
onSubmit={(e) => { e.preventDefault();
  const typed = new FormData(e.currentTarget).get('q');
  commit({ search: typeof typed === 'string' ? typed : '' });
}}
```

Two tells worth generalizing:
- A `react-hooks/set-state-in-effect` eslint-disable on a "keep local state in sync with props" effect is
  a smell, not a formality. This one carried a "not this increment's scope" comment from #166 and was the
  bug two increments later.
- **A slow-hydration failure hides in the slowest project.** It reproduced deterministically only on
  `mobile-380` and only for the search whose result set was empty (the URL was unchanged either way, so a
  non-empty result masked it). Don't dismiss a mobile-380-only failure as the viewport flake — that flake's
  signature is `intercepts pointer events`, nothing else.
