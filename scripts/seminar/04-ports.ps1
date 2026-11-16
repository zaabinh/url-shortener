[CmdletBinding()]
param([int]$FromStep = 1, [switch]$ListSteps, [switch]$NonInteractive,
      [ValidatePattern('^seminar(?:-[a-z0-9]+)*$')][string]$Prefix = 'seminar',
      [ValidateRange(1024, 65535)][int]$BackendPort = 8001)
. "$PSScriptRoot/manual.ps1"

Invoke-DemoStep 'Inspect the old container: EXPOSE has not published a host port' {
    Invoke-Docker port "$Prefix-backend-p03"
    Write-Host 'A local service might already use the host port; docker port is the authoritative comparison.'
}
Invoke-DemoStep 'Replace the manual backend with a container that publishes its port' {
    Invoke-Docker rm -f "$Prefix-backend-p03"
    Start-ManualBackend -Name "$Prefix-backend-p04" -Publish
    Wait-ManualBackend
}
Invoke-DemoStep 'Check the published port and HTTP liveness (database checks come in phase 6)' {
    Invoke-Docker port "$Prefix-backend-p04"
    Assert-Equal (Get-DemoStatus "http://localhost:$BackendPort/app/health") 200 'Published backend health'
}
