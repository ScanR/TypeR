# TypeR WebView rescue: tries, one after the other, the known ways out of a
# TypeR panel whose WebView Photoshop refuses to create, and reads Photoshop's
# own UXP log after each try to say whether it worked. Everything it did, saw
# and concluded goes to a report next to this script, with copies of the UXP
# logs of the sessions it ran (without the Home screen's [console] lines).
#
# As automatic as it can be: it closes Photoshop itself (the way the close
# button does, so an unsaved document still gets its dialog), installs the
# support build of TypeR from the kit (which opens in the panel itself when
# Photoshop refuses its WebView), starts Photoshop for each try and reads the result in
# the log. The user is asked for one thing only: to open the TypeR panel when
# Photoshop does not open it by itself. The folder it renames is put back when
# the try does not help; the environment variables only apply to the Photoshop
# it starts. Speaks French on a French Windows. PowerShell 5.1; saved as UTF-8
# with BOM for the accents.
#
#   webview_rescue_win.ps1 [-PhotoshopPath <Photoshop.exe>] [-OutputFolder <folder>] [-NoInstall]
#   webview_rescue_win.ps1 -Analyze <UXPLogs file>   (prints what the log says, no tries)
param(
    [string]$PhotoshopPath,
    [string]$OutputFolder,
    [string]$Analyze,
    [switch]$NoInstall,
    [string]$AppDataPath = $env:APPDATA,
    [int]$WatchSeconds = 110,
    [int]$PanelWaitSeconds = 60
)
$ErrorActionPreference = 'Continue'
$Script:Lines = New-Object System.Collections.Generic.List[string]
$Script:Results = New-Object System.Collections.Generic.List[string]
$Script:ReportPath = $null

