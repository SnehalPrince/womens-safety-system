param (
    [string]$BaseUrl = $env:BASE,
    [string]$ApiKey = $env:KEY,
    [string]$DeviceId = $env:DEVICE
)

if (-not $BaseUrl) { $BaseUrl = "http://localhost:3000" }
if (-not $ApiKey) { $ApiKey = "dev_device_api_key_12345" }
if (-not $DeviceId) { $DeviceId = "band-001" }

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host " Simulating Hardware Band: $DeviceId" -ForegroundColor Cyan
Write-Host " Base URL: $BaseUrl" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

$headers = @{
    "x-api-key" = $ApiKey
    "Content-Type" = "application/json"
}

Write-Host "`n>> Step 1: Sending sos_start event..." -ForegroundColor Yellow
$bodyStart = @{
    deviceId = $DeviceId
    event = "sos_start"
    lat = 28.6139
    lng = 77.2090
    fix = $true
} | ConvertTo-Json

try {
    $resStart = Invoke-RestMethod -Uri "$BaseUrl/api/location" -Method Post -Headers $headers -Body $bodyStart
    Write-Host "Response: $($resStart | ConvertTo-Json -Compress)" -ForegroundColor Green
} catch {
    Write-Host "Failed: $_" -ForegroundColor Red
}

Write-Host "`n>> Step 2: Polling command endpoint..." -ForegroundColor Yellow
try {
    $resCmd1 = Invoke-RestMethod -Uri "$BaseUrl/api/device/$DeviceId/command" -Method Get -Headers @{ "x-api-key" = $ApiKey }
    Write-Host "Response: $($resCmd1 | ConvertTo-Json -Compress)" -ForegroundColor Green
} catch {
    Write-Host "Failed: $_" -ForegroundColor Red
}

Write-Host "`n>> Step 3: Sending breadcrumb sos_update event..." -ForegroundColor Yellow
$bodyUpdate = @{
    deviceId = $DeviceId
    event = "sos_update"
    lat = 28.6148
    lng = 77.2098
    fix = $true
} | ConvertTo-Json

try {
    $resUpdate = Invoke-RestMethod -Uri "$BaseUrl/api/location" -Method Post -Headers $headers -Body $bodyUpdate
    Write-Host "Response: $($resUpdate | ConvertTo-Json -Compress)" -ForegroundColor Green
} catch {
    Write-Host "Failed: $_" -ForegroundColor Red
}

Write-Host "`n>> Step 4: Polling command endpoint again..." -ForegroundColor Yellow
try {
    $resCmd2 = Invoke-RestMethod -Uri "$BaseUrl/api/device/$DeviceId/command" -Method Get -Headers @{ "x-api-key" = $ApiKey }
    Write-Host "Response: $($resCmd2 | ConvertTo-Json -Compress)" -ForegroundColor Green
} catch {
    Write-Host "Failed: $_" -ForegroundColor Red
}

Write-Host "`n=========================================" -ForegroundColor Cyan
Write-Host " Simulation Complete" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
