$ErrorActionPreference = 'Stop'

function Check-Endpoint {
  param(
    [string]$Name,
    [string]$Url,
    [int]$ExpectedStatus = 200
  )

  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 20
    if ($response.StatusCode -ne $ExpectedStatus) {
      throw "$Name returned status $($response.StatusCode), expected $ExpectedStatus"
    }
    Write-Host "[PASS] $Name ($Url)" -ForegroundColor Green
    return $response.Content
  } catch {
    Write-Host "[FAIL] $Name ($Url): $($_.Exception.Message)" -ForegroundColor Red
    throw
  }
}

Write-Host "Running Lumiora full health check..." -ForegroundColor Cyan

# Frontend + backend basic routes
Check-Endpoint -Name 'Frontend root' -Url 'http://localhost:3000' | Out-Null
Check-Endpoint -Name 'Frontend billing admin' -Url 'http://localhost:3000/admin/billing' | Out-Null
Check-Endpoint -Name 'Backend health' -Url 'http://localhost:8000/health' | Out-Null
Check-Endpoint -Name 'Backend models' -Url 'http://localhost:8000/models' | Out-Null
Check-Endpoint -Name 'Billing subscription' -Url 'http://localhost:8000/billing/subscription' | Out-Null
Check-Endpoint -Name 'Billing entitlements' -Url 'http://localhost:8000/billing/entitlements' | Out-Null
Check-Endpoint -Name 'Billing audit' -Url 'http://localhost:8000/billing/audit' | Out-Null

# Chat smoke test
$body = '{"model":"llama3 (Local)","messages":[{"role":"user","content":"1+1"}],"stream":true,"session_id":"health_check"}'
$chat = Invoke-WebRequest -Uri 'http://localhost:8000/chat' -Method Post -ContentType 'application/json' -Body $body -UseBasicParsing -TimeoutSec 30
if ($chat.StatusCode -ne 200) {
  throw "Chat endpoint returned $($chat.StatusCode)"
}
Write-Host "[PASS] Chat endpoint smoke test" -ForegroundColor Green

Write-Host "All health checks passed." -ForegroundColor Green
