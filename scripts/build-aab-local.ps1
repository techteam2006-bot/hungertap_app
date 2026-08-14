# Build a signed release AAB locally with Gradle (Play Store upload).
# Requires android\keystore.properties + upload keystore from EAS credentials.
#
# Usage:
#   .\scripts\build-aab-local.ps1

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "build-android-local-common.ps1")

$root = Split-Path -Parent $PSScriptRoot
$androidDir = Join-Path $root "android"
$appDir = Join-Path $androidDir "app"
$debugKeystore = Join-Path $appDir "debug.keystore"
$keystoreProps = Join-Path $androidDir "keystore.properties"

Push-Location $root
try {
    if (-not (Test-Path (Join-Path $root "node_modules"))) {
        Write-Host "Installing npm dependencies..." -ForegroundColor Cyan
        npm install
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }

    if (-not (Test-Path $keystoreProps)) {
        throw "Missing android\keystore.properties - copy keystore.properties.example and add your EAS upload keystore."
    }

    Import-ProjectDotEnv -Root $root
    Ensure-DebugKeystore -DebugKeystore $debugKeystore
    Ensure-AndroidSdk -AndroidDir $androidDir

    Write-Host "Running Gradle bundleRelease (local Play Store AAB)..." -ForegroundColor Cyan
    Push-Location $androidDir
    try {
        Set-AndroidBuildEnv -AndroidDir $androidDir
        $gradlew = Join-Path $androidDir "gradlew.bat"
        & $gradlew bundleRelease --no-daemon
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    } finally {
        Pop-Location
    }

    $aabPath = Join-Path $appDir "build\outputs\bundle\release\app-release.aab"
    if (-not (Test-Path $aabPath)) {
        throw "AAB not found at $aabPath"
    }

    $version = Get-AppVersionInfo -AppBuildGradle (Join-Path $appDir "build.gradle")
    $outDir = Join-Path $root "builds\aab"
    New-Item -ItemType Directory -Force -Path $outDir | Out-Null
    $dest = Join-Path $outDir ("HungerTap-{0}-v{1}.aab" -f $version.VersionName, $version.VersionCode)
    Copy-Item $aabPath $dest -Force

    Write-Host ""
    Write-Host "AAB built successfully:" -ForegroundColor Green
    Write-Host $dest
} finally {
    Pop-Location
}
