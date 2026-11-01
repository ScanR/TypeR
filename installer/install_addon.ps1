# Offline installer for the Windows x64 TypeR hybrid preview.
param([switch]$Silent, [string[]]$PhotoshopPath)
$ErrorActionPreference = 'Stop'

function Assert-TypeRAddonPackage([string]$PackagePath, [string]$ChecksumPath) {
    if (-not (Test-Path -LiteralPath $PackagePath -PathType Leaf) -or -not (Test-Path -LiteralPath $ChecksumPath -PathType Leaf)) {
        throw 'Archive incomplete. Extract the ENTIRE ZIP before running Installer-TypeR-Addon.cmd.'
    }
    $Expected = [IO.File]::ReadAllText($ChecksumPath).Trim()
    if ($Expected -notmatch '^([0-9a-fA-F]{64})\s+TypeR-UXP-addon-win\.ccx$') { throw 'Invalid package checksum file.' }
    $ExpectedHash = $Matches[1]
    $Stream = [IO.File]::OpenRead($PackagePath)
    $Algorithm = [Security.Cryptography.SHA256]::Create()
    try { $ActualHash = [BitConverter]::ToString($Algorithm.ComputeHash($Stream)).Replace('-', '') }
    finally { $Algorithm.Dispose(); $Stream.Dispose() }
    if ($ActualHash -ne $ExpectedHash) { throw 'Package damaged or changed. Extract a fresh copy of the ZIP.' }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $Archive = [IO.Compression.ZipFile]::OpenRead($PackagePath)
    try {
        $Entry = $Archive.GetEntry('manifest.json')
        if (-not $Entry -or $Entry.Length -gt 1MB) { throw 'Missing addon manifest.' }
        $Reader = New-Object IO.StreamReader($Entry.Open(), [Text.Encoding]::UTF8)
        try { $Manifest = $Reader.ReadToEnd() | ConvertFrom-Json } finally { $Reader.Dispose() }
        if ($Manifest.id -ne 'com.scanr.typer' -or $Manifest.manifestVersion -ne 6 -or
            $Manifest.addon.name -ne 'typer-keys.uxpaddon' -or $Manifest.requiredPermissions.enableAddon -ne $true) {
            throw 'This is not the TypeR Windows addon preview.'
        }
        $Native = $Archive.GetEntry('win/x64/typer-keys.uxpaddon')
        if (-not $Native -or $Native.Length -lt 64 -or $Native.Length -gt 16MB) { throw 'Missing or invalid native keyboard addon.' }
        foreach ($Item in $Archive.Entries) {
            if ($Item.FullName.Replace('\', '/') -match '^native/|\.(exe|ps1)$') { throw 'Unexpected external helper in addon package.' }
        }
        $Memory = New-Object IO.MemoryStream
        $InputStream = $Native.Open()
        try { $InputStream.CopyTo($Memory); $Bytes = $Memory.ToArray() }
        finally { $InputStream.Dispose(); $Memory.Dispose() }
        $PeOffset = [BitConverter]::ToUInt32($Bytes, 60)
        if ($PeOffset -gt $Bytes.Length - 24 -or [BitConverter]::ToUInt16($Bytes, 0) -ne 0x5A4D -or
            [BitConverter]::ToUInt32($Bytes, [int]$PeOffset) -ne 0x4550 -or
            [BitConverter]::ToUInt16($Bytes, [int]$PeOffset + 4) -ne 0x8664 -or
            -not ([BitConverter]::ToUInt16($Bytes, [int]$PeOffset + 22) -band 0x2000)) {
            throw 'The keyboard addon must be an AMD64 Windows DLL.'
        }
        return $Manifest
    } finally { $Archive.Dispose() }
}

try {
    if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64' -and $env:PROCESSOR_ARCHITEW6432 -ne 'AMD64') {
        throw 'This preview requires Windows x64 (Intel/AMD).'
    }
    $Bundle = Split-Path -Parent $PSScriptRoot
    $Payload = Join-Path $Bundle 'TypeR-UXP-addon-win.ccx'
    $null = Assert-TypeRAddonPackage $Payload ($Payload + '.sha256')
    Write-Host 'TypeR - installation locale, sans Creative Cloud.'
    $Parameters = @{ Uxp = $true; Package = $Payload; Silent = $Silent }
    if ($PhotoshopPath) { $Parameters.PhotoshopPath = $PhotoshopPath }
    # Existing installer verifies every extracted file, preserves other plugins,
    # backs up TypeR, registers it locally, and rolls back on failure.
    & (Join-Path $PSScriptRoot 'install.ps1') @Parameters
    exit $LASTEXITCODE
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    if (-not $Silent -and -not [Console]::IsInputRedirected) { Read-Host 'Appuyez sur Entree pour fermer' | Out-Null }
    exit 1
}
