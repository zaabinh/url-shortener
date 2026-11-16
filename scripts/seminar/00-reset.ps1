[CmdletBinding()]
param(
    [int]$FromStep = 1,
    [switch]$ListSteps,
    [switch]$NonInteractive,
    [switch]$Apply,
    [switch]$DeleteData,
    [switch]$IncludeBaseImages,
    [ValidatePattern('^url-shortener-[a-z0-9-]+$')][string]$ProjectName = 'url-shortener-seminar',
    [ValidatePattern('^seminar(?:-[a-z0-9]+)*$')][string]$Prefix = 'seminar'
)
. "$PSScriptRoot/common.ps1"

function Get-ResetContainers {
    $names = @(Invoke-Docker ps -a --format '{{.Names}}')
    $manual = @('concepts', 'backend-p03', 'backend-p04', 'backend', 'pg') | ForEach-Object { "$Prefix-$_" }
    $compose = @(Invoke-Docker ps -a --filter "label=com.docker.compose.project=$ProjectName" --format '{{.Names}}')
    @($names | Where-Object { $_ -in $manual -or $_ -in $compose })
}

function Get-ResetImages {
    $pattern = '^(?:[^/]+/)?url-shortener-(?:backend|frontend):|^' + [regex]::Escape("$ProjectName-tests") + ':'
    @(Invoke-Docker image ls --format '{{.Repository}}:{{.Tag}}' | Where-Object { $_ -match $pattern })
}

function Remove-UnusedImage([string]$Image) {
    $users = @(Invoke-Docker ps -a --filter "ancestor=$Image" --format '{{.Names}}')
    if ($users.Count -gt 0) {
        Write-Host "SKIP image $Image; still used by containers: $($users -join ', ')" -ForegroundColor Yellow
        return
    }
    # Never force removal of shared images or prune unrelated Docker resources.
    Invoke-Docker image rm $Image
}

Invoke-DemoStep 'Preview exactly the seminar containers, networks, volumes and images' {
    Write-Host "Project: $ProjectName; manual container prefix: $Prefix"
    Write-Host "Apply=$Apply; DeleteData=$DeleteData; IncludeBaseImages=$IncludeBaseImages"
    Get-ResetContainers | ForEach-Object { Write-Host "Container: $_" }
    Get-ResetImages | ForEach-Object { Write-Host "Application image: $_" }
    Write-Host "Networks: ${ProjectName}_edge, ${ProjectName}_data, $Prefix-net"
    Write-Host "Named volumes (only with -DeleteData): ${ProjectName}_pg_data, $Prefix-pg-data"
    Write-Host 'Base images (optional): Alpine, PostgreSQL 17, Redis 8, Python 3.12, Node 22, Nginx 1.27.'
    Write-Host 'Other projects, local PostgreSQL, source files and Git tags are outside this reset.'
    if ($Apply -and -not $NonInteractive) {
        if ((Read-Host 'Type RESET to authorize the listed reset') -cne 'RESET') { throw 'Reset cancelled.' }
    }
}
Invoke-DemoStep 'Remove seminar containers (and anonymous volumes only when DeleteData is selected)' {
    if (-not $Apply) { Write-Host 'PREVIEW only. Add -Apply to remove containers and images.'; return }
    $targets = @(Get-ResetContainers)
    foreach ($name in $targets) {
        if ($DeleteData) { Invoke-Docker rm -fv $name } else { Invoke-Docker rm -f $name }
    }
}
Invoke-DemoStep 'Remove only the seminar networks and optionally its named database volumes' {
    if (-not $Apply) { Write-Host 'PREVIEW only. -DeleteData is required to erase database volumes.'; return }
    $networks = @(Invoke-Docker network ls --format '{{.Name}}')
    foreach ($name in @("${ProjectName}_edge", "${ProjectName}_data", "$Prefix-net")) {
        if ($name -in $networks) { Invoke-Docker network rm $name }
    }
    if ($DeleteData) {
        $volumes = @(Invoke-Docker volume ls --format '{{.Name}}')
        foreach ($name in @("${ProjectName}_pg_data", "$Prefix-pg-data")) {
            if ($name -in $volumes) { Invoke-Docker volume rm $name }
        }
    }
}
Invoke-DemoStep 'Remove application image tags from all phases; skip images still used elsewhere' {
    if (-not $Apply) { Write-Host 'PREVIEW only. Application tags p03, seminar, test and registry aliases are targeted.'; return }
    foreach ($image in @(Get-ResetImages)) { Remove-UnusedImage $image }
}
Invoke-DemoStep 'Optionally remove unused base images; keep global builder cache and other projects' {
    if (-not $Apply -or -not $IncludeBaseImages) {
        Write-Host 'Base images retained. For a full image-pull rehearsal add -Apply -IncludeBaseImages.'
        return
    }
    $images = @(Invoke-Docker image ls --format '{{.Repository}}:{{.Tag}}')
    foreach ($image in @('alpine:3.22', 'postgres:17-alpine', 'redis:8-alpine', 'python:3.12-slim', 'node:22-alpine', 'nginx:1.27-alpine')) {
        if ($image -in $images) { Remove-UnusedImage $image }
    }
    Write-Host 'Builder cache is intentionally retained. Images may rebuild from cached layers; use build --no-cache for a cold-build lesson.'
}
