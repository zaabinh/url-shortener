. "$PSScriptRoot/common.ps1"

function Invoke-LocalPython {
    & "$DemoRoot/backend/.venv/Scripts/python.exe" @args
    if ($LASTEXITCODE -ne 0) { throw "Local Python failed: $args" }
}

function Invoke-ManualSmoke([string]$Url) {
    $oldBase = $env:SMOKE_BASE_URL
    try {
        $env:SMOKE_BASE_URL = $Url
        Invoke-LocalPython "$DemoRoot/backend/tests/smoke_api.py"
    } finally { $env:SMOKE_BASE_URL = $oldBase }
}

function Wait-ManualPg {
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        & docker exec "$Prefix-pg" pg_isready -h 127.0.0.1 -U shortener_user -d url_shortener | Out-Null
        if ($LASTEXITCODE -eq 0) { return }
        Start-Sleep -Seconds 1
    }
    throw "PostgreSQL not ready: $Prefix-pg"
}

function Invoke-ManualSql([string]$Sql) {
    $Sql | & docker exec -i "$Prefix-pg" psql -v ON_ERROR_STOP=1 -U shortener_user -d url_shortener -At
    if ($LASTEXITCODE -ne 0) { throw 'Manual database query failed.' }
}

function Start-ManualPg([switch]$Network, [switch]$Volume) {
    $runArgs = @('run', '-d', '--name', "$Prefix-pg",
        '-e', 'POSTGRES_USER=shortener_user', '-e', 'POSTGRES_PASSWORD=shortener_password',
        '-e', 'POSTGRES_DB=url_shortener', '-p', "127.0.0.1:${DatabasePort}:5432",
        '--mount', "type=bind,source=$DemoRoot/docker/postgres/init.sql,target=/docker-entrypoint-initdb.d/001-init.sql,readonly")
    if ($Network) { $runArgs += @('--network', "$Prefix-net") }
    if ($Volume) { $runArgs += @('--mount', "type=volume,source=$Prefix-pg-data,target=/var/lib/postgresql/data") }
    Invoke-Docker @runArgs postgres:17-alpine
    Wait-ManualPg
}

function Start-ManualBackend([string]$Name, [switch]$Publish, [switch]$Network) {
    $dbHost = if ($Network) { "$Prefix-pg" } else { 'host.docker.internal' }
    $publicPort = if ($BackendPort) { $BackendPort } else { 8001 }
    $runArgs = @('run', '-d', '--name', $Name,
        '-e', "DATABASE_URL=postgresql+psycopg://shortener_user:shortener_password@${dbHost}:5432/url_shortener",
        '-e', 'REDIS_URL=', '-e', "BASE_URL=http://localhost:$publicPort", '-e', 'CORS_ORIGINS=http://localhost:3000')
    if ($Publish) { $runArgs += @('-p', "127.0.0.1:${BackendPort}:8000") }
    if ($Network) { $runArgs += @('--network', "$Prefix-net") }
    Invoke-Docker @runArgs url-shortener-backend:p03
}

function Wait-ManualBackend {
    # IPv4 matches the published binding and avoids localhost's IPv6 probe delay on Windows.
    $healthUri = "http://127.0.0.1:${BackendPort}/app/health"
    Write-Host "Waiting for $healthUri"
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        try {
            $health = Invoke-RestMethod -Uri $healthUri -TimeoutSec 5
            if ($health.status -eq 'healthy') { return }
        } catch {
            $lastFailure = $_.Exception.Message
            Start-Sleep -Seconds 1
        }
    }
    throw "Backend did not become live at ${healthUri}: $lastFailure"
}
