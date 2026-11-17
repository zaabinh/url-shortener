[CmdletBinding()]
param([int]$FromStep = 1, [switch]$ListSteps, [switch]$NonInteractive,
      [ValidatePattern('^seminar(?:-[a-z0-9]+)*$')][string]$Prefix = 'seminar',
      [ValidateRange(1024, 65535)][int]$BackendPort = 8001)
. "$PSScriptRoot/manual.ps1"

Invoke-DemoStep 'Create a user-defined network and attach PostgreSQL' {
    Invoke-Docker network create "$Prefix-net"
    Invoke-Docker network connect "$Prefix-net" "$Prefix-pg"
}
Invoke-DemoStep 'Replace the backend using the database container name, not localhost' {
    Invoke-Docker rm -f "$Prefix-backend-p04"
    Start-ManualBackend -Name "$Prefix-backend" -Network -Publish
    Wait-ManualBackend
}
Invoke-DemoStep 'Prove Docker DNS and real application connectivity' {
    Invoke-Docker exec "$Prefix-backend" python -c "import socket; print(socket.gethostbyname('$Prefix-pg'))"
    Invoke-Docker network inspect "$Prefix-net" --format '{{.Name}}'
    Invoke-ManualSmoke "http://localhost:$BackendPort"
}
