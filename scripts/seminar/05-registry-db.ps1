[CmdletBinding()]
param([int]$FromStep = 1, [switch]$ListSteps, [switch]$NonInteractive,
      [ValidatePattern('^seminar(?:-[a-z0-9]+)*$')][string]$Prefix = 'seminar',
      [ValidateRange(1024, 65535)][int]$DatabasePort = 5433)
. "$PSScriptRoot/manual.ps1"

Invoke-DemoStep 'Pull the official PostgreSQL image and inspect its digest' {
    Invoke-Docker pull postgres:17-alpine
    Invoke-Docker image inspect postgres:17-alpine --format '{{json .RepoDigests}}'
}
Invoke-DemoStep 'Show the UUID schema and start PostgreSQL with a read-only init script' {
    Get-Content "$DemoRoot/docker/postgres/init.sql"
    Start-ManualPg
}
Invoke-DemoStep 'Inspect the initialized table and explain registry push as an optional manual task' {
    Invoke-ManualSql '\d urls'
    Write-Host 'Registry stores images, not live containers or data. Login/tag/push are optional manual commands.'
}