# --- words for the user --------------------------------------------------------
$French = $Host.CurrentCulture.TwoLetterISOLanguageName -eq 'fr'
$T = @{
    title = 'TypeR WebView rescue'
    intro1 = 'This tries the known ways out of a TypeR panel that Photoshop cannot display, one by one,'
    intro2 = 'and checks each one in Photoshop''s own log. It closes and restarts Photoshop by itself,'
    intro3 = 'four times, about ten minutes in all. Nothing is uploaded. The report goes here:'
    save = 'Save your documents in Photoshop, then press Enter'
    stillOpen = 'Photoshop is still open (a dialog asks about a document?). Close it, then press Enter'
    noPhotoshop = 'Photoshop.exe was not found. Run again with -PhotoshopPath "C:\...\Photoshop.exe".'
    installing = 'Installing the TypeR support build...'
    starting = 'Starting Photoshop'
    watching = 'reading Photoshop''s log'
    openPanel = 'Photoshop did not open the TypeR panel by itself. Open it: Plugins > TypeR > TypeR, then press Enter'
    worked = 'This try WORKED: TypeR has its WebView.'
    failed = 'This try did not help.'
    try1 = 'Try 1: a normal start (when refused, TypeR opens without its WebView, in the panel itself)'
    try2 = 'Try 2: a fresh plugin WebView cache folder'
    try3 = 'Try 3: Photoshop started on Microsoft''s WebView2 runtime instead of Adobe''s copy'
    try4 = 'Try 4: Photoshop started with a fresh WebView2 data folder'
    keep2 = 'Keep it so: the old folder stays next to it (plugin WebView caches; delete it when all is well).'
    keep3 = 'To keep it: set the user environment variable WEBVIEW2_BROWSER_EXECUTABLE_FOLDER to the folder below (Windows settings > environment variables), then restart Photoshop.'
    keep4 = 'To keep it: set the user environment variable WEBVIEW2_USER_DATA_FOLDER to the folder below, then restart Photoshop.'
    continueAsk = 'Press Enter to run the remaining tries anyway (useful for the report), or close this window to stop here'
    restored = 'The original cache folder is back in place.'
    done = 'Report written:'
    send = 'Send this file, the uxp-logs folder next to it and the JSON report to TypeR support.'
    reinstall = 'TypeR DEBUG stays installed: install the normal TypeR again when all is well.'
    close = 'Press Enter to close'
}
if ($French) {
    $T = @{
        title = 'Secours WebView de TypeR'
        intro1 = 'Ce script essaie une par une les solutions connues quand Photoshop ne peut pas afficher TypeR,'
        intro2 = 'et vérifie chacune dans le journal de Photoshop. Il ferme et relance Photoshop lui-même,'
        intro3 = 'quatre fois, une dizaine de minutes en tout. Rien n''est envoyé. Le rapport sera ici :'
        save = 'Enregistrez vos documents dans Photoshop, puis appuyez sur Entrée'
        stillOpen = 'Photoshop est encore ouvert (une boîte de dialogue demande quelque chose ?). Fermez-le, puis appuyez sur Entrée'
        noPhotoshop = 'Photoshop.exe est introuvable. Relancez avec -PhotoshopPath "C:\...\Photoshop.exe".'
        installing = 'Installation de la version de support de TypeR...'
        starting = 'Lancement de Photoshop'
        watching = 'lecture du journal de Photoshop'
        openPanel = 'Photoshop n''a pas ouvert le panneau TypeR tout seul. Ouvrez-le : Plug-ins > TypeR > TypeR, puis appuyez sur Entrée'
        worked = 'Cet essai a MARCHÉ : TypeR a son WebView.'
        failed = 'Cet essai n''a rien changé.'
        try1 = 'Essai 1 : démarrage normal (en cas de refus, TypeR s''ouvre sans son WebView, dans le panneau lui-même)'
        try2 = 'Essai 2 : dossier de cache WebView des plugins remis à neuf'
        try3 = 'Essai 3 : Photoshop lancé sur le WebView2 de Microsoft au lieu de la copie d''Adobe'
        try4 = 'Essai 4 : Photoshop lancé avec un dossier de données WebView2 neuf'
        keep2 = 'Gardez les choses ainsi : l''ancien dossier reste à côté (caches des WebView de plugins ; supprimez-le quand tout va bien).'
        keep3 = 'Pour le garder : créez la variable d''environnement utilisateur WEBVIEW2_BROWSER_EXECUTABLE_FOLDER avec le dossier ci-dessous (Paramètres Windows > variables d''environnement), puis relancez Photoshop.'
        keep4 = 'Pour le garder : créez la variable d''environnement utilisateur WEBVIEW2_USER_DATA_FOLDER avec le dossier ci-dessous, puis relancez Photoshop.'
        continueAsk = 'Appuyez sur Entrée pour faire quand même les essais restants (utile pour le rapport), ou fermez cette fenêtre pour vous arrêter là'
        restored = 'Le dossier de cache d''origine est remis en place.'
        done = 'Rapport écrit :'
        send = 'Envoyez ce fichier, le dossier uxp-logs à côté et le rapport JSON au support TypeR.'
        reinstall = 'TypeR DEBUG reste installé : réinstallez le TypeR normal quand tout va bien.'
        close = 'Appuyez sur Entrée pour fermer'
    }
}

# --- log reading ---------------------------------------------------------------
$FailurePattern = 'createWebView\(\) failed|Failed to create WebView'
$CreatedPattern = 'createWebView\(\) create new for thirdparty plugin'
$RuntimePattern = 'WebView2BrowserVersion:\s*(\S+)'
$FolderPattern = 'UXP will use the WebView2 runtime in the folder: (.+)$'
$InterestPattern = '(?i)webview|storage|fail|error|exception|denied|com\.scanr\.typer'
# Lines of every session that say nothing about the problem
$NoisePattern = 'Using Default Value for Icon species|We are going to deprecate|analyticsTracker_|HostInfoController'

function Get-UxpLogFiles {
    $Adobe = Join-Path $AppDataPath 'Adobe'
    $Files = @()
    foreach ($Dir in @(Get-ChildItem -LiteralPath $Adobe -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like 'Adobe Photoshop*' })) {
        $Logs = Join-Path $Dir.FullName 'Logs'
        $Files += @(Get-ChildItem -LiteralPath $Logs -Filter 'UXPLogs_*.log' -File -ErrorAction SilentlyContinue)
    }
    @($Files | Sort-Object Name)
}
function Get-NewestUxpLog { @(Get-UxpLogFiles) | Select-Object -Last 1 }

