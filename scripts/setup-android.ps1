[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$projectRoot = Split-Path -Parent $PSScriptRoot
$toolsRoot = Join-Path $projectRoot '.tools'
$downloadRoot = Join-Path $toolsRoot 'downloads'
$jdkRoot = Join-Path $toolsRoot 'jdk17'
$sdkRoot = Join-Path $toolsRoot 'android-sdk'
$androidUserRoot = Join-Path $toolsRoot 'android-user'

function Get-VerifiedDownload {
    param([string]$Uri, [string]$Path, [string]$Sha256)
    if (Test-Path -LiteralPath $Path) {
        if ((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -eq $Sha256) {
            Write-Host "Using verified download: $([IO.Path]::GetFileName($Path))"
            return
        }
        Write-Host "Replacing incomplete download: $([IO.Path]::GetFileName($Path))"
    }
    Write-Host "Downloading $([IO.Path]::GetFileName($Path)) ..."
    Invoke-WebRequest -Uri $Uri -OutFile $Path -UseBasicParsing -TimeoutSec 1800
    if ((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -ne $Sha256) {
        throw "SHA-256 verification failed for $Path. No archive will be extracted."
    }
}

try {
    foreach ($directory in @($toolsRoot, $downloadRoot, $jdkRoot, $sdkRoot, $androidUserRoot)) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }

    $jdkStamp = Join-Path $jdkRoot 'verified.json'
    $jdkHome = $null
    if (Test-Path -LiteralPath $jdkStamp) {
        $jdkRecord = Get-Content -LiteralPath $jdkStamp -Raw | ConvertFrom-Json
        $candidate = [IO.Path]::GetFullPath((Join-Path $jdkRoot $jdkRecord.directory))
        if ($candidate.StartsWith(([IO.Path]::GetFullPath($jdkRoot) + [IO.Path]::DirectorySeparatorChar), [StringComparison]::OrdinalIgnoreCase) -and
            (Test-Path -LiteralPath (Join-Path $candidate 'bin\java.exe')) -and
            (Test-Path -LiteralPath (Join-Path $candidate 'bin\javac.exe'))) {
            $jdkHome = $candidate
            Write-Host "Using verified portable JDK 17: $jdkHome"
        }
    }
    if (-not $jdkHome) {
        Write-Host 'Resolving the official Eclipse Temurin JDK 17 Windows x64 package ...'
        $metadataUri = 'https://api.adoptium.net/v3/assets/latest/17/hotspot?architecture=x64&image_type=jdk&os=windows&vendor=eclipse'
        $releases = (Invoke-WebRequest -Uri $metadataUri -UseBasicParsing -TimeoutSec 90).Content | ConvertFrom-Json
        $release = @($releases)[0]
        $package = $release.binary.package
        if (-not $package.link -or $package.checksum -notmatch '^[0-9a-fA-F]{64}$') {
            throw 'Adoptium did not return a package with a valid SHA-256 checksum.'
        }
        $jdkZip = Join-Path $downloadRoot 'temurin-jdk17-windows-x64.zip'
        Get-VerifiedDownload -Uri $package.link -Path $jdkZip -Sha256 $package.checksum
        Write-Host 'Extracting JDK 17 ...'
        Expand-Archive -LiteralPath $jdkZip -DestinationPath $jdkRoot -Force
        $jdkDirectory = Get-ChildItem -LiteralPath $jdkRoot -Directory | Where-Object {
            (Test-Path -LiteralPath (Join-Path $_.FullName 'bin\java.exe')) -and
            (Test-Path -LiteralPath (Join-Path $_.FullName 'bin\javac.exe'))
        } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if (-not $jdkDirectory) { throw 'The extracted JDK is missing java.exe or javac.exe.' }
        $jdkHome = $jdkDirectory.FullName
        @{ directory = $jdkDirectory.Name; sha256 = $package.checksum; version = $release.version.semver } |
            ConvertTo-Json | Set-Content -LiteralPath $jdkStamp -Encoding UTF8
    }

    $env:JAVA_HOME = $jdkHome
    $env:ANDROID_HOME = $sdkRoot
    $env:ANDROID_SDK_ROOT = $sdkRoot
    $env:ANDROID_USER_HOME = $androidUserRoot
    $env:GRADLE_USER_HOME = Join-Path $toolsRoot 'gradle'
    $env:PATH = "$jdkHome\bin;$sdkRoot\platform-tools;$env:PATH"
    & (Join-Path $jdkHome 'bin\javac.exe') -version
    if ($LASTEXITCODE -ne 0) { throw 'The portable JDK could not run.' }

    $commandLineRoot = Join-Path $sdkRoot 'cmdline-tools'
    $latestRoot = Join-Path $commandLineRoot 'latest'
    $sdkManager = Join-Path $latestRoot 'bin\sdkmanager.bat'
    $toolsStamp = Join-Path $latestRoot '.verified-sha256'
    $toolsHash = '90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a'
    if (-not ((Test-Path -LiteralPath $sdkManager) -and (Test-Path -LiteralPath $toolsStamp) -and
        ((Get-Content -LiteralPath $toolsStamp -Raw).Trim() -eq $toolsHash))) {
        $toolsZip = Join-Path $downloadRoot 'commandlinetools-win-15859902_latest.zip'
        Get-VerifiedDownload -Uri 'https://dl.google.com/android/repository/commandlinetools-win-15859902_latest.zip' -Path $toolsZip -Sha256 $toolsHash
        $unpackRoot = Join-Path $downloadRoot 'commandline-tools-unpacked'
        Write-Host 'Extracting Android command-line tools ...'
        Expand-Archive -LiteralPath $toolsZip -DestinationPath $unpackRoot -Force
        New-Item -ItemType Directory -Path $latestRoot -Force | Out-Null
        Get-ChildItem -LiteralPath (Join-Path $unpackRoot 'cmdline-tools') -Force |
            Copy-Item -Destination $latestRoot -Recurse -Force
        if (-not (Test-Path -LiteralPath $sdkManager)) { throw 'sdkmanager.bat was not extracted correctly.' }
        Set-Content -LiteralPath $toolsStamp -Value $toolsHash -Encoding ASCII
    }

    Write-Host 'Accepting Android SDK licenses for the local build tools ...'
    1..100 | ForEach-Object { 'y' } | & $sdkManager "--sdk_root=$sdkRoot" --licenses
    if ($LASTEXITCODE -ne 0) { throw "Android SDK license setup failed ($LASTEXITCODE)." }

    Write-Host 'Installing Android 36 tools, NDK, and CMake (installed packages are reused) ...'
    $sdkPackages = @('platform-tools', 'platforms;android-36', 'build-tools;36.0.0', 'ndk;27.1.12297006', 'cmake;3.30.5')
    1..100 | ForEach-Object { 'y' } | & $sdkManager "--sdk_root=$sdkRoot" --install @sdkPackages
    if ($LASTEXITCODE -ne 0) { throw "Android SDK package installation failed ($LASTEXITCODE)." }

    Write-Host "Android toolchain ready in $toolsRoot"
    Write-Host 'Next: powershell -ExecutionPolicy Bypass -File scripts/build-apk.ps1'
} catch {
    Write-Error $_ -ErrorAction Continue
    exit 1
}
