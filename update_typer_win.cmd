@echo off
setlocal

set "TYPER_UPDATE_SCRIPT=%~f0"
set "TYPER_UPDATE_DIR=%~dp0"

PowerShell -NoProfile -ExecutionPolicy Bypass -Command "$content = Get-Content -LiteralPath $env:TYPER_UPDATE_SCRIPT; $marker = ($content | Select-String -SimpleMatch '# POWERSHELL' | Select-Object -Last 1).LineNumber; if (-not $marker) { throw 'Embedded updater not found.' }; & ([ScriptBlock]::Create(($content[$marker..($content.Length - 1)] -join [Environment]::NewLine)))"
set "UPDATE_EXIT_CODE=%ERRORLEVEL%"

if /I "%~1"=="--silent" exit /b %UPDATE_EXIT_CODE%
echo.
pause
exit /b %UPDATE_EXIT_CODE%

# POWERSHELL
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = New-Object System.Text.UTF8Encoding
$ErrorActionPreference = "Stop"

$ReleaseUrl = "https://github.com/ScanR/TypeR/releases/latest/download/TypeR.zip"
$ScriptDir = $env:TYPER_UPDATE_DIR.TrimEnd("\")
$TargetDir = if ($env:TYPER_UPDATE_TARGET) {
    [System.IO.Path]::GetFullPath($env:TYPER_UPDATE_TARGET)
} else {
    Join-Path $env:APPDATA "Adobe\CEP\extensions\typertools"
}

$LocaleFolders = @{
    ar = "ar_AE"; de = "de_DE"; es = "es_SP"; fr = "fr_FR"; pt = "pt_BR"
    ru = "ru_RU"; tr = "tr_TR"; uk = "uk_UA"; vi = "vi_VN"
}
$Language = $Host.CurrentCulture.TwoLetterISOLanguageName.ToLowerInvariant()
$LocaleFolder = $LocaleFolders[$Language]
$LocaleRoots = @((Join-Path $ScriptDir "locale"), (Join-Path $TargetDir "locale"))
$LocaleFiles = @()
foreach ($LocaleRoot in $LocaleRoots) {
    if ($LocaleFolder) { $LocaleFiles += Join-Path $LocaleRoot "$LocaleFolder\messages.properties" }
    $LocaleFiles += Join-Path $LocaleRoot "messages.properties"
}

function Get-LocalizedMessage([string]$Key, [string]$Fallback) {
    foreach ($LocaleFile in $LocaleFiles) {
        if (-not (Test-Path -LiteralPath $LocaleFile -PathType Leaf)) { continue }
        foreach ($Line in Get-Content -LiteralPath $LocaleFile -Encoding UTF8) {
            if ($Line.StartsWith("$Key=")) { return $Line.Substring($Key.Length + 1) }
        }
    }
    return $Fallback
}

function Format-VersionMessage([string]$Message, [string]$Version) {
    return $Message.Replace("{version}", $Version)
}

function Get-PackageVersion([string]$ManifestPath) {
    $ManifestContent = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8
    if ($ManifestContent -notmatch 'Extension Id="typer" Version="([^"]+)"') {
        throw (Get-LocalizedMessage "updaterInvalidPackage" "The downloaded archive is not a valid TypeR package.")
    }
    return $Matches[1]
}

function Compare-TypeRVersions([string]$Left, [string]$Right) {
    $LeftParts = ($Left -replace '^v', '') -split '[^0-9]+' | Where-Object { $_ -ne '' }
    $RightParts = ($Right -replace '^v', '') -split '[^0-9]+' | Where-Object { $_ -ne '' }
    $Count = [Math]::Max($LeftParts.Count, $RightParts.Count)
    for ($Index = 0; $Index -lt $Count; $Index++) {
        $LeftPart = if ($Index -lt $LeftParts.Count) { [int]$LeftParts[$Index] } else { 0 }
        $RightPart = if ($Index -lt $RightParts.Count) { [int]$RightParts[$Index] } else { 0 }
        if ($LeftPart -gt $RightPart) { return 1 }
        if ($LeftPart -lt $RightPart) { return -1 }
    }
    return 0
}

function Assert-SafeArchive([string]$ArchivePath) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $Archive = [System.IO.Compression.ZipFile]::OpenRead($ArchivePath)
    try {
        foreach ($Entry in $Archive.Entries) {
            $EntryName = $Entry.FullName
            $NormalizedEntryName = $EntryName.Replace("\", "/")
            $Segments = $NormalizedEntryName -split '/'
            if ([System.IO.Path]::IsPathRooted($EntryName) -or $NormalizedEntryName.StartsWith("/") -or $Segments -contains "..") {
                throw (Get-LocalizedMessage "updaterInvalidPackage" "The downloaded archive is not a valid TypeR package.")
            }
        }
    } finally {
        $Archive.Dispose()
    }
}

$Title = Get-LocalizedMessage "updaterTitle" "TypeR standalone updater"
$Downloading = Get-LocalizedMessage "updaterDownloading" "Downloading the latest stable version..."
$Installing = Get-LocalizedMessage "updaterInstalling" "Installing TypeR {version}..."
$AlreadyCurrent = Get-LocalizedMessage "updaterAlreadyCurrent" "TypeR {version} is already up to date."
$Success = Get-LocalizedMessage "updaterSuccess" "TypeR {version} was updated successfully. Restart Photoshop to apply it."
$Failure = Get-LocalizedMessage "updaterFailure" "Update failed:"
$InvalidPackage = Get-LocalizedMessage "updaterInvalidPackage" "The downloaded archive is not a valid TypeR package."

Write-Host "+------------------------------------------------------------------+" -ForegroundColor Cyan
Write-Host ("|  " + $Title.PadRight(64) + "|") -ForegroundColor Cyan
Write-Host "+------------------------------------------------------------------+" -ForegroundColor Cyan
Write-Host ""

$WorkDir = Join-Path ([System.IO.Path]::GetTempPath()) ("TypeR_Update_" + [Guid]::NewGuid().ToString("N"))
$ArchivePath = Join-Path $WorkDir "TypeR.zip"
$ExtractDir = Join-Path $WorkDir "extracted"
$BackupDir = Join-Path $WorkDir "backup"
$Folders = @("app", "CSXS", "icons", "locale")
$MovedFolders = @()
$CopiedFolders = @()
$InstallStarted = $false

try {
    New-Item -Path $WorkDir, $ExtractDir, $BackupDir -ItemType Directory -Force | Out-Null
    Write-Host $Downloading -ForegroundColor Cyan

    if ($env:TYPER_UPDATE_ARCHIVE) {
        Copy-Item -LiteralPath $env:TYPER_UPDATE_ARCHIVE -Destination $ArchivePath -Force
    } else {
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $ReleaseUrl -OutFile $ArchivePath -UseBasicParsing -TimeoutSec 180
    }

    Assert-SafeArchive $ArchivePath
    Expand-Archive -LiteralPath $ArchivePath -DestinationPath $ExtractDir -Force

    $PackageRoot = $null
    $ManifestPath = $null
    foreach ($CandidateManifest in Get-ChildItem -LiteralPath $ExtractDir -Filter "manifest.xml" -File -Recurse) {
        if ($CandidateManifest.Directory.Name -ne "CSXS") { continue }
        $CandidateRoot = $CandidateManifest.Directory.Parent.FullName
        $HasAllFolders = $true
        foreach ($Folder in $Folders) {
            if (-not (Test-Path -LiteralPath (Join-Path $CandidateRoot $Folder) -PathType Container)) {
                $HasAllFolders = $false
                break
            }
        }
        if ($HasAllFolders) {
            $PackageRoot = $CandidateRoot
            $ManifestPath = $CandidateManifest.FullName
            break
        }
    }
    if (-not $PackageRoot) { throw $InvalidPackage }

    $PackageVersion = Get-PackageVersion $ManifestPath
    $env:TYPER_INSTALL_SOURCE = $PackageRoot
    $env:TYPER_INSTALL_TARGET = $TargetDir
    $env:TYPER_INSTALL_SKIP_DEBUG = $env:TYPER_UPDATE_SKIP_DEBUG
    & (Join-Path $ScriptDir 'install.ps1') -Silent
    Write-Host (Format-VersionMessage $Success $PackageVersion) -ForegroundColor Green
} catch {
    if ($InstallStarted) {
        foreach ($Folder in $CopiedFolders) {
            $Destination = Join-Path $TargetDir $Folder
            if (Test-Path -LiteralPath $Destination) { Remove-Item -LiteralPath $Destination -Recurse -Force -ErrorAction SilentlyContinue }
        }
        foreach ($Folder in $MovedFolders) {
            $Backup = Join-Path $BackupDir $Folder
            if (Test-Path -LiteralPath $Backup) { Move-Item -LiteralPath $Backup -Destination (Join-Path $TargetDir $Folder) -Force }
        }
    }
    Write-Host ("$Failure " + $_.Exception.Message) -ForegroundColor Red
    exit 1
} finally {
    if (Test-Path -LiteralPath $WorkDir) { Remove-Item -LiteralPath $WorkDir -Recurse -Force -ErrorAction SilentlyContinue }
}
