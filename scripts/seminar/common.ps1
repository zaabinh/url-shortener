# Dot-source from a phase script. Windows PowerShell 5.1 and PowerShell 7.
$ErrorActionPreference = 'Stop'
$DemoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$script:DemoStep = 0

function Invoke-DemoStep([string]$Title, [scriptblock]$Action) {
    $script:DemoStep++
    Write-Host ("[{0}] {1}" -f $script:DemoStep, $Title) -ForegroundColor Cyan
    if ($ListSteps -or $script:DemoStep -lt $FromStep) { return }
    if (-not $NonInteractive) {
        $answer = Read-Host 'Explain this step, then Enter to run (Q to stop)'
        if ($answer -eq 'q') { throw 'Demo stopped by presenter. No later steps were run.' }
    }
    & $Action
}

function Invoke-Docker {
    & docker @args
    if ($LASTEXITCODE -ne 0) { throw "Docker failed (exit $LASTEXITCODE): docker $args" }
}

function Invoke-Compose {
    Invoke-Docker compose --project-directory $DemoRoot -f "$DemoRoot/compose.yaml" -p $ProjectName @args
}

function Assert-Equal($Actual, $Expected, [string]$Message) {
    if ([string]$Actual -cne [string]$Expected) { throw "$Message (expected $Expected, got $Actual)" }
    Write-Host "PASS: $Message = $Expected" -ForegroundColor Green
}

function Get-DemoStatus([string]$Url) {
    $status = & curl.exe --silent --show-error --max-time 20 --output NUL --write-out '%{http_code}' $Url
    if ($LASTEXITCODE -ne 0) { throw "HTTP request failed: $Url" }
    return $status
}

function New-DemoUrl([int]$Seconds = 86400) {
    $payload = @{
        original_url = 'https://example.com/docker-seminar'
        expires_at = [DateTimeOffset]::UtcNow.AddSeconds($Seconds).ToString('o')
    } | ConvertTo-Json
    Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/urls" -ContentType 'application/json' -Body $payload
}

function Invoke-DemoSql([string]$Sql) {
    $pgUser = Invoke-Compose exec -T postgres printenv POSTGRES_USER
    $pgDatabase = Invoke-Compose exec -T postgres printenv POSTGRES_DB
    # Send SQL on stdin: Windows PowerShell 5.1 otherwise loses nested native quotes.
    $Sql | & docker compose --project-directory $DemoRoot -f "$DemoRoot/compose.yaml" -p $ProjectName exec -T postgres psql -v ON_ERROR_STOP=1 -U $pgUser -d $pgDatabase -At
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL assertion query failed.' }
}

function Get-DemoClicks([string]$Code) {
    if ($Code -cnotmatch '^[A-Za-z0-9]{1,32}$') { throw 'Invalid short code in SQL check.' }
    [int](Invoke-DemoSql "SELECT click_count FROM urls WHERE short_code='$Code';")
}

function Wait-DemoRedis {
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        $pong = & docker compose --project-directory $DemoRoot -f "$DemoRoot/compose.yaml" -p $ProjectName exec -T redis redis-cli ping 2>$null
        if ($LASTEXITCODE -eq 0 -and $pong -eq 'PONG') { return }
        Start-Sleep -Seconds 1
    }
    throw 'Redis did not recover within 30 seconds.'
}
