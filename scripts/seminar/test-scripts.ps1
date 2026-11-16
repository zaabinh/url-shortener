# Static validation and side-effect-free listing for every phase.
$ErrorActionPreference = 'Stop'
$files = @(Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*.ps1')
foreach ($file in $files) {
    $parseErrors = $null
    $null = [System.Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$null, [ref]$parseErrors)
    if ($parseErrors.Count -gt 0) { throw "$($file.Name): $parseErrors" }
}
foreach ($file in $files | Where-Object { $_.Name -match '^\d\d-' }) {
    $output = @(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $file.FullName -ListSteps)
    if ($LASTEXITCODE -ne 0) { throw "Listing failed: $($file.Name)" }
    $steps = @($output | Where-Object { $_ -match '^\[\d+\] ' })
    if ($steps.Count -lt 2) { throw "Too few presentation breaks in $($file.Name)" }
    for ($index = 0; $index -lt $steps.Count; $index++) {
        if ($steps[$index] -notmatch ('^\[' + ($index + 1) + '\] ')) { throw "Invalid step order: $($file.Name)" }
    }
    Write-Host "PASS $($file.Name): parses, lists $($steps.Count) steps without running demo actions"
}

# Exercise the common step gate and external-command failure propagation.
$FromStep = 2
$ListSteps = $false
$NonInteractive = $true
. "$PSScriptRoot/common.ps1"
$script:Executed = @()
Invoke-DemoStep 'Skipped step' { $script:Executed += 1 }
Invoke-DemoStep 'Executed step' { $script:Executed += 2 }
Assert-Equal ($script:Executed -join ',') '2' 'FromStep gate'
$ListSteps = $true
Invoke-DemoStep 'List only' { throw 'ListSteps ran a mutation' }
function docker { $global:LASTEXITCODE = 7 }
try {
    $caught = $false
    try { Invoke-Docker invalid } catch { $caught = $_.Exception.Message -like 'Docker failed*' }
    Assert-Equal $caught $true 'Nonzero Docker exit throws'
} finally { Remove-Item Function:docker }

# Q at a presentation break must stop before executing the action.
$ListSteps = $false
$NonInteractive = $false
function Read-Host { return 'q' }
try {
    $stopped = $false
    try { Invoke-DemoStep 'Quit before mutation' { throw 'Unexpected action execution' } }
    catch { $stopped = $_.Exception.Message -like 'Demo stopped by presenter*' }
    Assert-Equal $stopped $true 'Q stops before the action'
} finally { Remove-Item Function:Read-Host }

# A shared base/application image must never reach the image-removal command.
. "$PSScriptRoot/00-reset.ps1" -ListSteps
function docker {
    $global:LASTEXITCODE = 0
    if ($args[0] -eq 'ps') { return 'unrelated-project-container' }
    throw 'Shared-image guard attempted a mutation'
}
try { Remove-UnusedImage 'postgres:17-alpine' } finally { Remove-Item Function:docker }
Write-Host 'PASS: images used by other containers are retained'
Write-Host "All $($files.Count) PowerShell files parsed successfully."