# What a set of log lines says about WebViews
function Read-UxpLines([string[]]$Text) {
    $Facts = [ordered]@{ failures = @(); created = 0; runtime = $null; folder = $null; other = @() }
    foreach ($Raw in $Text) {
        if ($Raw -match '\[console\]' -or $Raw -match $NoisePattern) { continue }
        if ($Raw -match $FailurePattern) { $Facts.failures += $Raw.Trim() }
        elseif ($Raw -match $CreatedPattern) { $Facts.created++ }
        elseif ($Raw -match $RuntimePattern) { $Facts.runtime = $matches[1] }
        elseif ($Raw -match $FolderPattern) { $Facts.folder = $matches[1].Trim() }
        elseif ($Raw -match $InterestPattern) { $Facts.other += $Raw.Trim() }
    }
    $Facts
}
function Get-Verdict($Facts) {
    if ($Facts.created -gt 0 -and $Facts.failures.Count -eq 0) { return 'WORKED: Photoshop created the TypeR WebView' }
    if ($Facts.created -gt 0) { return "WORKED LATE: $($Facts.created) WebView created after $($Facts.failures.Count) refusal(s) (Photoshop was still starting)" }
    if ($Facts.failures.Count -gt 0) { return "FAILED: Photoshop refused the WebView $($Facts.failures.Count) time(s): " + ($Facts.failures[-1] -replace '^\[[^\]]*\]\[\d+\]', '') }
    return 'NOTHING: no WebView attempt in the log (was the TypeR panel open?)'
}

# --- report --------------------------------------------------------------------
function Add-Line([string]$Text) {
    $Stamp = Get-Date -Format 'HH:mm:ss'
    $Script:Lines.Add("[$Stamp] $Text")
    Write-Host $Text
}
function Add-Result([string]$Step, [string]$Verdict) {
    $Script:Results.Add("$Step => $Verdict")
    Add-Line "RESULT $Step => $Verdict"
    if ($Verdict -like 'WORKED*') { Write-Host "  $($T.worked)" -ForegroundColor Green } else { Write-Host "  $($T.failed)" -ForegroundColor Yellow }
}
function Write-Report {
    if (-not $Script:ReportPath) { return }
    $Text = @('TypeR WebView rescue report', "Started: $Script:Started", "Windows: $([Environment]::OSVersion.VersionString)", '', '=== Results ===') + @($Script:Results) + @('', '=== Journal ===') + @($Script:Lines)
    $Body = ($Text -join "`r`n")
    if ($env:USERNAME) { $Body = $Body.Replace($env:USERNAME, '<user>') }
    [IO.File]::WriteAllText($Script:ReportPath, $Body, (New-Object Text.UTF8Encoding($false)))
}
function Ask([string]$Question) {
    Write-Host ''
    $Answer = Read-Host $Question
    Add-Line "ASKED: $Question => $Answer"
    $Answer
}
function Copy-UxpLog($File, [string]$Label) {
    if (-not $File) { return }
    try {
        $Folder = Join-Path (Split-Path -Parent $Script:ReportPath) 'uxp-logs'
        if (-not (Test-Path -LiteralPath $Folder)) { $null = New-Item -ItemType Directory -Path $Folder }
        $Target = Join-Path $Folder ($Label + '-' + $File.Name)
        $Kept = @(Get-Content -LiteralPath $File.FullName -ErrorAction Stop | Where-Object { $_ -notmatch '\[console\]' } | ForEach-Object { $_.ToString() })
        $Body = ($Kept -join "`r`n")
        if ($env:USERNAME) { $Body = $Body.Replace($env:USERNAME, '<user>') }
        [IO.File]::WriteAllText($Target, $Body, (New-Object Text.UTF8Encoding($false)))
        Add-Line "Copied $($File.Name) ($($Kept.Count) lines kept of the session's log) to uxp-logs\"
    } catch { Add-Line "Could not copy $($File.FullName): $($_.Exception.Message)" }
}

