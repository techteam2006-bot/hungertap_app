# Build a release APK locally with Gradle (no EAS / Expo cloud).
# Usage:
#   .\scripts\build-apk-local.ps1
#   .\scripts\build-apk-local.ps1 -Debug
#
# Optional release signing: copy android\keystore.properties.example → android\keystore.properties
# and point storeFile to your .jks / .keystore (e.g. downloaded from EAS credentials).

param(
    [switch]$Debug
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "build-android-local-common.ps1")

$root = Split-Path -Parent $PSScriptRoot
$androidDir = Join-Path $root "android"
$appDir = Join-Path $androidDir "app"
$debugKeystore = Join-Path $appDir "debug.keystore"

Push-Location $root
try {
    if (-not (Test-Path (Join-Path $root "node_modules"))) {
        Write-Host "Installing npm dependencies..." -ForegroundColor Cyan
        npm install
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }

    Import-ProjectDotEnv -Root $root
    Ensure-DebugKeystore -DebugKeystore $debugKeystore
    Ensure-AndroidSdk -AndroidDir $androidDir

    $task = if ($Debug) { "assembleDebug" } else { "assembleRelease" }
    $variant = if ($Debug) { "debug" } else { "release" }

    Write-Host "Running Gradle $task (local, no EAS)..." -ForegroundColor Cyan
    Push-Location $androidDir
    try {
        Set-AndroidBuildEnv -AndroidDir $androidDir

        $gradlew = Join-Path $androidDir "gradlew.bat"
        & $gradlew $task --no-daemon -PreactNativeArchitectures=arm64-v8a
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    } finally {
        Pop-Location
    }

    $apkPath = Join-Path $appDir "build\outputs\apk\$variant\app-$variant.apk"
    if (-not (Test-Path $apkPath)) {
        throw "APK not found at $apkPath"
    }

    $version = Get-AppVersionInfo -AppBuildGradle (Join-Path $appDir "build.gradle")
    $suffix = if ($Debug) { "debug" } else { "release" }

    $outDir = Join-Path $root "builds\apk"
    New-Item -ItemType Directory -Force -Path $outDir | Out-Null
    $dest = Join-Path $outDir ("HungerTap-{0}-v{1}-{2}.apk" -f $version.VersionName, $version.VersionCode, $suffix)
    Copy-Item $apkPath $dest -Force

    Write-Host ""
    Write-Host "APK built successfully:" -ForegroundColor Green
    Write-Host $dest
    Write-Host ""
    if (-not $Debug -and -not (Test-Path (Join-Path $androidDir "keystore.properties"))) {
        Write-Host "Note: Without android\keystore.properties this APK is signed with the debug keystore." -ForegroundColor Yellow
        Write-Host "      Fine for internal testing. Play Store needs your production keystore in keystore.properties." -ForegroundColor Yellow
    }
} finally {
    Pop-Location
}
