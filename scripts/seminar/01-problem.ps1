[CmdletBinding()]
param([int]$FromStep = 1, [switch]$ListSteps, [switch]$NonInteractive)
. "$PSScriptRoot/common.ps1"

Invoke-DemoStep 'Create an empty Python environment without changing the working environment' {
    & python -m venv "$DemoRoot/.venv-empty"
    if ($LASTEXITCODE -ne 0) { throw 'Failed to create the empty environment.' }
}
Invoke-DemoStep 'Run Uvicorn with the empty interpreter; missing uvicorn is the expected failure' {
    $oldPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $output = & "$DemoRoot/.venv-empty/Scripts/python.exe" -m uvicorn app.main:app 2>&1
        $result = $LASTEXITCODE
    } finally { $ErrorActionPreference = $oldPreference }
    Write-Host ($output -join [Environment]::NewLine)
    if ($result -eq 0 -or "$output" -notmatch 'No module named uvicorn') {
        throw 'Expected missing uvicorn. This environment may already contain packages.'
    }
    Write-Host 'Expected failure reproduced. Explain runtime + dependency packaging with Docker.'
}