# --- analyze only --------------------------------------------------------------
if ($Analyze) {
    $Facts = Read-UxpLines @(Get-Content -LiteralPath $Analyze)
    $Facts['verdict'] = Get-Verdict $Facts
    ConvertTo-Json $Facts -Depth 5
    return
}

# --- Photoshop -----------------------------------------------------------------
function Get-RunningPhotoshop { @(Get-Process -Name 'Photoshop' -ErrorAction SilentlyContinue) }
function Find-Photoshop {
    if ($PhotoshopPath -and (Test-Path -LiteralPath $PhotoshopPath -PathType Leaf)) { return $PhotoshopPath }
    foreach ($Process in Get-RunningPhotoshop) { try { if ($Process.Path) { return $Process.Path } } catch {} }
    $Uninstall = @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*')
    $Found = @(Get-ItemProperty -Path $Uninstall -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like 'Adobe Photoshop*' -and $_.InstallLocation } | Sort-Object DisplayVersion -Descending)
    foreach ($Entry in $Found) {
        $Exe = Join-Path $Entry.InstallLocation 'Photoshop.exe'
        if (Test-Path -LiteralPath $Exe -PathType Leaf) { return $Exe }
    }
    foreach ($Base in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
        foreach ($Dir in @(Get-ChildItem -LiteralPath (Join-Path $Base 'Adobe') -Directory -Filter 'Adobe Photoshop*' -ErrorAction SilentlyContinue | Sort-Object Name -Descending)) {
            $Exe = Join-Path $Dir.FullName 'Photoshop.exe'
            if (Test-Path -LiteralPath $Exe -PathType Leaf) { return $Exe }
        }
    }
    $null
}
# Closes Photoshop the way its close button does: an unsaved document gets
# its dialog, which the user answers; nothing is ever killed
function Close-Photoshop {
    $Running = Get-RunningPhotoshop
    if (-not $Running.Count) { return }
    Add-Line 'Closing Photoshop (close button)'
    foreach ($Process in $Running) { try { $null = $Process.CloseMainWindow() } catch { Add-Line "  could not ask Photoshop to close: $($_.Exception.Message)" } }
    $Deadline = (Get-Date).AddSeconds(60)
    while ((Get-Date) -lt $Deadline -and (Get-RunningPhotoshop).Count) { Start-Sleep -Seconds 2 }
    while ((Get-RunningPhotoshop).Count) {
        $null = Ask $T.stillOpen
        foreach ($Process in Get-RunningPhotoshop) { try { $null = $Process.CloseMainWindow() } catch {} }
        Start-Sleep -Seconds 3
    }
    Add-Line 'Photoshop is closed'
    Start-Sleep -Seconds 3
}
# Starts Photoshop, with the given variables in its environment only, and
# returns the UXP log of the new session once it appears
function Start-PhotoshopSession([string]$Exe, [hashtable]$Environment) {
    $Before = @(Get-UxpLogFiles | ForEach-Object { $_.FullName })
    $Saved = @{}
    foreach ($Name in $Environment.Keys) { $Saved[$Name] = [Environment]::GetEnvironmentVariable($Name, 'Process'); [Environment]::SetEnvironmentVariable($Name, $Environment[$Name], 'Process') }
    try {
        $With = if ($Environment.Count) { ' with ' + (($Environment.Keys | ForEach-Object { "$_=$($Environment[$_])" }) -join '; ') } else { '' }
        Add-Line ("$($T.starting): $Exe" + $With)
        Start-Process -FilePath $Exe | Out-Null
    } finally {
        foreach ($Name in $Environment.Keys) { [Environment]::SetEnvironmentVariable($Name, $Saved[$Name], 'Process') }
    }
    $Deadline = (Get-Date).AddSeconds(90)
    while ((Get-Date) -lt $Deadline) {
        Start-Sleep -Seconds 2
        $New = @(Get-UxpLogFiles | Where-Object { $Before -notcontains $_.FullName })
        if ($New.Count) { Add-Line "Session log: $($New[-1].Name)"; return $New[-1] }
    }
    Add-Line 'No new UXP log appeared within 90 s'
    $null
}
function Get-LogLength($File) { if ($File) { @(Get-Content -LiteralPath $File.FullName -ErrorAction SilentlyContinue).Count } else { 0 } }
# Watches the session's log for the given time, returns the facts of the new
# lines. Ends early once a WebView is created, or once TypeR's own attempts
# (the first and three more) have all been refused.
function Watch-UxpLog($File, [int]$Seconds, [int]$From) {
    if (-not $File) { return (Read-UxpLines @()) }
    Write-Host "  $($T.watching) ($Seconds s)" -NoNewline
    $Deadline = (Get-Date).AddSeconds($Seconds)
    $Fresh = @()
    while ((Get-Date) -lt $Deadline) {
        Start-Sleep -Seconds 3
        $All = @(Get-Content -LiteralPath $File.FullName -ErrorAction SilentlyContinue)
        if ($All.Count -gt $From) { $Fresh = @($All[$From..($All.Count - 1)]) }
        $Facts = Read-UxpLines $Fresh
        if ($Facts.created -gt 0 -or $Facts.failures.Count -ge 4) { break }
        Write-Host '.' -NoNewline
    }
    Write-Host ''
    $Facts = Read-UxpLines $Fresh
    foreach ($Line in $Facts.failures) { Add-Line "  log: $Line" }
    foreach ($Line in @($Facts.other | Select-Object -First 25)) { Add-Line "  log: $Line" }
    if ($Facts.created) { Add-Line "  log: TypeR WebView created ($($Facts.created))" }
    if ($Facts.runtime) { Add-Line "  log: WebView2 runtime $($Facts.runtime)" }
    $Facts
}
# One try: Photoshop closed, started with the variables, its log read; the
# panel is asked for only when Photoshop did not open it by itself
function Invoke-Try([string]$Name, [string]$Exe, [hashtable]$Environment, [string]$Label) {
    Add-Line ''
    Add-Line "=== $Name ==="
    Close-Photoshop
    $Log = Start-PhotoshopSession $Exe $Environment
    $Facts = Watch-UxpLog $Log $PanelWaitSeconds 0
    if ($Facts.created -eq 0 -and $Facts.failures.Count -eq 0) {
        $null = Ask $T.openPanel
        $Facts = Watch-UxpLog $Log $WatchSeconds (Get-LogLength $Log)
    } elseif ($Facts.created -eq 0 -and $Facts.failures.Count -lt 4) {
        $Facts = Watch-UxpLog $Log ($WatchSeconds - $PanelWaitSeconds) 0
    }
    Add-Result $Name (Get-Verdict $Facts)
    Copy-UxpLog $Log $Label
    Write-Report
    $Facts
}

