[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot)).TrimEnd('\')
$workspaceRoot = [IO.Path]::GetFullPath('D:\weather-forcasting app').TrimEnd('\')
$substExe = Join-Path $env:SystemRoot 'System32\subst.exe'
$powershellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$ownedDrive = $null
$buildExitCode = 1

function Get-SubstTarget {
    param([string]$Drive)
    $pattern = '^\s*' + [regex]::Escape($Drive) + '\\:\s*=>\s*(.+)$'
    foreach ($line in @(& $substExe)) {
        if ($line -match $pattern) {
            return [IO.Path]::GetFullPath($Matches[1].Trim()).TrimEnd('\')
        }
    }
    return $null
}

try {
    # Keep the project below a directory: Expo autolinking does not search a drive root.
    if (-not $projectRoot.StartsWith(($workspaceRoot + '\'), [StringComparison]::OrdinalIgnoreCase)) {
        throw "The project must remain inside the authorized workspace: $workspaceRoot"
    }
    $buildScript = Join-Path $projectRoot 'scripts\build-apk.ps1'
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'package.json')) -or
        -not (Test-Path -LiteralPath $buildScript)) {
        throw 'This wrapper must be run from the trip-planner project scripts directory.'
    }

    $logicalDrives = [IO.Directory]::GetLogicalDrives()
    foreach ($letter in @('R', 'S', 'T')) {
        $candidate = "${letter}:"
        $driveRoot = "$candidate\"
        if ($logicalDrives -contains $driveRoot) { continue }
        if (Get-PSDrive -Name $letter -ErrorAction SilentlyContinue) { continue }
        if (Test-Path -LiteralPath $driveRoot) { continue }
        if (Get-SubstTarget -Drive $candidate) { continue }
        & $substExe $candidate $workspaceRoot
        if ($LASTEXITCODE -ne 0) { throw "Could not create temporary mapping $candidate." }
        $ownedDrive = $candidate
        break
    }
    if (-not $ownedDrive) { throw 'R:, S:, and T: are already in use. No drive mapping was changed.' }
    $mappedTarget = Get-SubstTarget -Drive $ownedDrive
    if (-not [string]::Equals($mappedTarget, $workspaceRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'The temporary drive does not point to the expected project directory.'
    }

    $relativeProject = $projectRoot.Substring($workspaceRoot.Length).TrimStart('\')
    $shortScript = "$ownedDrive\$relativeProject\scripts\build-apk.ps1"
    if (-not [IO.File]::Exists($shortScript)) { throw "The build script is unavailable through $ownedDrive." }
    Write-Host "Temporary short path: $ownedDrive\ -> $workspaceRoot"
    Write-Host 'Reusing the existing project, toolchain, and caches without cleaning.'
    # Invoke THROUGH the alias so the child derives short paths from PSScriptRoot.
    & $powershellExe -NoProfile -ExecutionPolicy Bypass -File $shortScript
    $buildExitCode = $LASTEXITCODE
} catch {
    Write-Error $_ -ErrorAction Continue
    $buildExitCode = 1
} finally {
    if ($ownedDrive) {
        try {
            $currentTarget = Get-SubstTarget -Drive $ownedDrive
            if ([string]::Equals($currentTarget, $workspaceRoot, [StringComparison]::OrdinalIgnoreCase)) {
                # /d removes only this alias; it does not delete project files.
                & $substExe $ownedDrive /d
                if ($LASTEXITCODE -ne 0) {
                    Write-Warning "Could not remove temporary drive mapping $ownedDrive."
                    if ($buildExitCode -eq 0) { $buildExitCode = 1 }
                } else {
                    Write-Host "Removed temporary mapping $ownedDrive. Project files remain at $projectRoot."
                }
            } else {
                Write-Warning "The $ownedDrive mapping changed during the build; it was left untouched."
            }
        } catch {
            Write-Warning "Could not inspect or remove the temporary mapping: $($_.Exception.Message)"
            if ($buildExitCode -eq 0) { $buildExitCode = 1 }
        }
    }
}

exit $buildExitCode
