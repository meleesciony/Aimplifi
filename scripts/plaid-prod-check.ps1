# scripts/plaid-prod-check.ps1
# One-command, paste-safe wrapper around `npm run plaid:prod-check`.
#
# Prompts for the Plaid PRODUCTION client_id + secret at console prompts (the
# secret is hidden), runs the credential check, and ALWAYS wipes the env vars
# afterward. The secret is never written to disk, never committed, never echoed.
#
# Run it (from anywhere) with:
#     pwsh -ExecutionPolicy Bypass -File "C:\Users\micha\OneDrive\Documents\Pulse Finance\scripts\plaid-prod-check.ps1"
#
# Works on both Windows PowerShell 5.1 and PowerShell 7.

$ErrorActionPreference = 'Stop'

# Resolve the project root from THIS script's location, so the working directory
# is never wrong (the npm script lives in the project's package.json).
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

$cid = Read-Host 'Plaid production client_id'
if ([string]::IsNullOrWhiteSpace($cid)) {
  Write-Host 'No client_id entered - aborting (nothing sent).'
  exit 2
}
$sec = Read-Host 'Plaid production secret' -AsSecureString

# .Trim() defends against a stray space / smart-quote pasted into the client_id.
$env:PLAID_CLIENT_ID = $cid.Trim()
# Portable SecureString -> plaintext (works on PS 5.1 and 7; ConvertFrom-SecureString
# -AsPlainText is 7-only). The plaintext lives only in this process env, briefly.
$env:PLAID_SECRET = [System.Net.NetworkCredential]::new('', $sec).Password
$env:PLAID_ENV = 'production'

$code = 1
try {
  npm run plaid:prod-check
  $code = $LASTEXITCODE
} finally {
  Remove-Item Env:PLAID_SECRET, Env:PLAID_CLIENT_ID, Env:PLAID_ENV -ErrorAction SilentlyContinue
}
exit $code
