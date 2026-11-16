[CmdletBinding()]
param([int]$FromStep = 1, [switch]$ListSteps, [switch]$NonInteractive,
      [ValidatePattern('^seminar(?:-[a-z0-9]+)*$')][string]$Prefix = 'seminar',
      [ValidateRange(1024, 65535)][int]$BackendPort = 8001,
      [ValidateRange(1024, 65535)][int]$DatabasePort = 5433)
. "$PSScriptRoot/manual.ps1"
$markerSql = "INSERT INTO urls (id,short_code,original_url,expires_at) VALUES ('22222222-2222-4222-8222-222222222222','persistent-demo','https://example.com',NOW()+INTERVAL '1 day') ON CONFLICT (short_code) DO NOTHING;"
$countSql = "SELECT COUNT(*) FROM urls WHERE short_code='persistent-demo';"

Invoke-DemoStep 'Insert a marker into the disposable phase-5 database; this phase intentionally deletes its data' {
    Invoke-Docker stop "$Prefix-backend"
    Invoke-ManualSql $markerSql
    Assert-Equal (Invoke-ManualSql $countSql) 1 'Disposable marker exists'
}
Invoke-DemoStep 'Remove the database and its anonymous volume; recreate and prove the marker is gone' {
    Invoke-Docker rm -fv "$Prefix-pg"
    Start-ManualPg -Network
    Assert-Equal (Invoke-ManualSql $countSql) 0 'Disposable data lost'
}
Invoke-DemoStep 'Replace it with a named-volume database and insert the marker again' {
    Invoke-Docker rm -fv "$Prefix-pg"
    Invoke-Docker volume create "$Prefix-pg-data"
    Start-ManualPg -Network -Volume
    Invoke-ManualSql $markerSql
}
Invoke-DemoStep 'Replace the container while preserving the named volume; verify data survives' {
    Invoke-Docker rm -f "$Prefix-pg"
    Start-ManualPg -Network -Volume
    Assert-Equal (Invoke-ManualSql $countSql) 1 'Persistent marker survives replacement'
    Invoke-Docker start "$Prefix-backend"
    Wait-ManualBackend
    Invoke-ManualSmoke "http://localhost:$BackendPort"
}
Invoke-DemoStep 'Create a SQL backup independently of the live volume' {
    Invoke-Docker exec "$Prefix-pg" pg_dump -U shortener_user -d url_shortener -f /tmp/seminar.sql
    Invoke-Docker cp "${Prefix}-pg:/tmp/seminar.sql" "$DemoRoot/seminar-backup.sql"
    Write-Host 'Backup written to seminar-backup.sql; volume persistence is not a backup strategy.'
}
