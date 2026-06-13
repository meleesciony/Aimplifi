# ─────────────────────────────────────────────────────────────────────────
#  Pulse Finance — desktop launcher
#  Double-clicked via the desktop shortcut. Starts the production server on a
#  free local port, waits until it answers, then opens your browser.
#  Closing this window stops the app.
# ─────────────────────────────────────────────────────────────────────────
$ErrorActionPreference = 'Stop'
$proj = 'C:\Users\micha\OneDrive\Documents\Pulse Finance'
Set-Location $proj

$Host.UI.RawUI.WindowTitle = 'Pulse Finance'
Write-Host ''
Write-Host '  Pulse Finance' -ForegroundColor Green
Write-Host '  ---------------------------------------------------------'
Write-Host ''

# 1. First-run safety net: install deps if node_modules is missing.
if (-not (Test-Path (Join-Path $proj 'node_modules'))) {
  Write-Host '  First run: installing dependencies (one-time, a few minutes)...' -ForegroundColor Yellow
  npm install
}

# 2. Ensure the demo database exists and is seeded.
if (-not (Test-Path (Join-Path $proj 'dev.db'))) {
  Write-Host '  Setting up the demo database...' -ForegroundColor Yellow
  npm run db:push
  npm run db:seed
}

# 3. Ensure a production build exists.
if (-not (Test-Path (Join-Path $proj '.next'))) {
  Write-Host '  First run: building the app (one-time, ~1 minute)...' -ForegroundColor Yellow
  npm run build
}

# 4. Pick the first free local port (port 3000 is often taken on this machine).
function Get-FreePort {
  foreach ($p in 3100, 3200, 3300, 3400, 4100, 5100) {
    try {
      $l = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $p)
      $l.Start(); $l.Stop(); return $p
    } catch { }
  }
  return 3100
}
$port = Get-FreePort
$url  = "http://localhost:$port"

# 5. In the background, wait until the server answers, then open the browser.
Start-Job -ScriptBlock {
  param($u)
  for ($i = 0; $i -lt 90; $i++) {
    try {
      Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec 2 | Out-Null
      Start-Process $u
      return
    } catch { Start-Sleep -Milliseconds 700 }
  }
} -ArgumentList $url | Out-Null

Write-Host "  Starting server on $url" -ForegroundColor Green
Write-Host '  Your browser will open automatically in a few seconds.'
Write-Host ''
Write-Host '  >> Leave this window open while you use the app. <<' -ForegroundColor Cyan
Write-Host '  >> Close it (or press Ctrl+C) to shut the app down. <<' -ForegroundColor Cyan
Write-Host ''

# 6. Run the production server in the foreground (keeps the window alive;
#    closing the window terminates the server).
$env:PORT = "$port"
npx next start -p $port
