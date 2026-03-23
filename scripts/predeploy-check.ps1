$ErrorActionPreference = 'Stop'

Write-Host "Running predeploy parity check..." -ForegroundColor Cyan

$repoRoot = Split-Path -Parent $PSScriptRoot
$envExamplePath = Join-Path $repoRoot ".env.example"
$envPath = Join-Path $repoRoot ".env"

if (-not (Test-Path $envExamplePath)) {
  throw ".env.example is missing."
}

if (-not (Test-Path $envPath)) {
  throw ".env is missing. Create it from .env.example for local parity."
}

function Parse-EnvFile {
  param([string]$Path)
  $map = @{}
  Get-Content $Path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith('#')) { return }
    $idx = $line.IndexOf('=')
    if ($idx -lt 1) { return }
    $key = $line.Substring(0, $idx).Trim()
    $value = $line.Substring($idx + 1)
    $map[$key] = $value
  }
  return $map
}

$example = Parse-EnvFile -Path $envExamplePath
$current = Parse-EnvFile -Path $envPath

$missingKeys = @()
foreach ($k in $example.Keys) {
  if (-not $current.ContainsKey($k)) {
    $missingKeys += $k
  }
}

if ($missingKeys.Count -gt 0) {
  Write-Host "[FAIL] .env missing keys present in .env.example:" -ForegroundColor Red
  $missingKeys | ForEach-Object { Write-Host " - $_" -ForegroundColor Red }
  throw "Environment key parity check failed."
}

Write-Host "[PASS] .env contains all .env.example keys" -ForegroundColor Green

$requiredAlways = @(
  'NEXT_PUBLIC_API_URL',
  'CHECKOUT_PROVIDER',
  'HOST',
  'PORT'
)

$emptyAlways = @()
foreach ($key in $requiredAlways) {
  if (-not $current[$key] -or [string]::IsNullOrWhiteSpace($current[$key])) {
    $emptyAlways += $key
  }
}

if ($emptyAlways.Count -gt 0) {
  Write-Host "[FAIL] Required env values are empty:" -ForegroundColor Red
  $emptyAlways | ForEach-Object { Write-Host " - $_" -ForegroundColor Red }
  throw "Required env value check failed."
}

Write-Host "[PASS] Required base env values are set" -ForegroundColor Green

$provider = $current['CHECKOUT_PROVIDER'].ToLowerInvariant()
if ($provider -eq 'stripe') {
  $requiredStripe = @(
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'FRONTEND_BASE_URL',
    'STRIPE_SUCCESS_URL',
    'STRIPE_CANCEL_URL',
    'STRIPE_PRICE_ID_PLUS_MONTHLY',
    'STRIPE_PRICE_ID_BUSINESS_MONTHLY',
    'STRIPE_PRICE_ID_PRO_MONTHLY'
  )

  $emptyStripe = @()
  foreach ($key in $requiredStripe) {
    if (-not $current[$key] -or [string]::IsNullOrWhiteSpace($current[$key])) {
      $emptyStripe += $key
    }
  }

  if ($emptyStripe.Count -gt 0) {
    Write-Host "[FAIL] Stripe provider selected but required Stripe env values are empty:" -ForegroundColor Red
    $emptyStripe | ForEach-Object { Write-Host " - $_" -ForegroundColor Red }
    throw "Stripe env readiness failed."
  }

  Write-Host "[PASS] Stripe env values are set" -ForegroundColor Green
} else {
  Write-Host "[INFO] CHECKOUT_PROVIDER=$provider (Stripe-specific checks skipped)" -ForegroundColor Yellow
}

Push-Location $repoRoot
try {
  $busyFrontendPorts = Get-NetTCPConnection -LocalPort 3000,3001 -State Listen -ErrorAction SilentlyContinue
  if ($busyFrontendPorts) {
    throw "Detected running dev server on port 3000/3001. Stop dev servers before predeploy check."
  }

  Write-Host "Running lint and build checks..." -ForegroundColor Cyan
  npm run lint | Out-Host
  if ($LASTEXITCODE -ne 0) {
    throw "Lint failed."
  }

  $buildSucceeded = $false
  for ($attempt = 1; $attempt -le 2; $attempt++) {
    $nextPath = Join-Path $repoRoot ".next"
    if (Test-Path $nextPath) {
      Remove-Item $nextPath -Recurse -Force -ErrorAction SilentlyContinue
      Start-Sleep -Milliseconds 500
    }

    npm run build | Out-Host
    if ($LASTEXITCODE -eq 0) {
      $buildSucceeded = $true
      break
    }

    Write-Host "[WARN] Build attempt $attempt failed. Retrying..." -ForegroundColor Yellow
    Start-Sleep -Seconds 1
  }

  if (-not $buildSucceeded) {
    throw "Build failed."
  }
} finally {
  Pop-Location
}

Write-Host "Predeploy parity check passed." -ForegroundColor Green
