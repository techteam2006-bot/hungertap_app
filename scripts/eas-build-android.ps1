# Build Android APK or AAB on EAS (production signing via remote credentials).
# Usage:
#   .\scripts\eas-build-android.ps1 apk
#   .\scripts\eas-build-android.ps1 aab

param(
    [Parameter(Position = 0)]
    [ValidateSet("apk", "aab")]
    [string]$Target = "aab"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$profile = if ($Target -eq "aab") { "production" } else { "apk" }
$ext = if ($Target -eq "aab") { "aab" } else { "apk" }
$outSubdir = if ($Target -eq "aab") { "aab" } else { "apk" }

Push-Location $root
try {
    Write-Host "Starting EAS build (profile: $profile)..." -ForegroundColor Cyan
    eas build -p android --profile $profile --non-interactive
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    $listJson = eas build:list --platform android --status finished --limit 1 --json --non-interactive 2>$null
    if (-not $listJson) {
        Write-Error "Could not read latest EAS build. Download manually from https://expo.dev"
    }
    $latest = ($listJson | ConvertFrom-Json)[0]
    $buildId = $latest.id
    if (-not $buildId) {
        Write-Error "No finished Android build found to download."
    }

    $downloadDir = Join-Path $root ("builds\{0}" -f $outSubdir)
    New-Item -ItemType Directory -Force -Path $downloadDir | Out-Null
    Push-Location $downloadDir
    try {
        eas build:download --build-id $buildId --non-interactive
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

        $downloaded = Get-ChildItem -Path $downloadDir -Filter "*.$ext" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if (-not $downloaded) {
            $cache = Join-Path $env:LOCALAPPDATA "Temp\eas-cli-nodejs\eas-build-run-cache"
            $cached = Get-ChildItem -Path $cache -Filter "*$buildId*.$ext" -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($cached) {
                $downloaded = $cached
            }
        }

        $buildGradle = Get-Content (Join-Path $root "android\app\build.gradle") -Raw
        $versionName = [regex]::Match($buildGradle, 'versionName\s+"([^"]+)"').Groups[1].Value
        $versionCode = [regex]::Match($buildGradle, 'versionCode\s+(\d+)').Groups[1].Value
        $dest = Join-Path $downloadDir ("HungerTap-{0}-v{1}.$ext" -f $versionName, $versionCode)

        if ($downloaded) {
            Copy-Item $downloaded.FullName $dest -Force
            Write-Host ""
            Write-Host "Saved to:" -ForegroundColor Green
            Write-Host $dest
        } else {
            Write-Host "Build finished. Download from:" -ForegroundColor Yellow
            Write-Host $latest.buildUrl
        }
    } finally {
        Pop-Location
    }
} finally {
    Pop-Location
}
