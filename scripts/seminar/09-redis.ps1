[CmdletBinding()]
param(
    [ValidateRange(1, 20)][int]$FromStep = 1,
    [switch]$ListSteps,
    [switch]$NonInteractive,
    [string]$ProjectName = 'url-shortener-seminar',
    [string]$BaseUrl = 'http://localhost:8080'
)
. "$PSScriptRoot/common.ps1"

Invoke-DemoStep 'Validate, build and start the four-service stack' {
    Invoke-Compose config --quiet
    Invoke-Compose up -d --build --wait --wait-timeout 180
    Invoke-Compose --profile test build tests
    Wait-DemoRedis
}
Invoke-DemoStep 'Cache MISS: create a fresh one-day URL, redirect, inspect Redis and PostgreSQL' {
    $script:CacheDemo = New-DemoUrl
    $code = $script:CacheDemo.short_code
    Assert-Equal (Invoke-Compose exec -T redis redis-cli EXISTS "url:$code") 0 'New key absent'
    Assert-Equal (Get-DemoStatus "$BaseUrl/$code") 302 'MISS redirect'
    Invoke-Compose exec -T redis redis-cli GET "url:$code"
    Invoke-Compose exec -T redis redis-cli TTL "url:$code"
    Assert-Equal (Get-DemoClicks $code) 1 'Click count after MISS'
    Invoke-Compose logs --since 1m --tail 30 backend
}
Invoke-DemoStep 'Cache HIT: reuse the same URL; SQL still validates and counts' {
    if (-not $script:CacheDemo) { throw 'Run step 2 first to create the demo URL.' }
    $code = $script:CacheDemo.short_code
    Assert-Equal (Get-DemoStatus "$BaseUrl/$code") 302 'HIT redirect'
    Assert-Equal (Get-DemoClicks $code) 2 'Click count after HIT'
    Invoke-Compose logs --since 1m --tail 30 backend
}
Invoke-DemoStep 'Stop Redis: PostgreSQL fallback still redirects and counts; always restore Redis' {
    $url = New-DemoUrl
    try {
        Invoke-Compose stop redis
        Assert-Equal (Get-DemoStatus "$BaseUrl/$($url.short_code)") 302 'Fallback redirect'
        Assert-Equal (Get-DemoClicks $url.short_code) 1 'Click count without Redis'
        Invoke-Compose --profile test run --rm --no-deps tests python tests/docker_cache.py --fallback
        Invoke-Compose logs --since 1m --tail 30 backend
    } finally {
        Invoke-Compose start redis
        Wait-DemoRedis
        Invoke-RestMethod -Method Delete -Uri "$BaseUrl/api/urls/$($url.short_code)" | Out-Null
    }
}
Invoke-DemoStep '9.6: DELETE invalidates this URL key; the next redirect returns 404' {
    $url = New-DemoUrl
    $code = $url.short_code
    try {
        Assert-Equal (Get-DemoStatus "$BaseUrl/$code") 302 'Warm cache'
        Assert-Equal (Invoke-Compose exec -T redis redis-cli EXISTS "url:$code") 1 'Key before delete'
        Invoke-RestMethod -Method Delete -Uri "$BaseUrl/api/urls/$code" | Out-Null
        Assert-Equal (Invoke-Compose exec -T redis redis-cli EXISTS "url:$code") 0 'Key after delete'
        Assert-Equal (Get-DemoStatus "$BaseUrl/$code") 404 'Deleted redirect'
    } finally {
        # A repeated DELETE returns 404, which is expected during cleanup.
        try { Invoke-RestMethod -Method Delete -Uri "$BaseUrl/api/urls/$code" | Out-Null } catch {
            if ([int]$_.Exception.Response.StatusCode -ne 404) { throw }
        }
    }
}
Invoke-DemoStep '9.6: warm an eight-second URL, verify 410 and unchanged clicks after expiration' {
    $url = New-DemoUrl -Seconds 8
    $code = $url.short_code
    try {
        Assert-Equal (Get-DemoStatus "$BaseUrl/$code") 302 'Valid redirect'
        Invoke-Compose exec -T redis redis-cli TTL "url:$code"
        $deadline = [DateTimeOffset]::Parse($url.expires_at)
        while ([DateTimeOffset]::UtcNow -le $deadline.AddSeconds(1)) { Start-Sleep -Milliseconds 250 }
        Assert-Equal (Get-DemoStatus "$BaseUrl/$code") 410 'Expired redirect'
        Assert-Equal (Get-DemoClicks $code) 1 'Expired requests do not increment'
        Assert-Equal (Invoke-Compose exec -T redis redis-cli EXISTS "url:$code") 0 'Expired cache absent'
    } finally {
        Invoke-RestMethod -Method Delete -Uri "$BaseUrl/api/urls/$code" | Out-Null
    }
}
Invoke-DemoStep 'Run real Redis cache checks and HTTP smoke tests through Nginx' {
    Invoke-Compose --profile test run --rm --no-deps tests python tests/docker_cache.py
    Invoke-Compose --profile test run --rm --no-deps -e SMOKE_BASE_URL=http://frontend:8080 tests
    if ($script:CacheDemo) {
        Invoke-RestMethod -Method Delete -Uri "$BaseUrl/api/urls/$($script:CacheDemo.short_code)" | Out-Null
    }
}
