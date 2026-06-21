param(
    [switch]$NoDb,
    [switch]$NoGit,
    [switch]$NoRestart,
    [switch]$Deploy,
    [string]$DbSource = "C:\HughsGolf\Files\HughsGolf.db",
    [string]$WebCode = $PSScriptRoot,
    [int]$Port = 8445
)

$ErrorActionPreference = "Stop"

function Write-Step($Message) {
    Write-Host ""
    Write-Host $Message -ForegroundColor Cyan
}

function Write-Ok($Message) {
    Write-Host "  OK  $Message" -ForegroundColor Green
}

function Write-Warn($Message) {
    Write-Host "  WARN  $Message" -ForegroundColor Yellow
}

Write-Host "======================================="
Write-Host "  HughsGolf Windows Update Script"
Write-Host "======================================="

if (-not (Test-Path -LiteralPath $WebCode)) {
    throw "WebCode folder not found: $WebCode"
}

Set-Location -LiteralPath $WebCode

$changed = $false

Write-Step "Checking web files..."
foreach ($file in @("app.py", "HughsGolf.html")) {
    if (Test-Path -LiteralPath (Join-Path $WebCode $file)) {
        Write-Ok "Found $file"
    } else {
        Write-Warn "Missing $file"
    }
}

if (-not $NoDb) {
    Write-Step "Copying DB..."
    if (Test-Path -LiteralPath $DbSource) {
        Copy-Item -LiteralPath $DbSource -Destination (Join-Path $WebCode "HughsGolf.db") -Force
        Write-Ok "Copied HughsGolf.db from $DbSource"
    } else {
        Write-Warn "DB source not found: $DbSource"
    }
}

Write-Step "Current versions..."
$appVersion = "unknown"
if (Test-Path -LiteralPath (Join-Path $WebCode "app.py")) {
    $appLine = Select-String -Path (Join-Path $WebCode "app.py") -Pattern "^VERSION\s*=" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($appLine -and $appLine.Line -match "['""]([^'""]+)['""]") { $appVersion = $Matches[1] }
}

$htmlVersion = "unknown"
if (Test-Path -LiteralPath (Join-Path $WebCode "HughsGolf.html")) {
    $htmlLine = Select-String -Path (Join-Path $WebCode "HughsGolf.html") -Pattern "v202[0-9]*\.[0-9]*" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($htmlLine -and $htmlLine.Line -match "(v202[0-9]*\.[0-9]*)") { $htmlVersion = $Matches[1] }
}

Write-Host "  app.py:         $appVersion"
Write-Host "  HughsGolf.html: $htmlVersion"

if (-not $NoGit) {
    Write-Step "Checking Git changes..."
    $status = git status --short
    if ($status) {
        $changed = $true
        $status | ForEach-Object { Write-Host "  $_" }

        Write-Step "Committing and pushing..."
        git add app.py HughsGolf.html .gitignore update_hughsgolf.ps1
        if ($LASTEXITCODE -ne 0) { throw "git add failed" }

        $message = if ($htmlVersion -ne "unknown") { $htmlVersion } else { "Windows update" }
        git commit -m $message
        if ($LASTEXITCODE -ne 0) { throw "git commit failed" }

        git push origin main
        if ($LASTEXITCODE -ne 0) { throw "git push failed; run git pull/rebase and retry" }

        Write-Ok "Pushed to GitHub"
    } else {
        Write-Ok "No Git changes to commit"
    }
}

if ($Deploy) {
    Write-Step "Deploy requested..."
    Write-Warn "QNAP deploy is not wired in this Windows script yet. Use GitHub pull on the target or extend this block with scp/ssh settings."
}

if (-not $NoRestart) {
    Write-Step "Restarting Flask locally..."
    Get-CimInstance Win32_Process |
        Where-Object {
            ($_.CommandLine -match "app\.py") -or
            ($_.CommandLine -match "python" -and $_.CommandLine -match [regex]::Escape($WebCode))
        } |
        ForEach-Object {
            try {
                Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop
                Write-Ok "Stopped process $($_.ProcessId)"
            } catch {
                Write-Warn "Could not stop process $($_.ProcessId): $($_.Exception.Message)"
            }
        }

    $python = Get-Command python -ErrorAction SilentlyContinue
    if (-not $python) { $python = Get-Command py -ErrorAction SilentlyContinue }
    if ($python) {
        Start-Process -FilePath $python.Source -ArgumentList "app.py" -WorkingDirectory $WebCode -WindowStyle Hidden
        Start-Sleep -Seconds 2
        Write-Ok "HughsGolf running at http://localhost:$Port"
    } else {
        Write-Warn "Python command not found; Flask was not restarted"
    }
}

Write-Host ""
Write-Host "Done."
