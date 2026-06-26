# Backup & Recovery

*The note for "what survives if this machine's disk dies, and how to get it all back."*
Last updated 2026-06-26.

## TL;DR

Everything important lives in one of three clouds — none of which depends on the
dev machine's hard drive:

| What | Where | Survives a disk crash? |
|---|---|---|
| All code, tests, docs | GitHub `meleesciony/Aimplifi` (branch `main`) | ✅ yes |
| Live app | Vercel project `aimplifi` (team "Mike's projects") | ✅ yes |
| Production data | Neon Postgres (managed) | ✅ yes (Neon keeps its own backups) |
| Secrets (`.env.local`, `.env`) | Google Drive → **"Aimplifi — Crash Backup"** | ✅ yes (only off-machine copy) |
| Local dev DB (`dev.db`) | dev machine only (+ OneDrive sync) | ⚠️ regenerable from seed |
| `node_modules` / `.next` / generated | dev machine only | ♻️ regenerable (`npm install` + build) |

## Secrets backup (the one gap git can't cover)

Secrets are intentionally **not** committed. Their off-machine copy lives in Google
Drive, folder **"Aimplifi — Crash Backup"**
(<https://drive.google.com/drive/folders/1AAocdmDKMq3cfC_KxFpPJMyH25hY4LR7> — private;
only opens when signed in as michael.lee.p@gmail.com). It contains:

- **`env.local — Aimplifi SECRETS`** → restore to `.env.local`. The critical value is
  **`DATA_ENCRYPTION_KEY`**: if it's lost, every Plaid access token stored encrypted
  in the database becomes permanently undecryptable. The Plaid and xAI keys are
  re-fetchable from their dashboards; this key is not.
- **`env — Aimplifi dev defaults`** → restore to `.env` (dev defaults only, no prod secrets).

A password manager (1Password / Bitwarden) is the recommended long-term home for
`DATA_ENCRYPTION_KEY` and the xAI key; the Drive copy is the convenience/disaster copy.

## Restore from a dead machine

```bash
git clone https://github.com/meleesciony/Aimplifi
cd Aimplifi
npm install
# Download the two files from the Drive "Aimplifi — Crash Backup" folder into the
# repo root as .env.local and .env
npm run verify   # should pass
npm run dev
```

Production (Vercel) keeps running throughout — it deploys from GitHub and reads its
own env vars configured in the Vercel dashboard, independent of the dev machine.

## Keep it current

- `git push` after each green commit (that's the code backup).
- Re-upload `.env.local` to the Drive folder whenever a secret changes.
- Note: `keys/plaid_recovery_code.txt` is gitignored and, despite its name, is **not**
  a Plaid recovery code — it's a personal investment prompt. Don't rely on the name.
