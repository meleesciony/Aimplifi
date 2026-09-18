# Ops walkthrough (first-timer)

Owner-approved 2026-09-18 (DECISIONS #751). One action per numbered step.
Labels below come from the live app code, Neon docs, Vercel docs, or Sentry docs —
not from a remembered screenshot. If a label on your screen is different, stop
and use the words you see.

This VM cannot run the two live-data writes: it has no `DATABASE_URL` and will
not decrypt Vercel env values. You do those two on your machine / in the live
app. Do **not** paste `DATABASE_URL`, a Sentry DSN, or any other secret into
chat.

Do **not** set `DATA_PROVIDER=plaid`. Do **not** run `prisma db seed` against
production.

---

## A. Neon History window (TASKS 0.6)

Neon already keeps managed backups. This step only sets how far back Instant
restore can reach. Official steps:
<https://neon.com/docs/introduction/history-window>

1. Open <https://console.neon.tech> in your browser.
2. Sign in with the same GitHub account you used for Neon.
3. Click the Aimplifi / Pulse production **project** (the one Vercel uses).
4. Click **Settings**.
5. Click **Instant restore**.
6. Under **History window**, move the slider as far right as your plan allows.
   Neon’s published caps: Free **6 hours**, Launch **7 days**, Scale **30 days**.
   Do not set the slider to zero — that turns Instant restore off.
7. Click **Save**.

You are done when the page keeps the value you saved after a refresh.

You do **not** need to click **Restore** today. Restore overwrites every
database on that branch. Only use it if data is actually lost.

---

## B. Prove Vercel cron jobs fire (TASKS 0.3)

The six jobs are already listed in `vercel.json` (times are UTC):

| Path | When |
|---|---|
| `/api/cron/sync` | every day at 11:00 |
| `/api/cron/reminders` | every day at 12:00 |
| `/api/cron/notify` | every day at 13:00 |
| `/api/cron/digest` | Monday at 14:00 |
| `/api/cron/audit` | Monday at 15:00 |
| `/api/cron/vocab` | Monday at 16:00 |

On Hobby, Vercel may fire a daily job **any minute inside that hour**.
Hobby runtime logs keep about **one hour**, so you cannot prove a 11:00 UTC
fire at 17:00 UTC. Wait until a little after 11:00 UTC (7:00 AM Eastern
Daylight Time).

Official “where to look” page: <https://vercel.com/docs/cron-jobs/manage-cron-jobs>

1. Open <https://vercel.com/dashboard>.
2. Open the **aimplifi** project (team **reiforge**).
3. In the project sidebar, click **Settings**.
4. Click **Cron Jobs**.
5. Confirm you see those six paths. If a row is disabled, do not click
   **Disable Cron Jobs**.
6. Stay on this page until a little after 11:00 UTC.
7. On the `/api/cron/sync` row, click **View Logs**.
8. You should land on runtime logs already filtered to that path
   (`requestPath:/api/cron/sync`). A fire is proven when you see a request
   to `/api/cron/sync` with status **200** (not 401).
9. Optional: repeat **View Logs** for `/api/cron/reminders` after 12:00 UTC
   and `/api/cron/notify` after 13:00 UTC.

A 401 means `CRON_SECRET` on Vercel does not match what the route expects.
Do not paste the secret. Compare only that the **name** `CRON_SECRET` exists
under **Settings → Environment Variables** for **Production**.

Checked from this VM on 2026-09-18: the last 24 hours of production runtime
logs had **zero** `/api/cron/*` lines. That does **not** prove the jobs are
broken — Hobby had already dropped the morning fires. Treat fire as
**UNVERIFIED** until you see a 200 in **View Logs**.

---

## C. Turn on Sentry (TASKS 0.3)

The app is already wired. No SDK wizard. Do **not** run
`npx @sentry/wizard`. A missing `SENTRY_DSN` is a safe no-op
(`src/lib/errors.ts`). Sentry’s free Developer plan is enough for a
household app (DECISIONS #203 deferred paid tracking; this step only
sets the DSN).

Official create-project note: go to **Projects**, click **Create Project**,
then read the DSN under the project’s **Client Keys (DSN)** settings
(<https://docs.sentry.io/product/accounts/getting-started/>).

1. Open <https://sentry.io> and sign in (or create a free account).
2. Click **Projects**.
3. Click **Create Project**.
4. Choose **Next.js** as the platform.
5. Name it `aimplifi`.
6. Finish creating the project. If a setup wizard appears, copy the **DSN**
   and skip installing packages.
7. If you left that screen: **Settings → Projects → aimplifi → Client Keys (DSN)**.
   Copy the DSN. It looks like `https://…@….ingest.sentry.io/…`.
8. Open Vercel → **aimplifi** → **Settings** → **Environment Variables**.
9. Click to add a variable.
10. In **Key**, type exactly `SENTRY_DSN` (all caps).
11. In **Value**, paste the DSN. Do not paste it into chat.
12. Tick **Production** only.
13. Click **Save**.
14. Open **Deployments**.
15. On the newest Production deployment, open the **⋯** menu.
16. Click **Redeploy**. Env vars apply only to a deploy that **starts after**
    you saved them.
17. Wait until that deploy shows **Ready**.
18. Open <https://www.aimplifi.app> and sign in as yourself (not
    **Explore the demo**).
19. Tap **Settings** in the nav.
20. Scroll to the card titled **Activation checklist** (subtitle:
    **Operator — which integrations are live on this deployment**).
21. Find the row **Error tracking (Sentry)**. It should say **Live**, not
    **Dormant**. If it still says **Dormant**, the new deploy has not
    picked up the variable — confirm the name is exactly `SENTRY_DSN` and
    Redeploy once more.

---

## D. Undo the nine wrong Combined-accounts links (TASKS U.15 (b))

This is your real money. Each tap is reversible later only by combining the
two accounts again. Undo **only** a row that shows the yellow
**Worth a look:** sentence. Leave every other Combined-accounts row alone
(those are GENUINE or UNTESTABLE).

There is **no confirm dialog**. One tap writes `undoneAt` and shows
**Undone — that old account counts on its own again.**

1. Open <https://www.aimplifi.app> and sign in as yourself. Do **not** click
   **Explore the demo**.
2. Tap **Accounts** in the nav (page title **Accounts**).
3. Scroll to the card whose small heading is **Combined accounts** and whose
   title is **One balance per date**.
4. Look for a yellow box that starts with **Worth a look:**. That is one of
   the nine. The button next to it is labelled **Undo**, **Undo: {name}**,
   or **Undo old account N: {name}**.
5. Tap that **Undo** button.
6. Confirm the toast **Undone — that old account counts on its own again.**
7. Repeat steps 4–6 for every remaining **Worth a look:** row. Stop when
   none are left.
8. If a row has no **Worth a look:** box, leave its Undo alone.

The old account’s balance starts counting on its own again. Nothing else
about those two accounts changes.

---

## E. Seed demo investment holdings (TASKS O.20e)

This writes **only** the five demo holdings onto the demo brokerage account
`acct-brokerage`, and only if that account exists and is type INVESTMENT.
It deletes nothing. Do **not** run `npx prisma db seed`.

Run this on `C:\dev\Aimplifi` (or another checkout that already has the
production URL in the gitignored file `.env.prod.tmp`). Never paste the
URL into chat.

### If `.env.prod.tmp` is already on disk

In **PowerShell**:

1. Open PowerShell.
2. Type `cd C:\dev\Aimplifi` and press Enter.
3. Confirm the file exists: `Test-Path .env.prod.tmp` — it must print
   `True`. If it prints `False`, use the next subsection.
4. Load the URL into this terminal only (it will not print the value):

   ```powershell
   Get-Content .env.prod.tmp | ForEach-Object {
     if ($_ -match '^DATABASE_URL=(.*)$') {
       $env:DATABASE_URL = $matches[1].Trim().Trim('"').Trim("'")
     }
   }
   ```

5. Type `npm run seed:demo-holdings` and press Enter.
6. Success looks like:
   `Upserted 5 demo holding(s) onto "…" (acct-brokerage). Nothing else was touched.`
7. Close that PowerShell window so the URL does not sit in the session.
8. Open <https://www.aimplifi.app>, click **Explore the demo**, then open
   **Investments**. The empty `investments-empty` state should be gone.

If the script says `No account with id "acct-brokerage"` or
`not INVESTMENT`, it wrote nothing. Stop and say so — do not pass
`--account` at a real (non-demo) id.

### If `.env.prod.tmp` is missing

1. Open Vercel → **aimplifi** → **Settings** → **Environment Variables**.
2. Find the row whose name is `DATABASE_URL`.
3. Copy its value into the terminal only. Do not paste it into chat, email,
   or a git-tracked file.
4. In a **new** PowerShell window:

   ```powershell
   cd C:\dev\Aimplifi
   $env:DATABASE_URL = "paste-once-here"
   npm run seed:demo-holdings
   ```

5. Close the window when it finishes.
6. Check **Explore the demo → Investments** as in the previous subsection.

---

## After you finish

Reply with what you saw, in plain words:

- Neon: the History window value after Save.
- Cron: whether `/api/cron/sync` **View Logs** showed a 200 (or that you
  have not waited until 11:00 UTC yet).
- Sentry: whether **Error tracking (Sentry)** on Settings says **Live**.
- Combined accounts: how many **Worth a look:** Undos you tapped, and
  whether any toast failed.
- Holdings: the exact `Upserted …` line, or the refuse-to-write line.