# --- main ----------------------------------------------------------------------
$Script:Started = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
$KitRoot = Split-Path -Parent $PSScriptRoot
if (-not $OutputFolder) { $OutputFolder = $KitRoot }
if (-not (Test-Path -LiteralPath $OutputFolder)) { $null = New-Item -ItemType Directory -Path $OutputFolder -Force }
$Script:ReportPath = Join-Path $OutputFolder ('TypeR-webview-rescue-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.txt')

Write-Host ''
Write-Host $T.title -ForegroundColor Cyan
Write-Host $T.intro1
Write-Host $T.intro2
Write-Host $T.intro3
Write-Host "  $Script:ReportPath"
Write-Host ''

$Exe = Find-Photoshop
if (-not $Exe) {
    Add-Line $T.noPhotoshop
    Write-Report; $null = Ask $T.close; exit 1
}
Add-Line "Photoshop: $Exe ($((Get-Item -LiteralPath $Exe).VersionInfo.ProductVersion))"
$Major = ((Get-Item -LiteralPath $Exe).VersionInfo.ProductVersion -split '\.')[0]
$StorageRoot = Join-Path $AppDataPath "Adobe\UXP\PluginsStorage\PHSP\$Major"
$WebViewStorage = Join-Path $StorageRoot 'WebView'
Add-Line "Plugin WebView storage folder: $WebViewStorage (present: $(Test-Path -LiteralPath $WebViewStorage))"
if (Test-Path -LiteralPath $WebViewStorage) {
    try {
        $Item = Get-Item -LiteralPath $WebViewStorage -Force
        Add-Line "  attributes: $($Item.Attributes); subfolders: $(@(Get-ChildItem -LiteralPath $WebViewStorage -Directory -Force -ErrorAction SilentlyContinue).Count)"
        $Acl = Get-Acl -LiteralPath $WebViewStorage -ErrorAction SilentlyContinue
        if ($Acl) { Add-Line "  owner: $($Acl.Owner)"; foreach ($Rule in $Acl.Access) { Add-Line "  access: $($Rule.IdentityReference) $($Rule.AccessControlType) $($Rule.FileSystemRights)" } }
    } catch { Add-Line "  could not read the folder: $($_.Exception.Message)" }
}
foreach ($Name in @('WEBVIEW2_BROWSER_EXECUTABLE_FOLDER', 'WEBVIEW2_USER_DATA_FOLDER', 'WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS', 'WEBVIEW2_RELEASE_CHANNEL_PREFERENCE')) {
    foreach ($Scope in @('User', 'Machine')) {
        $Value = [Environment]::GetEnvironmentVariable($Name, $Scope)
        if ($Value) { Add-Line "Environment ($Scope): $Name=$Value" }
    }
}
$Previous = Get-NewestUxpLog
if ($Previous) {
    $Facts = Read-UxpLines @(Get-Content -LiteralPath $Previous.FullName -ErrorAction SilentlyContinue)
    Add-Line "Newest previous session ($($Previous.Name)): $(Get-Verdict $Facts)"
    if ($Facts.folder) { Add-Line "  runtime folder UXP uses: $($Facts.folder)" }
    Copy-UxpLog $Previous 'previous'
}
Write-Report

