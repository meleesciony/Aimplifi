# scripts/simplefin-check.ps1
# Paste-safe wrapper around `npm run simplefin:check`. Prompts (hidden) for a
# SimpleFIN setup token OR an access URL, runs the check, and wipes the env var.
#
# A SETUP TOKEN is ONE-TIME — checking it here CONSUMES it, and the script then
# prints the resulting access URL for you to save. An ACCESS URL (https://...)
# check is non-destructive and repeatable.
#
# Run (from anywhere):
#   pwsh -ExecutionPolicy Bypass -File "C:\Users\micha\OneDrive\Documents\Pulse Finance\scripts\simplefin-check.ps1"
#
# Works on both Windows PowerShell 5.1 and PowerShell 7.

$ErrorActionPreference = 'Stop'

# Resolve the project root from THIS script's location so the working directory is
# never wrong (the npm script lives in the project's package.json).
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

Write-Host 'SimpleFIN check — paste a SETUP TOKEN (one-time; consumed here) or an ACCESS URL (https://..., repeatable).'
$secure = Read-Host 'SimpleFIN setup token or access URL' -AsSecureString
# Portable SecureString -> plaintext (works on PS 5.1 and 7).
$cred = [System.Net.NetworkCredential]::new('', $secure).Password
if ([string]::IsNullOrWhiteSpace($cred)) {
  Write-Host 'Nothing entered - aborting (nothing sent).'
  exit 2
}
$env:SIMPLEFIN_CREDENTIAL = $cred.Trim()

$code = 1
try {
  npm run simplefin:check
  $code = $LASTEXITCODE
} finally {
  Remove-Item Env:SIMPLEFIN_CREDENTIAL -ErrorAction SilentlyContinue
}
exit $code
