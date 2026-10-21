# Starts the backend on the local TEST database (TEST_DATABASE_URL in .env.test), for the
# real-backend browser tests. The app's normal start is unchanged and still uses Supabase
# from .env. Stop it with Ctrl+C.
$envTest = @((Join-Path $PSScriptRoot '..\.env.test'), (Join-Path $PSScriptRoot '.env.test')) |
  Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $envTest) { throw 'No .env.test: run step 10.5.5 first.' }
$line = Get-Content $envTest | Where-Object { $_ -match '^\s*TEST_DATABASE_URL\s*=' } | Select-Object -First 1
if (-not $line) { throw "No TEST_DATABASE_URL in $envTest" }
$saved = @{ DATABASE_URL = $env:DATABASE_URL; DEBUG = $env:DEBUG }
Push-Location $PSScriptRoot
try {
  $env:DATABASE_URL = ($line -split '=', 2)[1].Trim()
  $env:DEBUG = 'False'
  Write-Host 'Backend on the local TEST database (not Supabase): http://localhost:8000'
  python -m uvicorn app.main:app --port 8000
} finally {
  $env:DATABASE_URL = $saved.DATABASE_URL
  $env:DEBUG = $saved.DEBUG
  Pop-Location
}
