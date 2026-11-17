[CmdletBinding()]
param(
    [ValidateRange(1, 20)][int]$FromStep = 1,
    [switch]$ListSteps,
    [switch]$NonInteractive,
    [string]$ProjectName = 'url-shortener-seminar',
    [string]$BaseUrl = 'http://localhost:8080'
)
. "$PSScriptRoot/common.ps1"

Invoke-DemoStep 'Validate Compose, build images and wait for healthy services' {
    Invoke-Compose config --quiet
    Invoke-Compose up -d --build --wait --wait-timeout 180
    Invoke-Compose --profile test build tests
    Assert-Equal (Get-DemoStatus "$BaseUrl/") 200 'Frontend static page'
    Assert-Equal (Get-DemoStatus "$BaseUrl/app/health") 200 'Health through Nginx'
}
Invoke-DemoStep 'Explain the Engine, published port, internal networks and named volume' {
    Invoke-Compose ps
    Invoke-Docker network inspect "${ProjectName}_edge" "${ProjectName}_data" --format '{{.Name}} internal={{.Internal}}'
    Invoke-Docker volume inspect "${ProjectName}_pg_data" --format '{{.Name}} driver={{.Driver}}'
    Write-Host 'Browser -> Nginx -> FastAPI -> PostgreSQL / Redis; Compose controls Engine, not HTTP traffic.'
}
Invoke-DemoStep 'Run HTTP smoke tests directly against FastAPI' {
    Invoke-Compose --profile test run --rm --no-deps tests
}
Invoke-DemoStep 'Run the same HTTP tests through Nginx, then real cache integration tests' {
    Invoke-Compose --profile test run --rm --no-deps -e SMOKE_BASE_URL=http://frontend:8080 tests
    Invoke-Compose --profile test run --rm --no-deps tests python tests/docker_cache.py
}
Invoke-DemoStep 'Explain CI and production limits; show the workflows' {
    Get-Content "$DemoRoot/.github/workflows/ci.yml"
    Get-Content "$DemoRoot/.github/workflows/docker-smoke.yml"
    Write-Host 'Local CI: unit/browser checks. Docker CI: real HTTP/DB/cache and Redis outage checks.'
    Write-Host 'Still required for production: TLS, backups, migrations, monitoring, resource limits and image updates.'
}
