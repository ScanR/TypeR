# Installs the TypeR trace build, then writes a report on what the UXP panel's
# WebView (WebView2) finds on this computer. It only reads, apart from the
# installation and the report. Stays ASCII and PowerShell 5.1: it runs in the
# console of a user's Windows. Each section survives a failure of its own.
param([switch]$CollectOnly, [string]$ReportPath)
$ErrorActionPreference = 'Continue'

$KitRoot = Split-Path -Parent $PSScriptRoot
$Lines = New-Object System.Collections.Generic.List[string]

function Add-Line([string]$Text) { $Lines.Add($Text) }
function Add-Section([string]$Title, [scriptblock]$Body) {
    Add-Line ''
    Add-Line "=== $Title ==="
    try {
        & $Body 2>&1 | ForEach-Object { Add-Line ([string]$_) }
    } catch {
        Add-Line "section failed: $($_.Exception.Message)"
    }
}
function Get-Clipped([string]$Text, [int]$Max) {
    if ($Text.Length -gt $Max) { return $Text.Substring(0, $Max) + '...' }
    return $Text
}

function Get-RunningPhotoshop { @(Get-Process -Name 'Photoshop' -ErrorAction SilentlyContinue) }

function Get-FolderReport([string]$Folder) {
    if (-not (Test-Path -LiteralPath $Folder)) { return "$Folder : missing" }
    "$Folder :"
    Get-ChildItem -LiteralPath $Folder -Force -ErrorAction SilentlyContinue | ForEach-Object { "  $($_.Name)" }
}

function Get-PhotoshopFolders {
    $Found = @{}
    Get-RunningPhotoshop | ForEach-Object { if ($_.Path) { $Found[(Split-Path -Parent $_.Path)] = $true } }
    Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue | ForEach-Object {
        foreach ($Base in 'Program Files\Adobe', 'Program Files (x86)\Adobe', 'Adobe') {
            $Parent = Join-Path $_.Root $Base
            if (Test-Path -LiteralPath $Parent) {
                Get-ChildItem -LiteralPath $Parent -Directory -Filter 'Adobe Photoshop*' -ErrorAction SilentlyContinue | ForEach-Object { $Found[$_.FullName] = $true }
            }
        }
    }
    @($Found.Keys | Sort-Object)
}

function Add-Report([string]$Label) {
    Add-Line ''
    Add-Line "########## $Label, $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ##########"

    Add-Section 'System' {
        $System = Get-CimInstance Win32_OperatingSystem
        "$($System.Caption) $($System.Version) $($System.OSArchitecture), language $($System.OSLanguage)"
        Get-CimInstance Win32_VideoController | ForEach-Object { "GPU: $($_.Name), driver $($_.DriverVersion)" }
    }

    Add-Section 'Running Photoshop' {
        $Running = @(Get-RunningPhotoshop)
        if (-not $Running.Count) { 'none' }
        $Running | ForEach-Object { "$($_.Path) version $($_.MainModule.FileVersionInfo.ProductVersion)" }
    }

    Add-Section 'Photoshop installations' {
        foreach ($Folder in Get-PhotoshopFolders) {
            $Exe = Join-Path $Folder 'Photoshop.exe'
            $Version = if (Test-Path -LiteralPath $Exe) { (Get-Item -LiteralPath $Exe).VersionInfo.ProductVersion } else { 'no Photoshop.exe' }
            "$Folder : $Version"
            Get-ChildItem -LiteralPath $Folder -Recurse -Force -ErrorAction SilentlyContinue -Include 'WebView2Loader*.dll', 'EmbeddedBrowserWebView*.dll', 'msedgewebview2.exe' | ForEach-Object {
                "  $($_.FullName.Substring($Folder.Length)) $($_.VersionInfo.ProductVersion)"
            }
            Get-ChildItem -LiteralPath $Folder -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'uxp|webview' } | ForEach-Object { "  $($_.Name)" }
        }
    }

    Add-Section 'WebView2 folders' {
        $Common = ${env:CommonProgramFiles}
        Get-FolderReport (Join-Path $Common 'Adobe\Microsoft\EdgeWebView')
        Get-FolderReport (Join-Path $Common 'Adobe\UXP')
        Get-FolderReport (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\EdgeWebView\Application')
        Get-FolderReport (Join-Path $env:LOCALAPPDATA 'Microsoft\EdgeWebView\Application')
        foreach ($Base in (Join-Path $Common 'Adobe\Microsoft\EdgeWebView'), (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\EdgeWebView\Application')) {
            if (Test-Path -LiteralPath $Base) {
                Get-ChildItem -LiteralPath $Base -Recurse -Force -Filter 'msedgewebview2.exe' -ErrorAction SilentlyContinue | ForEach-Object { "$($_.FullName) $($_.VersionInfo.ProductVersion)" }
            }
        }
    }

    Add-Section 'WebView2 registry' {
        $Client = 'Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
        foreach ($Key in "HKLM:\SOFTWARE\WOW6432Node\$Client", "HKLM:\SOFTWARE\$Client", "HKCU:\SOFTWARE\$Client") {
            $Value = (Get-ItemProperty -LiteralPath $Key -ErrorAction SilentlyContinue).pv
            if ($Value) { "$Key : $Value" } else { "$Key : none" }
        }
        foreach ($Key in 'HKLM:\SOFTWARE\Policies\Microsoft\Edge\WebView2', 'HKCU:\SOFTWARE\Policies\Microsoft\Edge\WebView2') {
            if (Test-Path -LiteralPath $Key) { "policy $Key :"; Get-ItemProperty -LiteralPath $Key | Out-String }
        }
        Get-ChildItem Env: | Where-Object { $_.Name -like 'WEBVIEW2_*' } | ForEach-Object { "$($_.Name)=$($_.Value)" }
        $Uninstall = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
        Get-ItemProperty -Path $Uninstall -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match 'WebView|UXP' } | ForEach-Object { "installed: $($_.DisplayName) $($_.DisplayVersion)" }
    }

    Add-Section 'WebView processes (Photoshop open)' {
        $Processes = @(Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'")
        "count: $($Processes.Count)"
        $Processes | Where-Object { $_.CommandLine -notmatch '--type=' } | ForEach-Object {
            "path: $($_.ExecutablePath)"
            "command: $(Get-Clipped $_.CommandLine 700)"
        }
    }

    Add-Section 'UXP plugins' {
        $Root = Join-Path $env:APPDATA 'Adobe\UXP'
        Get-FolderReport (Join-Path $Root 'Plugins\External')
        $Registry = Join-Path $Root 'PluginsInfo\v1\PS.json'
        if (Test-Path -LiteralPath $Registry) { Get-Content -LiteralPath $Registry -Raw } else { 'no PS.json' }
    }

    Add-Section 'hosts file' {
        $Hosts = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'
        "lines naming adobe: $(@(Select-String -LiteralPath $Hosts -Pattern 'adobe' -ErrorAction SilentlyContinue).Count)"
    }

    Add-Section 'Errors in the Windows log (last 2 hours)' {
        $Since = (Get-Date).AddHours(-2)
        Get-WinEvent -FilterHashtable @{ LogName = 'Application'; Level = 2; StartTime = $Since } -MaxEvents 200 -ErrorAction SilentlyContinue |
            Where-Object { $_.Message -match 'Photoshop|webview|UXP' } |
            Select-Object -First 10 |
            ForEach-Object { "$($_.TimeCreated) $($_.ProviderName): $(Get-Clipped ($_.Message -replace '\s+', ' ') 500)" }
    }

    Add-Section 'TypeR trace (newest sessions)' {
        $Folder = Join-Path $env:APPDATA 'TypeR\UXP\crash-traces'
        if (-not (Test-Path -LiteralPath $Folder)) { 'no trace: the plugin never reached its first file write' }
        Get-ChildItem -LiteralPath $Folder -Filter '*.log' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 3 | ForEach-Object {
            "--- $($_.Name), $($_.Length) bytes"
            Get-Content -LiteralPath $_.FullName -Tail 150 | ForEach-Object { Get-Clipped $_ 600 }
        }
    }
}

function Write-Report([string]$Path) {
    # User names are of no use here
    $Text = ($Lines -join "`r`n")
    if ($env:USERNAME) { $Text = $Text.Replace($env:USERNAME, '<user>') }
    [IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false)))
}