if ((Get-RunningPhotoshop).Count) { $null = Ask $T.save }
Close-Photoshop

# ---- The support build, which asks for its WebView several times --------------
$Package = Join-Path $KitRoot 'TypeR-UXP-debug.ccx'
$Installer = Join-Path $PSScriptRoot 'install.ps1'
if (-not $NoInstall -and (Test-Path -LiteralPath $Package) -and (Test-Path -LiteralPath $Installer)) {
    Add-Line $T.installing
    & "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File $Installer -Uxp -Silent -Package $Package 2>&1 | ForEach-Object { Add-Line "  install: $_" }
    Add-Line "Support build install exit code: $LASTEXITCODE"
} else {
    Add-Line 'Support build not installed (missing package or -NoInstall): the installed TypeR is used as it is'
}

# ---- Try 1: a normal start -------------------------------------------------------
$Facts1 = Invoke-Try $T.try1 $Exe @{} 'try1'
$Worked = $Facts1.created -gt 0
if ($Worked) {
    if ($Facts1.failures.Count) { Add-Line 'Photoshop refused the first WebView(s) while starting and accepted a later one: TypeR now handles that by itself. Keep this version.' }
    $null = Ask $T.continueAsk
}

# ---- Try 2: a fresh plugin WebView storage ----------------------------------------
$Backup = $null
Close-Photoshop
if (Test-Path -LiteralPath $WebViewStorage) {
    $Backup = $WebViewStorage + '.before-rescue-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
    try {
        Rename-Item -LiteralPath $WebViewStorage -NewName (Split-Path -Leaf $Backup) -ErrorAction Stop
        Add-Line "Renamed $WebViewStorage to $Backup"
    } catch { Add-Line "Could not rename the folder: $($_.Exception.Message)"; $Backup = $null }
} else {
    Add-Line 'The folder does not exist: Photoshop will try to create it'
}
$Facts2 = Invoke-Try $T.try2 $Exe @{} 'try2'
Add-Line "Folder created again by Photoshop: $(Test-Path -LiteralPath $WebViewStorage)"
if ($Facts2.created -gt 0) {
    Write-Host "  $($T.keep2)" -ForegroundColor Green
    Add-Line "Workaround: the renamed folder stays at $Backup"
    if (-not $Worked) { $Worked = $true; $null = Ask $T.continueAsk }
}

