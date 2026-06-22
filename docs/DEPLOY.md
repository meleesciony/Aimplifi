# Deploying Pulse Finance for real users (you + spouse + testers)

This gets the app off your laptop and onto the web, so each person logs in from
their own device and sees only their own money. It uses **Vercel** (hosting, free)
+ **Neon** (shared Postgres database, free) — the repo is already wired for exactly
this (DECISIONS #35). Budget ~20 minutes.

The app runs on SQLite locally and **switches to Postgres automatically** when
`DATABASE_URL` is a `postgres://` URL — no code change. The Vercel build derives a
Postgres schema, pushes it, then builds (`vercel.json`).

---

## 0. Prerequisites

- The code in a **GitHub repo** (private is fine).
- A free **Vercel** account (sign in with GitHub).
- A free **Neon** account (sign in with GitHub).

## 1. Push the code to GitHub

From the project folder:

```bash
git push    # to a GitHub repo you own (create one first if needed)
```

## 2. Create the shared Postgres database (Neon)

1. Neon → **New Project** → name it `pulse` (any name). Region close to you.
2. After it provisions, open **Connection Details**.
3. **Copy the DIRECT connection string — NOT the pooled one.** Pick the endpoint
   **without** `-pooler` in the host. (PgBouncer's pooled endpoint breaks
   node-postgres prepared statements.) It looks like:
   ```
   postgresql://USER:PASSWORD@ep-xxxx.REGION.aws.neon.tech/pulse?sslmode=require
   ```
   Keep `?sslmode=require`. This is your `DATABASE_URL`.

## 3. Import the project into Vercel

Vercel → **Add New… → Project** → import your GitHub repo. Framework
auto-detects as **Next.js**. Don't deploy yet — set the environment variables
first (next step), otherwise the first build has no database.

## 4. Set environment variables (Vercel → Project → Settings → Environment Variables)

Add these for the **Production** environment (and Preview if you want preview
deploys to work):

| Variable | Value | Notes |
|---|---|---|
| `DATABASE_URL` | the Neon **direct** string from step 2 | switches the app to Postgres |
| `AUTH_SECRET` | `W3YWKRtXxKZh9e9B4ZqLOWBguQYVlUkqirDVn0lMPaE=` | session signing — provided for you; or regenerate with `npx auth secret` |
| `DATA_ENCRYPTION_KEY` | `j79g/xBZ+myb6255ZxlUKZFpxNdNaDdSK9q3lxtsWHY=` | encrypts Plaid/SimpleFIN tokens at rest; set it now so bank-connect works later |
| **`SIGNUP_ALLOWLIST`** | **`you@email.com, wife@email.com, tester1@email.com`** | **⚠️ THE invite-only gate — see below** |

> ### ⚠️ The single most important step
> **If you do not set `SIGNUP_ALLOWLIST`, signup is OPEN — anyone who finds the URL
> can create an account.** The allowlist is dormant by default (so local dev and
> the test suite work without it). Put every invited person's email in it,
> comma-separated. You can also allow a whole domain with `@example.com`. Only the
> emails/domains you list can create an account; everyone else is refused at
> signup. (Existing accounts always keep working — to fully cut someone off,
> delete their account, don't just remove them from the list.)

**Do NOT set `DEMO_TODAY` in production.** Leaving it unset is what gives real
users the real calendar date (DECISIONS #58). The "Explore the demo" account still
shows its seeded dataset coherently regardless.

Optional, add only if/when you want the feature:

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | LLM-assisted categorization of unknown merchants (otherwise the deterministic categorizer runs) |
| `CRON_SECRET` | protects the `/api/cron/*` sweep routes if you wire Vercel Cron |
| `RESEND_API_KEY` + `REMINDER_FROM_EMAIL` | actually send payment-reminder emails (otherwise reminders show in-app only) |

## 5. Deploy

Click **Deploy**. The build runs `node scripts/gen-pg-schema.mjs` → `prisma
generate` → `prisma db push` (creates the tables in Neon) → `next build`. When it
finishes you get a URL like `https://your-app.vercel.app`.

## 6. (Optional) seed the demo account

The "Explore the demo" button needs the seeded dataset to exist in the Neon DB. If
you want it populated (purely fictional data), run once from your laptop against
the **same** Neon URL:

```bash
DATABASE_URL="postgresql://…/pulse?sslmode=require" npx prisma db seed
```

If you'd rather not offer a demo at all, you can skip this — real signups don't
need it.

## 7. First logins + the privacy check

1. Open the URL. Click **Create account**, sign up with your allowlisted email.
2. Have your wife do the same with hers (from her own device).
3. Confirm the isolation: add an account on your login; it must **not** appear on
   hers, and vice-versa. (This is the property pinned by the data-isolation test in
   `tests/unit/auth-actions.test.ts`, but verify it live too.)
4. Try signing up with an email **not** on the allowlist → it should be refused.

## Adding or removing testers later

Edit `SIGNUP_ALLOWLIST` in Vercel → Settings → Environment Variables, then
**redeploy** (Deployments → ⋯ → Redeploy) so the new value takes effect. Env-var
changes don't apply until a redeploy.

## Good-to-know / honest caveats

- **Bank connections still need their own setup.** SimpleFIN
  (docs/SIMPLEFIN_WALKTHROUGH.md) and Plaid (docs/PLAID_WALKTHROUGH.md) each
  activate per their own docs once deployed; the SimpleFIN live network path is
  still UNVERIFIED until run against a real server. CSV import and manual entry
  work immediately with zero setup.
- **Secrets:** the `AUTH_SECRET` / `DATA_ENCRYPTION_KEY` above were generated for
  you and are now in this file/your chat — fine to use, but if you want them
  private to you, regenerate (`npx auth secret`; `openssl rand -base64 32`) and
  paste your own. **Never commit real secrets to git.** Changing
  `DATA_ENCRYPTION_KEY` later makes previously-stored bank tokens undecryptable
  (users just reconnect).
- **Cost:** Vercel Hobby + Neon free tier cover a household + a handful of testers
  at $0. Watch Neon's storage/compute limits only if usage grows.
- **Free-tier database sleep:** Neon's free compute may cold-start after idle, so
  the first request in a while can be slow. Harmless.
