# Read-only support collector. Only the resulting report is written.
param(
    [string]$OutputPath,
    [string]$AppDataPath = $env:APPDATA,
    [string[]]$RuntimePaths,
    [switch]$SkipSystem
)
$ErrorActionPreference = 'Stop'
if (-not $OutputPath) { $OutputPath = Join-Path (Split-Path -Parent $PSScriptRoot) ('TypeR-diagnostic-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json') }
$Report = [ordered]@{
    format = 'TypeR Windows diagnostic v1'; collected = [DateTime]::UtcNow.ToString('o')
    windows = [Environment]::OSVersion.VersionString; architecture = $env:PROCESSOR_ARCHITECTURE
    runtimes = @(); registry = @(); processes = @(); plugin = @(); startupReports = @(); adobeErrors = @(); errors = @()
}
function Add-Problem([string]$Where, $Problem) { $Report.errors += "$Where : $Problem" }
function Find-BoundedFiles([string]$Root, [string]$Filter, [int]$Depth = 3) {
    $Queue = New-Object Collections.Queue
    $Queue.Enqueue(@($Root, 0)); $Visited = 0
    while ($Queue.Count -and $Visited -lt 3000) {
        $Item = $Queue.Dequeue(); $Visited++
        if (-not (Test-Path -LiteralPath $Item[0] -PathType Container)) { continue }
        try {
            foreach ($Child in Get-ChildItem -LiteralPath $Item[0] -Force) {
                if ($Child.Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
                if ($Child.PSIsContainer) { if ($Item[1] -lt $Depth) { $Queue.Enqueue(@($Child.FullName, ($Item[1] + 1))) } }
                elseif ($Child.Name -like $Filter) { $Child }
            }
        } catch { Add-Problem $Item[0] $_.Exception.Message }
    }
    if ($Queue.Count) { Add-Problem $Root 'Scan limit reached; results are partial.' }
}
if (-not $RuntimePaths) {
    $RuntimePaths = @()
    foreach ($Base in @($env:CommonProgramFiles, ${env:CommonProgramFiles(x86)})) {
        if ($Base) { $RuntimePaths += Join-Path $Base 'Adobe\Microsoft\EdgeWebView' }
    }
    foreach ($Base in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA)) {
        if ($Base) { $RuntimePaths += Join-Path $Base 'Microsoft\EdgeWebView\Application' }
    }
}
foreach ($Root in @($RuntimePaths | Sort-Object -Unique)) {
    $Executables = @(Find-BoundedFiles $Root 'msedgewebview2.exe' 3 | ForEach-Object {
        [ordered]@{ path = $_.FullName; version = $_.VersionInfo.FileVersion; bytes = $_.Length
            msedgeDll = (Test-Path -LiteralPath (Join-Path $_.DirectoryName 'msedge.dll'))
            icuData = (Test-Path -LiteralPath (Join-Path $_.DirectoryName 'icudtl.dat')) }
    })
    $Report.runtimes += [ordered]@{ root = $Root; folderPresent = (Test-Path -LiteralPath $Root); executables = $Executables }
}
if (-not $SkipSystem) {
    $Id = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
    foreach ($Key in @("HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\$Id", "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\$Id", "HKCU:\Software\Microsoft\EdgeUpdate\Clients\$Id")) {
        try { $Version = (Get-ItemProperty -LiteralPath $Key -ErrorAction Stop).pv; $Report.registry += @{ key = $Key; version = $Version } }
        catch { $Report.registry += @{ key = $Key; unavailable = $_.Exception.Message } }
    }
    foreach ($Process in @(Get-Process -Name Photoshop,msedgewebview2 -ErrorAction SilentlyContinue)) {
        try { $Report.processes += @{ name = $Process.ProcessName; id = $Process.Id; executable = $Process.Path; version = $Process.FileVersion } }
        catch { Add-Problem 'process' $_.Exception.Message }
    }
}
# Read TypeR metadata only, never its profiles, scripts, images, or documents.
$Plugins = Join-Path $AppDataPath 'Adobe\UXP\Plugins\External'
foreach ($Dir in @(Get-ChildItem -LiteralPath $Plugins -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like 'com.scanr.typer*' })) {
    if ($Dir.Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
    try {
        $Manifest = Get-Content -LiteralPath (Join-Path $Dir.FullName 'manifest.json') -Raw | ConvertFrom-Json
        if ($Manifest.id -ne 'com.scanr.typer') { continue }
        $Item = [ordered]@{ path = $Dir.FullName; version = $Manifest.version; name = $Manifest.name; files = @() }
        foreach ($Relative in @('host.js', 'web\index.html', 'web\index.js', 'typer-debug-build.json')) {
            $File = Join-Path $Dir.FullName $Relative
            $Info = Get-Item -LiteralPath $File -ErrorAction SilentlyContinue
            $Item.files += @{ name = $Relative; present = [bool]$Info; bytes = $(if ($Info) { $Info.Length } else { 0 }) }
        }
        $Report.plugin += $Item
    } catch { Add-Problem $Dir.FullName $_.Exception.Message }
}
$Storage = Join-Path $AppDataPath 'Adobe\UXP\PluginsStorage\PHSP'
foreach ($File in @(Find-BoundedFiles $Storage 'typer-startup-*.json' 7 | Where-Object { $_.FullName -match '[\\/]com\.scanr\.typer[^\\/]*[\\/]PluginData[\\/]diagnostics[\\/]' } | Sort-Object LastWriteTime -Descending | Select-Object -First 5)) {
    try {
        if ($File.Length -gt 4MB) { throw 'Report exceeds 4 MB' }
        $Data = Get-Content -LiteralPath $File.FullName -Raw | ConvertFrom-Json
        if ($Data.format -ne 'TypeR startup diagnostic v1') { throw 'Unknown report format' }
        $Report.startupReports += @{ file = $File.FullName; modified = $File.LastWriteTimeUtc.ToString('o'); report = $Data }
    } catch { Add-Problem $File.FullName $_.Exception.Message }
}
# Only WebView/TypeR-related log lines from Photoshop folders, bounded in size.
$Adobe = Join-Path $AppDataPath 'Adobe'
foreach ($Dir in @(Get-ChildItem -LiteralPath $Adobe -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like '*Photoshop*' })) {
    foreach ($File in @(Find-BoundedFiles $Dir.FullName '*uxp*.log' 2 | Sort-Object LastWriteTime -Descending | Select-Object -First 2)) {
        try {
            # Strip PowerShell 5.1's provider metadata from Get-Content strings:
            # serializing PSDrive/PSProvider at depth 30 walks enormous objects.
            $Lines = @(Get-Content -LiteralPath $File.FullName -Tail 2000 | Where-Object { $_ -match '(?i)webview|edgewebview|com\.scanr\.typer' } | Select-Object -Last 60 | ForEach-Object { $_.ToString() })
            $Report.adobeErrors += @{ file = $File.FullName; lines = $Lines }
        } catch { Add-Problem $File.FullName $_.Exception.Message }
    }
}
$Json = ConvertTo-Json $Report -Depth 30
foreach ($PrivateRoot in @($env:USERPROFILE, $AppDataPath) | Where-Object { $_ } | Sort-Object Length -Descending) {
    foreach ($Variant in @($PrivateRoot, $PrivateRoot.Replace('\', '\\'), $PrivateRoot.Replace('\', '/'))) {
        $Json = [regex]::Replace($Json, [regex]::Escape($Variant), '<USER>', [Text.RegularExpressions.RegexOptions]::IgnoreCase)
    }
}
# Avoid including URL query strings from upstream error lines.
$Json = [regex]::Replace($Json, '(https?[^\s"?]+)\?[^\s"]+', '$1?<redacted>')
[IO.File]::WriteAllText([IO.Path]::GetFullPath($OutputPath), $Json, (New-Object Text.UTF8Encoding($false)))
Write-Host "Report saved: $OutputPath" -ForegroundColor Green
Write-Host 'Send this JSON file to TypeR support. No system settings were changed.'