# ---- Try 3: Microsoft's WebView2 runtime instead of Adobe's copy ------------------
$Microsoft = $null
foreach ($Base in @(${env:ProgramFiles(x86)}, $env:ProgramFiles, $env:LOCALAPPDATA)) {
    if (-not $Base) { continue }
    $App = Join-Path $Base 'Microsoft\EdgeWebView\Application'
    $Versions = @(Get-ChildItem -LiteralPath $App -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^\d' -and (Test-Path -LiteralPath (Join-Path $_.FullName 'msedgewebview2.exe')) } | Sort-Object { [version]$_.Name } -Descending)
    if ($Versions.Count) { $Microsoft = $Versions[0].FullName; break }
}
if ($Microsoft) {
    Add-Line "Microsoft runtime: $Microsoft"
    $Facts3 = Invoke-Try $T.try3 $Exe @{ WEBVIEW2_BROWSER_EXECUTABLE_FOLDER = $Microsoft } 'try3'
    if ($Facts3.created -gt 0) {
        Write-Host "  $($T.keep3)" -ForegroundColor Green
        Write-Host "  $Microsoft"
        Add-Line "Workaround: WEBVIEW2_BROWSER_EXECUTABLE_FOLDER=$Microsoft"
        if (-not $Worked) { $Worked = $true; $null = Ask $T.continueAsk }
    }
} else {
    Add-Result $T.try3 'SKIPPED: no Microsoft WebView2 runtime folder found'
}

# ---- Try 4: a WebView2 data folder of our own -------------------------------------
$Data = Join-Path $env:LOCALAPPDATA ('TypeR-webview-rescue-data-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$null = New-Item -ItemType Directory -Path $Data -Force
$Facts4 = Invoke-Try $T.try4 $Exe @{ WEBVIEW2_USER_DATA_FOLDER = $Data } 'try4'
Add-Line "Data folder used by this session: $Data (contents: $(@(Get-ChildItem -LiteralPath $Data -Force -ErrorAction SilentlyContinue).Count) entries)"
if ($Facts4.created -gt 0) {
    Write-Host "  $($T.keep4)" -ForegroundColor Green
    Write-Host "  $Data"
    Add-Line "Workaround: WEBVIEW2_USER_DATA_FOLDER=$Data"
}

# ---- Put things back when the storage try did not help ---------------------------
if ($Backup -and $Facts2.created -eq 0) {
    Close-Photoshop
    try {
        if (Test-Path -LiteralPath $WebViewStorage) { Remove-Item -LiteralPath $WebViewStorage -Recurse -Force -ErrorAction Stop }
        Rename-Item -LiteralPath $Backup -NewName (Split-Path -Leaf $WebViewStorage) -ErrorAction Stop
        Add-Line "Original folder put back: $WebViewStorage"
        Write-Host "  $($T.restored)"
    } catch { Add-Line "Could not put the original folder back ($($_.Exception.Message)); it is at $Backup" }
}

# ---- The collector's report, for the same folder ---------------------------------
$Collector = Join-Path $PSScriptRoot 'diagnose_uxp_win.ps1'
if (Test-Path -LiteralPath $Collector) {
    try {
        $JsonPath = Join-Path $OutputFolder ('TypeR-diagnostic-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json')
        & "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File $Collector -OutputPath $JsonPath | Out-Null
        Add-Line "Collector report: $JsonPath"
    } catch { Add-Line "Collector failed: $($_.Exception.Message)" }
}
Add-Line ''
Add-Line '=== Summary ==='
foreach ($Result in $Script:Results) { Add-Line $Result }
Write-Report
Write-Host ''
Write-Host "$($T.done) $Script:ReportPath" -ForegroundColor Green
Write-Host $T.send
Write-Host $T.reinstall
Start-Process -FilePath 'explorer.exe' -ArgumentList "/select,`"$Script:ReportPath`"" -ErrorAction SilentlyContinue
$null = Ask $T.close
