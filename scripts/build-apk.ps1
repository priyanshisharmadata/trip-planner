[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$projectRoot = Split-Path -Parent $PSScriptRoot
$toolsRoot = Join-Path $projectRoot '.tools'
$sdkRoot = Join-Path $toolsRoot 'android-sdk'
$jdkRoot = Join-Path $toolsRoot 'jdk17'
$jdkStamp = Join-Path $jdkRoot 'verified.json'

try {
    if (-not (Test-Path -LiteralPath $jdkStamp)) { throw 'Run scripts/setup-android.ps1 first.' }
    $jdkRecord = Get-Content -LiteralPath $jdkStamp -Raw | ConvertFrom-Json
    $jdkHome = [IO.Path]::GetFullPath((Join-Path $jdkRoot $jdkRecord.directory))
    if (-not $jdkHome.StartsWith(([IO.Path]::GetFullPath($jdkRoot) + [IO.Path]::DirectorySeparatorChar), [StringComparison]::OrdinalIgnoreCase)) {
        throw 'The portable JDK path must remain inside .tools/jdk17.'
    }
    $buildTools = Join-Path $sdkRoot 'build-tools\36.0.0'
    foreach ($required in @((Join-Path $jdkHome 'bin\java.exe'), (Join-Path $buildTools 'apksigner.bat'), (Join-Path $buildTools 'aapt.exe'))) {
        if (-not (Test-Path -LiteralPath $required)) { throw "Missing $required. Run scripts/setup-android.ps1 first." }
    }

    # Environment changes apply only to this process and its child build tools.
    $env:JAVA_HOME = $jdkHome
    $env:ANDROID_HOME = $sdkRoot
    $env:ANDROID_SDK_ROOT = $sdkRoot
    $env:ANDROID_USER_HOME = Join-Path $toolsRoot 'android-user'
    $env:GRADLE_USER_HOME = Join-Path $toolsRoot 'gradle'
    $env:PATH = "$jdkHome\bin;$sdkRoot\platform-tools;$env:PATH"
    $env:CI = '1'
    $env:NODE_ENV = 'production'

    Push-Location $projectRoot
    try {
        # Synchronize versionCode and config plugins while retaining native build caches.
        Write-Host 'Synchronizing the Android project with Expo ...'
        & npx.cmd expo prebuild --platform android --no-install --no-clean
        if ($LASTEXITCODE -ne 0) { throw "Expo prebuild failed ($LASTEXITCODE)." }
        Push-Location (Join-Path $projectRoot 'android')
        try {
            Write-Host 'Building the standalone release APK for 64-bit and 32-bit ARM phones ...'
            # A single JVM avoids competing compiler heaps on this 8 GB machine.
            # Incremental Kotlin caches cannot mix canonical D: sources and the short drive alias.
            & .\gradlew.bat ':app:assembleRelease' '-Pandroid.cmakeVersion=3.30.5' '-PreactNativeArchitectures=arm64-v8a,armeabi-v7a' '-Pkotlin.compiler.execution.strategy=in-process' '-Pkotlin.incremental=false' '-Dorg.gradle.jvmargs=-Xmx2048m -XX:MaxMetaspaceSize=1024m' '--max-workers=1' '--no-daemon' '--console=plain'
            if ($LASTEXITCODE -ne 0) { throw "Android release build failed ($LASTEXITCODE)." }
        } finally { Pop-Location }
    } finally { Pop-Location }

    $builtApk = Join-Path $projectRoot 'android\app\build\outputs\apk\release\app-release.apk'
    if (-not (Test-Path -LiteralPath $builtApk)) { throw "The build did not produce $builtApk." }
    Write-Host 'Verifying APK signing ...'
    & (Join-Path $buildTools 'apksigner.bat') verify --verbose --print-certs $builtApk
    if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $apkArchive = [IO.Compression.ZipFile]::OpenRead($builtApk)
    try {
        $jsBundle = $apkArchive.GetEntry('assets/index.android.bundle')
        if (-not $jsBundle -or $jsBundle.Length -eq 0) { throw 'The APK does not contain the standalone JavaScript bundle.' }
        Write-Host "Bundled application code verified: $($jsBundle.Length) bytes."
    } finally { $apkArchive.Dispose() }

    $metadata = & (Join-Path $buildTools 'aapt.exe') dump badging $builtApk
    if ($LASTEXITCODE -ne 0) { throw 'APK metadata verification failed.' }
    $metadata | Select-String -Pattern '^package:', '^sdkVersion:', '^targetSdkVersion:', '^application-label:', '^native-code:' | ForEach-Object { Write-Host $_.Line }

    $artifactRoot = Join-Path $projectRoot 'artifacts'
    New-Item -ItemType Directory -Path $artifactRoot -Force | Out-Null
    $artifact = Join-Path $artifactRoot 'roam-trip-planner.apk'
    Copy-Item -LiteralPath $builtApk -Destination $artifact -Force
    $checksum = (Get-FileHash -LiteralPath $artifact -Algorithm SHA256).Hash.ToLowerInvariant()
    Set-Content -LiteralPath "$artifact.sha256" -Value "$checksum  roam-trip-planner.apk" -Encoding ASCII
    Write-Host "Standalone APK: $artifact"
    Write-Host "Size: $([Math]::Round((Get-Item -LiteralPath $artifact).Length / 1MB, 1)) MB"
    Write-Host "SHA-256: $checksum"
    Write-Host 'Copy the APK to your Android phone and open it to install. Expo Go and Metro are not required; online account actions require internet.'
} catch {
    Write-Error $_ -ErrorAction Continue
    exit 1
}
