[CmdletBinding()]
param([int]$FromStep = 1, [switch]$ListSteps, [switch]$NonInteractive,
      [ValidatePattern('^seminar(?:-[a-z0-9]+)*$')][string]$Prefix = 'seminar')
. "$PSScriptRoot/common.ps1"

Invoke-DemoStep 'Pull Alpine; distinguish an image from a container' {
    Invoke-Docker pull alpine:3.22
    Invoke-Docker image ls alpine:3.22
}
Invoke-DemoStep 'Run a short-lived process; show the exited container and its logs' {
    Invoke-Docker run --name "$Prefix-concepts" alpine:3.22 echo 'Hello from a container'
    Invoke-Docker ps -a --filter "name=^/$Prefix-concepts$"
    Invoke-Docker logs "$Prefix-concepts"
}
Invoke-DemoStep 'Start the same container, then remove it; retain the image' {
    Invoke-Docker start -a "$Prefix-concepts"
    Invoke-Docker rm "$Prefix-concepts"
    Invoke-Docker image ls alpine:3.22
}
