[CmdletBinding()]
param(
    [string]$Tag
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Error 'Git is not installed or is not on PATH.'
    exit 1
}

$repository = & git -C $PSScriptRoot rev-parse --show-toplevel 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Error 'The script must be inside a Git repository.'
    exit 1
}

$tags = @(
    'seminar/00-local'
    'seminar/01-problem'
    'seminar/02-concepts'
    'seminar/03-image'
    'seminar/04-ports'
    'seminar/05-registry-db'
    'seminar/06-network'
    'seminar/07-volume'
    'seminar/08-compose'
    'seminar/09-redis'
    'seminar/10-architecture'
    'seminar/11-final'
)

if (-not $Tag) {
    $existingTags = @(& git -C $repository tag --list)
    if ($LASTEXITCODE -ne 0) { exit 1 }

    Write-Host 'Select a seminar checkpoint (0 to exit):'
    for ($index = 0; $index -lt $tags.Count; $index++) {
        $availability = if ($existingTags -ccontains $tags[$index]) { 'available' } else { 'not created' }
        Write-Host ('{0,2}. {1} [{2}]' -f ($index + 1), $tags[$index], $availability)
    }

    $selection = Read-Host 'Number or tag name'
    if ($selection -eq '0') { exit 0 }

    $number = 0
    if ([int]::TryParse($selection, [ref]$number)) {
        if ($number -lt 1 -or $number -gt $tags.Count) {
            Write-Host 'Invalid selection.'
            exit 1
        }
        $Tag = $tags[$number - 1]
    } else {
        $Tag = $selection.Trim()
    }
}

& git -C $repository check-ref-format "refs/tags/$Tag" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host 'git tag not found'
    exit 1
}

& git -C $repository show-ref --verify --quiet "refs/tags/$Tag"
if ($LASTEXITCODE -ne 0) {
    Write-Host 'git tag not found'
    exit 1
}

$changes = @(& git -C $repository status --porcelain)
if ($LASTEXITCODE -ne 0) { exit 1 }
if ($changes.Count -gt 0) {
    Write-Host 'Working tree has changes. Commit or stash them before switching tags.'
    exit 1
}

& git -C $repository switch --quiet --detach "refs/tags/$Tag"
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "Now at tag '$Tag' (detached HEAD). Use git switch - to return."
