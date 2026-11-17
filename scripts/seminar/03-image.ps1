[CmdletBinding()]
param([int]$FromStep = 1, [switch]$ListSteps, [switch]$NonInteractive,
      [ValidatePattern('^seminar(?:-[a-z0-9]+)*$')][string]$Prefix = 'seminar')
. "$PSScriptRoot/manual.ps1"

Invoke-DemoStep 'Explain the build context, locked dependencies, cache and default process' {
    Get-Content "$DemoRoot/backend/Dockerfile"
    Get-Content "$DemoRoot/backend/.dockerignore"
}
Invoke-DemoStep 'Build the backend image (works with both the early and final Dockerfile)' {
    Invoke-Docker build -t url-shortener-backend:p03 "$DemoRoot/backend"
}
Invoke-DemoStep 'Start without published ports; the process is inside the container' {
    Start-ManualBackend -Name "$Prefix-backend-p03"
    Start-Sleep -Seconds 2
    Invoke-Docker logs --tail 20 "$Prefix-backend-p03"
    Invoke-Docker port "$Prefix-backend-p03"
}
Invoke-DemoStep 'Stop and start the existing container; explain process lifecycle' {
    Invoke-Docker stop "$Prefix-backend-p03"
    Invoke-Docker start "$Prefix-backend-p03"
    Invoke-Docker inspect "$Prefix-backend-p03" --format '{{.State.Status}}'
}
