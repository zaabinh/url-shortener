[CmdletBinding()]
param(
    [ValidateRange(1, 20)][int]$FromStep = 1,
    [switch]$ListSteps,
    [switch]$NonInteractive,
    [string]$ProjectName = 'url-shortener-seminar',
    [string]$BaseUrl = 'http://localhost:8080'
)
. "$PSScriptRoot/common.ps1"

Invoke-DemoStep 'Start the final architecture and verify the browser entry point' {
    Invoke-Compose up -d --build --wait --wait-timeout 180
    Invoke-Compose --profile test build tests
    Invoke-Compose ps
    Assert-Equal (Get-DemoStatus "$BaseUrl/") 200 'Frontend'
    Write-Host "Open $BaseUrl manually. Demonstrate Shorten/Expand, Reset, custom code, Go, Refresh and Back to top."
}
Invoke-DemoStep 'Run both real HTTP paths and cache checks' {
    Invoke-Compose --profile test run --rm --no-deps tests
    Invoke-Compose --profile test run --rm --no-deps -e SMOKE_BASE_URL=http://frontend:8080 tests
    Invoke-Compose --profile test run --rm --no-deps tests python tests/docker_cache.py
}
Invoke-DemoStep 'Create a fresh URL to prove persistence (do not navigate to it yet)' {
    $script:PersistenceDemo = New-DemoUrl
    Write-Host "Record this URL: $BaseUrl/$($script:PersistenceDemo.short_code)"
    Assert-Equal (Get-DemoClicks $script:PersistenceDemo.short_code) 0 'Initial count'
}
Invoke-DemoStep 'Remove and recreate Compose containers without deleting the named volume' {
    if (-not $script:PersistenceDemo) { throw 'Start at step 3 to create the persistence marker.' }
    Invoke-Compose down
    Invoke-Compose up -d --wait --wait-timeout 180
    $code = $script:PersistenceDemo.short_code
    Assert-Equal (Invoke-Compose exec -T redis redis-cli EXISTS "url:$code") 0 'Redis cache is disposable'
    Assert-Equal (Get-DemoClicks $code) 0 'PostgreSQL row survived'
    Assert-Equal (Get-DemoStatus "$BaseUrl/$code") 302 'Redirect after recreation'
    Assert-Equal (Get-DemoClicks $code) 1 'Counter survived and incremented'
    Assert-Equal (Invoke-Compose exec -T redis redis-cli EXISTS "url:$code") 1 'Cache rebuilt'
    Invoke-RestMethod -Method Delete -Uri "$BaseUrl/api/urls/$code" | Out-Null
}
Invoke-DemoStep 'Close the seminar and discuss Q&A' {
    Write-Host 'Image: runtime + dependencies. Container: process. Ports: browser access.'
    Write-Host 'Registry: distribute images. Network: container DNS. Volume: persistent data.'
    Write-Host 'Compose: declarative orchestration. Redis: disposable cache. CI: repeatable checks.'
    Write-Host 'Q&A: EXPOSE vs ports? localhost? Why does init.sql not run again? Why is 410 not a click?'
    Write-Host 'The stack stays running. Use phase 00-reset only when you want to prepare another rehearsal.'
}