if (-not $ReportPath) { $ReportPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'TypeR-debug-report.txt' }

if ($CollectOnly) {
    Add-Report 'Collect only'
    Write-Report $ReportPath
    return
}

Write-Host ''
Write-Host 'TypeR debug kit' -ForegroundColor Cyan
Write-Host 'It installs a TypeR version that logs its start, then writes a report on your Desktop.'
Write-Host 'Your styles and settings are not touched. The report shows your Photoshop versions and plugin list.'
Write-Host ''

while ((Get-RunningPhotoshop).Count) {
    Read-Host 'Photoshop is open: close it, then press Enter'
}

Write-Host 'Installing the debug version...'
$Installer = Join-Path $PSScriptRoot 'install.ps1'
$Package = Join-Path $KitRoot 'TypeR-UXP-trace.ccx'
& "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File $Installer -Uxp -Silent $Package
$InstallCode = $LASTEXITCODE
Add-Line "Debug version install exit code: $InstallCode"
if ($InstallCode -ne 0) { Write-Host 'The installation failed. The report is still useful, carry on.' -ForegroundColor Yellow }

Write-Host ''
Write-Host '1. Open the Photoshop version where TypeR stays empty.' -ForegroundColor Cyan
Write-Host '2. Open Plugins > TypeR > TypeR and wait one full minute.' -ForegroundColor Cyan
Write-Host '3. Take a screenshot of the panel, with its text and colored boxes if any.' -ForegroundColor Cyan
Read-Host '4. Leave Photoshop open and press Enter here'
Add-Report 'First Photoshop'
Write-Report $ReportPath

Write-Host ''
$Again = Read-Host 'To compare with another Photoshop version, close this one, open the other, open TypeR, wait a minute, then type 2 and press Enter. Otherwise just press Enter'
if ($Again -eq '2') {
    Add-Report 'Second Photoshop'
    Write-Report $ReportPath
}

Write-Host ''
Write-Host "Report written: $ReportPath" -ForegroundColor Green
Write-Host 'Please send this file and the screenshot on the TypeR Discord.'
Write-Host 'To go back to the regular TypeR afterwards, install it again with its usual installer.'
Start-Process -FilePath 'explorer.exe' -ArgumentList "/select,`"$ReportPath`"" -ErrorAction SilentlyContinue
