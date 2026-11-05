# Read-only support collector. Only the resulting report is written.
# Stays ASCII and PowerShell 5.1: it runs in the console of a user's Windows.
param(
    [string]$OutputPath,
    [string]$AppDataPath = $env:APPDATA,
    [string[]]$RuntimePaths,
    [switch]$SkipSystem
)
$ErrorActionPreference = 'Stop'
if (-not $OutputPath) { $OutputPath = Join-Path (Split-Path -Parent $PSScriptRoot) ('TypeR-diagnostic-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json') }
$WebView2Download = 'https://developer.microsoft.com/microsoft-edge/webview2/'
$Report = [ordered]@{
    format = 'TypeR Windows diagnostic v2'; collected = [DateTime]::UtcNow.ToString('o')
    windows = [Environment]::OSVersion.VersionString; architecture = $env:PROCESSOR_ARCHITECTURE
    summary = $null; system = $null; runtimes = @(); registry = @(); environment = @(); photoshop = @(); processes = @(); plugin = @(); pluginStorage = $null; startupReports = @(); adobeErrors = @(); errors = @()
}
function Add-Problem([string]$Where, $Problem) { $Report.errors += "$Where : $Problem" }
function Find-BoundedFiles([string]$Root, [string[]]$Filters, [int]$Depth = 3) {
    $Queue = New-Object Collections.Queue
    $Queue.Enqueue(@($Root, 0)); $Visited = 0
    while ($Queue.Count -and $Visited -lt 3000) {
        $Item = $Queue.Dequeue(); $Visited++
        if (-not (Test-Path -LiteralPath $Item[0] -PathType Container)) { continue }
        try {
            foreach ($Child in Get-ChildItem -LiteralPath $Item[0] -Force) {
                if ($Child.Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
                if ($Child.PSIsContainer) { if ($Item[1] -lt $Depth) { $Queue.Enqueue(@($Child.FullName, ($Item[1] + 1))) } }
                else { foreach ($Filter in $Filters) { if ($Child.Name -like $Filter) { $Child; break } } }
            }
        } catch { Add-Problem $Item[0] $_.Exception.Message }
    }
    if ($Queue.Count) { Add-Problem $Root 'Scan limit reached; results are partial.' }
}
# --- WebView2 runtimes: Adobe's copy, Microsoft's per machine and per user ---
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
    $Executables = @(Find-BoundedFiles $Root @('msedgewebview2.exe') 3 | ForEach-Object {
        [ordered]@{ path = $_.FullName; version = $_.VersionInfo.FileVersion; bytes = $_.Length; modified = $_.LastWriteTimeUtc.ToString('o')
            msedgeDll = (Test-Path -LiteralPath (Join-Path $_.DirectoryName 'msedge.dll'))
            icuData = (Test-Path -LiteralPath (Join-Path $_.DirectoryName 'icudtl.dat')) }
    })
    $Versions = @()
    if (Test-Path -LiteralPath $Root -PathType Container) {
        $Versions = @(Get-ChildItem -LiteralPath $Root -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^\d' } | ForEach-Object { $_.Name })
    }
    $Report.runtimes += [ordered]@{ root = $Root; folderPresent = (Test-Path -LiteralPath $Root); versionFolders = $Versions; executables = $Executables }
}
if (-not $SkipSystem) {
    # --- The Windows itself: edition, Insider ring, security software ---
    $System = [ordered]@{ edition = $null; displayVersion = $null; build = $null; insider = $null; antivirus = @() }
    try {
        $Current = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' -ErrorAction Stop
        $System.edition = [string]$Current.ProductName; $System.displayVersion = [string]$Current.DisplayVersion; $System.build = "$($Current.CurrentBuild).$($Current.UBR)"
    } catch { Add-Problem 'windows version' $_.Exception.Message }
    try {
        $Ring = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\WindowsSelfHost\Applicability' -ErrorAction SilentlyContinue
        if ($Ring) { $Text = ([string]$Ring.BranchName + ' ' + [string]$Ring.Ring + ' ' + [string]$Ring.ContentType).Trim(); if ($Text) { $System.insider = $Text } }
    } catch {}
    try {
        foreach ($Product in @(Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct -ErrorAction SilentlyContinue)) {
            $System.antivirus += @{ name = [string]$Product.displayName; state = [string]$Product.productState }
        }
    } catch { Add-Problem 'antivirus' $_.Exception.Message }
    $Report.system = $System
    # --- Microsoft's registration of the Evergreen runtime, policies, variables ---
    $Id = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
    foreach ($Key in @("HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\$Id", "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\$Id", "HKCU:\Software\Microsoft\EdgeUpdate\Clients\$Id")) {
        try { $Version = (Get-ItemProperty -LiteralPath $Key -ErrorAction Stop).pv; $Report.registry += @{ key = $Key; version = $Version } }
        catch { $Report.registry += @{ key = $Key; unavailable = $_.Exception.Message } }
    }
    foreach ($Key in @('HKLM:\SOFTWARE\Policies\Microsoft\Edge\WebView2', 'HKCU:\SOFTWARE\Policies\Microsoft\Edge\WebView2')) {
        try {
            if (Test-Path -LiteralPath $Key) {
                $Values = [ordered]@{}
                foreach ($Property in (Get-Item -LiteralPath $Key).GetValueNames()) { $Values[$Property] = [string](Get-ItemProperty -LiteralPath $Key).$Property }
                $Report.environment += @{ policy = $Key; values = $Values }
            }
        } catch { Add-Problem $Key $_.Exception.Message }
    }
    foreach ($Variable in @(Get-ChildItem Env: | Where-Object { $_.Name -like 'WEBVIEW2_*' })) {
        $Report.environment += @{ variable = $Variable.Name; value = $Variable.Value }
    }
    try {
        $Uninstall = @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*')
        foreach ($Entry in @(Get-ItemProperty -Path $Uninstall -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match 'WebView2|Adobe Photoshop' })) {
            $Report.environment += @{ installed = [string]$Entry.DisplayName; version = [string]$Entry.DisplayVersion; location = [string]$Entry.InstallLocation }
        }
    } catch { Add-Problem 'uninstall registry' $_.Exception.Message }
    # --- Photoshop installations, and the WebView2 loader each one links ---
    $Folders = @{}
    foreach ($Process in @(Get-Process -Name Photoshop -ErrorAction SilentlyContinue)) {
        try { if ($Process.Path) { $Folders[(Split-Path -Parent $Process.Path)] = 'running' } } catch { Add-Problem 'process path' $_.Exception.Message }
    }
    foreach ($Drive in @(Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue)) {
        foreach ($Base in @('Program Files\Adobe', 'Program Files (x86)\Adobe', 'Adobe')) {
            $Parent = Join-Path $Drive.Root $Base
            if (-not (Test-Path -LiteralPath $Parent -PathType Container)) { continue }
            foreach ($Dir in @(Get-ChildItem -LiteralPath $Parent -Directory -Filter 'Adobe Photoshop*' -ErrorAction SilentlyContinue)) {
                if (-not $Folders.ContainsKey($Dir.FullName)) { $Folders[$Dir.FullName] = 'installed' }
            }
        }
    }
    foreach ($Folder in @($Folders.Keys | Sort-Object)) {
        try {
            $Exe = Join-Path $Folder 'Photoshop.exe'
            $Item = [ordered]@{ path = $Folder; state = $Folders[$Folder]; present = (Test-Path -LiteralPath $Exe -PathType Leaf); version = $null; webViewFiles = @() }
            if ($Item.present) { $Item.version = (Get-Item -LiteralPath $Exe).VersionInfo.ProductVersion }
            foreach ($File in @(Find-BoundedFiles $Folder @('WebView2Loader*.dll', 'EmbeddedBrowserWebView*.dll', 'msedgewebview2.exe', 'dvauxp*.dll') 2)) {
                $Item.webViewFiles += @{ name = $File.FullName.Substring($Folder.Length).TrimStart('\'); version = $File.VersionInfo.ProductVersion; bytes = $File.Length }
            }
            $Report.photoshop += $Item
        } catch { Add-Problem $Folder $_.Exception.Message }
    }
    foreach ($Process in @(Get-Process -Name Photoshop,msedgewebview2 -ErrorAction SilentlyContinue)) {
        try { $Report.processes += @{ name = $Process.ProcessName; id = $Process.Id; executable = $Process.Path; version = $Process.FileVersion } }
        catch { Add-Problem 'process' $_.Exception.Message }
    }
}
# --- TypeR: metadata only, never its profiles, scripts, images, or documents ---
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
# The per-version storage root: its WebView folder is where UXP keeps the
# WebView data of plugins; a Photoshop whose UXP never started a WebView has none
$Storage = Join-Path $AppDataPath 'Adobe\UXP\PluginsStorage\PHSP'
$PluginStorage = [ordered]@{ root = $Storage; versions = @() }
foreach ($VersionDir in @(Get-ChildItem -LiteralPath $Storage -Directory -ErrorAction SilentlyContinue)) {
    $Entry = [ordered]@{ version = $VersionDir.Name; folders = @(); webView = @() }
    foreach ($Child in @(Get-ChildItem -LiteralPath $VersionDir.FullName -Force -ErrorAction SilentlyContinue)) {
        $Entry.folders += ($Child.Name + $(if ($Child.PSIsContainer) { '' } else { ' (file)' }))
    }
    $WebViewDir = Join-Path $VersionDir.FullName 'WebView'
    foreach ($Guid in @(Get-ChildItem -LiteralPath $WebViewDir -Directory -ErrorAction SilentlyContinue)) {
        $Entry.webView += @{ id = $Guid.Name; kinds = @(Get-ChildItem -LiteralPath $Guid.FullName -Directory -ErrorAction SilentlyContinue | ForEach-Object { $_.Name }); created = $Guid.CreationTimeUtc.ToString('o') }
    }
    $PluginStorage.versions += $Entry
}
$Report.pluginStorage = $PluginStorage
$Upic = Join-Path $AppDataPath 'Adobe\UPI\UPIC\Preferences.json'
$Report.environment += @{ file = $Upic; present = (Test-Path -LiteralPath $Upic -PathType Leaf) }
foreach ($File in @(Find-BoundedFiles $Storage @('typer-startup-*.json') 7 | Where-Object { $_.FullName -match '[\\/]com\.scanr\.typer[^\\/]*[\\/]PluginData[\\/]diagnostics[\\/]' } | Sort-Object LastWriteTime -Descending | Select-Object -First 5)) {
    try {
        if ($File.Length -gt 4MB) { throw 'Report exceeds 4 MB' }
        $Data = Get-Content -LiteralPath $File.FullName -Raw | ConvertFrom-Json
        if ($Data.format -ne 'TypeR startup diagnostic v1') { throw 'Unknown report format' }
        $Report.startupReports += @{ file = $File.FullName; modified = $File.LastWriteTimeUtc.ToString('o'); report = $Data }
    } catch { Add-Problem $File.FullName $_.Exception.Message }
}
# --- Photoshop's UXP logs: one per session, the WebView lines of the two newest ---
# The whole file is read (bounded in size): the decisive lines are written in the
# first seconds of the session, long before the end of a long day's log. The
# Home screen's [console] lines are left out: they may quote anything.
$Adobe = Join-Path $AppDataPath 'Adobe'
$LogPattern = '(?i)webview|edgewebview|com\.scanr\.typer'
$Newest = $null
foreach ($Dir in @(Get-ChildItem -LiteralPath $Adobe -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like '*Photoshop*' })) {
    foreach ($File in @(Find-BoundedFiles $Dir.FullName @('*uxp*.log') 2 | Sort-Object LastWriteTime -Descending | Select-Object -First 2)) {
        try {
            if ($File.Length -gt 32MB) { throw 'Log exceeds 32 MB' }
            # Strip PowerShell 5.1's provider metadata from Get-Content strings:
            # serializing PSDrive/PSProvider at depth 30 walks enormous objects.
            $AllLines = @(Get-Content -LiteralPath $File.FullName | Where-Object { $_ -notmatch '\[console\]' } | ForEach-Object { $_.ToString() })
            $Matching = @($AllLines | Where-Object { $_ -match $LogPattern })
            # Adobe's own plugins the session named: a Photoshop that loads none of them is unusual
            $AdobePlugins = @()
            foreach ($Line in $AllLines) { if ($Line -match 'Plugin (com\.adobe\.[A-Za-z0-9._-]+)' -and $AdobePlugins -notcontains $matches[1]) { $AdobePlugins += $matches[1] } }
            $Lines = $Matching
            if ($Matching.Count -gt 200) { $Lines = @($Matching[0..119]) + @("... $($Matching.Count - 200) lines left out ...") + @($Matching[($Matching.Count - 80)..($Matching.Count - 1)]) }
            $Report.adobeErrors += @{ file = $File.FullName; modified = $File.LastWriteTimeUtc.ToString('o'); bytes = $File.Length; lines = $Lines }
            if (-not $Newest -or $File.Name -gt $Newest.Name) { $Newest = @{ Name = $File.Name; Path = $File.FullName; Lines = $Matching; Plugins = $AdobePlugins } }
        } catch { Add-Problem $File.FullName $_.Exception.Message }
    }
}
# --- What the newest session's log says, in one place ---
$Summary = [ordered]@{ newestLog = $null; runtimeFolder = $null; webView2Started = $null; failedPlugins = @(); typerWebViewFailed = $false; refusal = $null; adobePlugins = @(); verdict = '' }
if ($Newest) {
    $Summary.newestLog = $Newest.Path
    $Summary.adobePlugins = @($Newest.Plugins)
    foreach ($Line in $Newest.Lines) {
        if ($Line -match 'UXP will use the WebView2 runtime in the folder: (.+)$') { $Summary.runtimeFolder = $matches[1].Trim() }
        elseif ($Line -match 'WebView2BrowserVersion:\s*(\S+)') { $Summary.webView2Started = $matches[1] }
        elseif ($Line -match 'createWebView\(\) failed to create WebView because (.+)$') { $Summary.refusal = $matches[1].Trim(); if ($Summary.failedPlugins -notcontains 'com.scanr.typer (refused)') { $Summary.failedPlugins += 'com.scanr.typer (refused)' } }
        elseif ($Line -match 'Failed to create WebView for plugin: (\S+)') {
            $Plugin = $matches[1]
            if ($Plugin -eq 'com.scanr.typer') { $Summary.typerWebViewFailed = $true }
            if ($Summary.failedPlugins -notcontains $Plugin) { $Summary.failedPlugins += $Plugin }
        }
    }
    if ($Summary.refusal -and -not $Summary.webView2Started) {
        $Summary.verdict = "UXP refused to create any WebView in Photoshop's newest session ($($Summary.refusal)) and never started a WebView2 runtime: the WebView2 runtimes present are not the cause (a user's case of 2026-11-04 failed the same with Microsoft's runtime forced). Send this report to TypeR support; meanwhile use the Legacy panel (Window > Extensions > TypeR (CEP))."
    } elseif ($Summary.typerWebViewFailed -and -not $Summary.webView2Started) {
        $Summary.verdict = "Photoshop could not start any WebView2 runtime in its newest session (it refused TypeR's WebView" + $(if ($Summary.failedPlugins.Count -gt 1) { " and its own, " + (($Summary.failedPlugins | Where-Object { $_ -ne 'com.scanr.typer' }) -join ', ') } else { '' }) + "). The Microsoft Edge WebView2 component is missing, damaged or too old for this Photoshop: install it from $WebView2Download, then restart Photoshop."
        if ($Summary.runtimeFolder) { $Summary.verdict += " Photoshop looks for it in $($Summary.runtimeFolder)" }
    } elseif ($Summary.typerWebViewFailed) {
        $Summary.verdict = "Photoshop runs WebView2 $($Summary.webView2Started) but could not create TypeR's WebView: send this report to TypeR support."
    } elseif ($Summary.webView2Started) {
        $Summary.verdict = "WebView2 $($Summary.webView2Started) started in Photoshop's newest session and TypeR's WebView was not refused: the cause is elsewhere, send this report to TypeR support."
    } else {
        $Summary.verdict = "No WebView2 started in Photoshop's newest session and no failure is recorded for TypeR: open TypeR, wait 20 s, then run this collector again with Photoshop still open."
    }
} else {
    $Summary.verdict = 'No Photoshop UXP log was found under <USER>\AppData\Roaming\Adobe: open Photoshop and TypeR once, then run this collector again.'
}
$Report.summary = $Summary
$Json = ConvertTo-Json $Report -Depth 30
foreach ($PrivateRoot in @($env:USERPROFILE, $AppDataPath) | Where-Object { $_ } | Sort-Object Length -Descending) {
    foreach ($Variant in @($PrivateRoot, $PrivateRoot.Replace('\', '\\'), $PrivateRoot.Replace('\', '/'))) {
        $Json = [regex]::Replace($Json, [regex]::Escape($Variant), '<USER>', [Text.RegularExpressions.RegexOptions]::IgnoreCase)
    }
}
# Avoid including URL query strings from upstream error lines.
$Json = [regex]::Replace($Json, '(https?[^\s"?]+)\?[^\s"]+', '$1?<redacted>')
[IO.File]::WriteAllText([IO.Path]::GetFullPath($OutputPath), $Json, (New-Object Text.UTF8Encoding($false)))
Write-Host ''
Write-Host $Summary.verdict -ForegroundColor Yellow
Write-Host ''
Write-Host "Report saved: $OutputPath" -ForegroundColor Green
Write-Host 'Send this JSON file to TypeR support. No system settings were changed.'
