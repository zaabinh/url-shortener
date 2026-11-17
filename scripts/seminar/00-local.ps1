[CmdletBinding()]
param([int]$FromStep = 1, [switch]$ListSteps, [switch]$NonInteractive,
      [string]$BaseUrl = 'http://localhost:8000')
. "$PSScriptRoot/manual.ps1"

Invoke-DemoStep 'Confirm the local Python environment and application contract' {
    Invoke-LocalPython --version
    Write-Host 'Use backend/.env for PostgreSQL; set REDIS_URL= to disable cache.'
    Write-Host 'POST/list/delete: /api/urls. Redirect: /{short_code}. Health: /app/health.'
}
Invoke-DemoStep 'Install the hashed dev lock and run backend unit tests' {
    Push-Location "$DemoRoot/backend"
    try {
        Invoke-LocalPython -m pip install --require-hashes --only-binary=:all: -r requirements-dev.txt
        Invoke-LocalPython -m pytest -q
    } finally { Pop-Location }
}
Invoke-DemoStep 'Create missing local tables; explain that this is not a migration' {
    Push-Location "$DemoRoot/backend"
    try { Invoke-LocalPython -m app.db.init_db } finally { Pop-Location }
    Write-Host 'In another terminal: cd backend; .\.venv\Scripts\python.exe -m uvicorn app.main:app --reload'
}
Invoke-DemoStep 'With the local server running, test CRUD, redirect, clicks and expiration' {
    Invoke-ManualSmoke $BaseUrl
}
