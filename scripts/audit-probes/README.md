# Seamlessness probes (#166)

Plain-paced Playwright probes that catch what the Pixel-5-paced e2e suite outruns
(the #164/#166 action-application race; the Next 15.5 flight-application bug).
Run against a production server on 127.0.0.1:3100 with a freshly seeded demo DB:

    DATABASE_URL="file:$TEMP/aimplifi-audit.db" npx prisma db push --accept-data-loss
    DATABASE_URL=... npx tsx scripts/set-sqlite-wal.ts && DATABASE_URL=... npx prisma db seed
    DATABASE_URL=... XAI_API_KEY= ANTHROPIC_API_KEY= npx next start -p 3100 &
    npx tsx scripts/audit-probes/<probe>.ts

- calendar-month-nav.ts — 7 month-paging transitions must all COMMIT (Next 15.5 failed 5/7).
- budget-mutation.ts — set→clear→set must be deterministic (env: SW=0 blocks the service
  worker, SOFT=1 soft-navigates, PIXEL=1 emulates Pixel 5, CHAN=chrome uses branded Chrome).
- goal-budget-mutation.ts — goal add ("$1,234" lenient) / delete / "abc" inline error + budget flows.
- budget-invalid-input.ts — "abc" must show the inline error with BOTH fields preserved, no crash.
- transactions-first-action.ts — fresh session per control: filter/pagination/Import/search must work.

Reseed the DB between runs (wedged runs leave residue that fakes alternating results —
see docs/lessons/diagnose-hangs-at-boundaries.md).
