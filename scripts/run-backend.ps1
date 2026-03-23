$ErrorActionPreference = 'Stop'

$port = 8000
$listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
  Write-Host "Port $port is busy (PID $($listener.OwningProcess)). Stopping existing process..."
  Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 800
}

$pythonCandidates = @(
  ".venv\\Scripts\\python.exe",
  "venv\\Scripts\\python.exe"
)

$pythonExe = $pythonCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $pythonExe) {
  throw "No virtualenv python found. Expected .venv\\Scripts\\python.exe or venv\\Scripts\\python.exe"
}

Write-Host "Starting backend with $pythonExe"
& $pythonExe "api/main.py"
