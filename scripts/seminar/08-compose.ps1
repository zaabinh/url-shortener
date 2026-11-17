[CmdletBinding()]
param([int]$FromStep = 1, [switch]$ListSteps, [switch]$NonInteractive,
      [ValidatePattern('^seminar(?:-[a-z0-9]+)*$')][string]$Prefix = 'seminar',
      [string]$ProjectName = 'url-shortener-seminar',
      [string]$BaseUrl = 'http://localhost:8080')
. "$PSScriptRoot/common.ps1"

function Invoke-Phase08Compose {
    Invoke-Docker compose --project-directory $DemoRoot -p $ProjectName -f "$DemoRoot/compose.yaml" -f "$DemoRoot/docker/compose.phase08.yaml" @args
}

Invoke-DemoStep 'Stop the manual backend and database; retain their volume' {
    Invoke-Docker stop "$Prefix-backend" "$Prefix-pg"
}
Invoke-DemoStep 'Validate and explain the three-service Compose configuration (Redis disabled)' {
    Invoke-Phase08Compose config --quiet
    Invoke-Phase08Compose config --services
    Write-Host 'The overlay disables Redis for phase 8. Phase 9 uses the main Compose file alone.'
}
Invoke-DemoStep 'Build and start frontend, backend and PostgreSQL together' {
    Invoke-Phase08Compose up -d --build --wait --wait-timeout 180
    Invoke-Phase08Compose ps
    Assert-Equal (Get-DemoStatus "$BaseUrl/") 200 'Frontend static page'
    Assert-Equal (Get-DemoStatus "$BaseUrl/app/health") 200 'API via Nginx'
}
Invoke-DemoStep 'Build the temporary test runner and verify both HTTP paths' {
    Invoke-Phase08Compose --profile test build tests
    Invoke-Phase08Compose --profile test run --rm --no-deps tests
    Invoke-Phase08Compose --profile test run --rm --no-deps -e SMOKE_BASE_URL=http://frontend:8080 tests
}
