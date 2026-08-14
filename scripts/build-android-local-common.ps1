function Import-ProjectDotEnv {
    param([string]$Root)
    $envFile = Join-Path $Root ".env"
    if (-not (Test-Path $envFile)) {
        Write-Host "Warning: .env not found - EXPO_PUBLIC_* vars must be set in the environment." -ForegroundColor Yellow
        return
    }
    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith('#')) { return }
        $eq = $line.IndexOf('=')
        if ($eq -lt 1) { return }
        $name = $line.Substring(0, $eq).Trim()
        $value = $line.Substring($eq + 1).Trim()
        if ($value.StartsWith('"') -and $value.EndsWith('"')) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        if ($name.StartsWith('EXPO_PUBLIC_') -or $name -eq 'NODE_ENV') {
            Set-Item -Path "Env:$name" -Value $value
        }
    }
    Write-Host "Loaded EXPO_PUBLIC_* from .env" -ForegroundColor DarkGray
}

function Ensure-AndroidSdk {
    param([string]$AndroidDir)

    $localProps = Join-Path $AndroidDir "local.properties"
    if (Test-Path $localProps) {
        $content = Get-Content $localProps -Raw
        if ($content -match 'sdk\.dir=') { return }
    }

    $candidates = @(
        $env:ANDROID_HOME,
        $env:ANDROID_SDK_ROOT,
        "C:\Android\Sdk",
        (Join-Path $env:LOCALAPPDATA "Android\Sdk"),
        (Join-Path $env:USERPROFILE "AppData\Local\Android\Sdk"),
        (Join-Path $env:USERPROFILE "Android\Sdk")
    ) | Where-Object { $_ -and (Test-Path $_) }

    $sdk = $candidates | Select-Object -First 1
    if (-not $sdk) {
        $msg = @(
            "Android SDK not found.",
            "",
            "Install Android Studio, then open SDK Manager and install:",
            "  * Android SDK Platform 35",
            "  * Android SDK Build-Tools 35",
            "  * NDK 27.1.12297006 (Side by side)",
            "",
            "Set ANDROID_HOME to your SDK folder, e.g.:",
            "  $env:LOCALAPPDATA\Android\Sdk",
            "",
            "Or create android\local.properties with:",
            "  sdk.dir=C:/Android/Sdk"
        ) -join [Environment]::NewLine
        throw $msg
    }

    $escaped = ($sdk -replace '\\', '/')
    Set-Content -Path $localProps -Value "sdk.dir=$escaped" -Encoding ASCII
    Write-Host "Wrote android\local.properties -> $sdk" -ForegroundColor DarkGray
}

function Ensure-DebugKeystore {
    param([string]$DebugKeystore)
    if (Test-Path $DebugKeystore) { return }
    Write-Host "Creating debug.keystore (required for local signing)..." -ForegroundColor Yellow
    $keytoolCmd = Get-Command keytool -ErrorAction SilentlyContinue
    $keytool = if ($keytoolCmd) { $keytoolCmd.Source } else { $null }
    if (-not $keytool) {
        throw "keytool not found. Install JDK 17+ and ensure keytool is on PATH."
    }
    & $keytool -genkeypair -v -storetype PKCS12 `
        -keystore $DebugKeystore `
        -alias androiddebugkey `
        -keyalg RSA -keysize 2048 -validity 10000 `
        -storepass android -keypass android `
        -dname "CN=Android Debug,O=Android,C=US"
    if ($LASTEXITCODE -ne 0) { throw "Failed to create debug.keystore" }
}

function Set-AndroidBuildEnv {
    param([string]$AndroidDir)

    $env:SENTRY_DISABLE_AUTO_UPLOAD = "true"
    if (-not $env:NODE_ENV) { $env:NODE_ENV = "production" }

    if (-not $env:ANDROID_HOME -and -not $env:ANDROID_SDK_ROOT) {
        $sdkFromProps = $null
        $localProps = Join-Path $AndroidDir "local.properties"
        if (Test-Path $localProps) {
            $match = [regex]::Match((Get-Content $localProps -Raw), 'sdk\.dir=(.+)')
            if ($match.Success) {
                $sdkFromProps = ($match.Groups[1].Value.Trim() -replace '\\:', ':' -replace '\\\\', '\')
            }
        }
        if ($sdkFromProps -and (Test-Path $sdkFromProps)) {
            $env:ANDROID_HOME = $sdkFromProps
            $env:ANDROID_SDK_ROOT = $sdkFromProps
        }
    }

    if ($env:ANDROID_HOME) {
        Write-Host "ANDROID_HOME=$($env:ANDROID_HOME)" -ForegroundColor DarkGray
    }
}

function Get-AppVersionInfo {
    param([string]$AppBuildGradle)
    $content = Get-Content $AppBuildGradle -Raw
    $nameMatch = [regex]::Match($content, 'versionName\s+"([^"]+)"')
    $codeMatch = [regex]::Match($content, 'versionCode\s+(\d+)')
    return @{
        VersionName = $nameMatch.Groups[1].Value
        VersionCode = $codeMatch.Groups[1].Value
    }
}
