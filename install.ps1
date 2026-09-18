param(
    [switch]$Silent,
    [switch]$Uxp,
    [switch]$Cep,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$ExtraArgs
)
$ErrorActionPreference = "Stop"

# Same spelling as install_mac.sh is accepted: --uxp, --cep, --silent (or /uxp).
foreach ($Argument in @($ExtraArgs | Where-Object { $_ })) {
    switch ($Argument.ToLowerInvariant()) {
        { $_ -in @('--uxp', '/uxp') } { $Uxp = [switch]$true }
        { $_ -in @('--cep', '/cep', '--legacy', '/legacy') } { $Cep = [switch]$true }
        { $_ -in @('--silent', '/silent') } { $Silent = [switch]$true }
        default { throw "Unknown option: $Argument (use -Uxp, -Cep or -Silent)" }
    }
}

# Encodage pour les accents dans la console
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = New-Object System.Text.UTF8Encoding

# Les invites bloquent les installations scriptées (CI, irm | iex, agents) :
# on ne demande une touche que dans une vraie console interactive
$Interactive = -not $Silent
try {
    if ([Console]::IsInputRedirected) { $Interactive = $false }
} catch { $Interactive = $false }

# --- 1. Définition robuste du dossier du script ---
# $PSScriptRoot est une variable native fiable, contrairement à %~dp0
$ScriptDir = if ($env:TYPER_INSTALL_SOURCE) { [IO.Path]::GetFullPath($env:TYPER_INSTALL_SOURCE).TrimEnd("\") } else { $PSScriptRoot }
Set-Location -Path $ScriptDir

# --- 2. Vérification du Manifest ---
$ManifestPath = Join-Path $ScriptDir "CSXS\manifest.xml"
if (-not (Test-Path $ManifestPath)) {
    Write-Host "[ERREUR] Fichier introuvable : $ManifestPath" -ForegroundColor Red
    Write-Host "Placez ce script à côté des dossiers 'CSXS', 'app', 'icons', 'locale', 'themes'."
    if ($Interactive) { Read-Host "Appuyez sur Entrée pour quitter..." }
    exit 1
}

# --- 3. Extraction de la version (plus précis que findstr) ---
$Content = Get-Content $ManifestPath -Raw
if ($Content -match 'Extension Id="typer".*?Version="([^"]+)"') {
    $ExtVersion = $matches[1]
} else {
    $ExtVersion = "Inconnue"
}

# --- 4. Langues et messages ---
# Détection de la langue de l'interface utilisateur (ex: fr-FR)
$Lang = $Host.CurrentCulture.TwoLetterISOLanguageName

# Valeurs par défaut (anglais)
$msg_install  = "Photoshop extension TypeR v$ExtVersion will be installed."
$msg_close    = "Close Photoshop (if it is open)."
$msg_complete = "Installation completed."
$msg_open     = "Open Photoshop and in the upper menu click the following: [Window] > [Extensions] > [TypeR]"
$msg_pause    = "Press Enter to continue..."
$msg_credits  = "TypeR developed by Sakushi & SeanR."
$msg_typertools = "typertools, developed by Swirt: https://swirt.github.io/typertools/"
$msg_discord  = "ScanR's Discord if you need help: https://discord.com/invite/Pdmfmqk"

if ($Lang -eq "fr") {
    $msg_install  = "L'extension Photoshop TypeR v$ExtVersion sera installée."
    $msg_close    = "Fermez Photoshop (s'il est ouvert)."
    $msg_complete = "Installation terminée."
    $msg_open     = "Ouvrez Photoshop et dans le menu supérieur cliquez sur : [Fenêtre] > [Extensions] > [TypeR]"
    $msg_pause    = "Appuyez sur Entrée pour continuer..."
    $msg_credits  = "TypeR développé par Sakushi & SeanR."
    $msg_typertools = "typertools, développé par Swirt : https://swirt.github.io/typertools/"
    $msg_discord  = "Discord de ScanR si besoin d'aide : https://discord.com/invite/Pdmfmqk"
}
elseif ($Lang -eq "es") {
    $msg_install  = "La extensión de Photoshop TypeR v$ExtVersion se instalará."
    $msg_close    = "Cierra Photoshop (si está abierto)."
    $msg_complete = "Instalación completada."
    $msg_open     = "Abre Photoshop y en el menú superior haz clic en lo siguiente: [Ventana] > [Extensiones] > [TypeR]"
    $msg_pause    = "Presiona Enter para continuar..."
    $msg_credits  = "TypeR desarrollado por Sakushi & SeanR."
    $msg_typertools = "typertools, desarrollado por Swirt: https://swirt.github.io/typertools/"
    $msg_discord  = "Discord de ScanR si necesitas ayuda: https://discord.com/invite/Pdmfmqk"
}
elseif ($Lang -eq "pt") {
    $msg_install  = "A extensão do Photoshop TypeR v$ExtVersion será instalada."
    $msg_close    = "Feche o Photoshop (se estiver aberto)."
    $msg_complete = "Instalação concluída."
    $msg_open     = "Abra o Photoshop e no menu superior clique em: [Janela] > [Extensões] > [TypeR]"
    $msg_pause    = "Pressione Enter para continuar..."
    $msg_credits  = "TypeR desenvolvido por Sakushi & SeanR."
    $msg_typertools = "typertools, desenvolvido por Swirt: https://swirt.github.io/typertools/"
    $msg_discord  = "Discord do ScanR se precisar de ajuda: https://discord.com/invite/Pdmfmqk"
}

# --- 4b. Choix de l'édition : UXP (récente) ou Legacy CEP ---
# -Uxp / -Cep ou TYPER_INSTALL_EDITION=uxp|cep. Sans choix explicite, une
# installation non interactive (mises à jour, CI) reste en CEP.
if ($Uxp -and $Cep) { throw 'Choose only one of -Uxp or -Cep' }
$Edition = if ($Uxp) { 'uxp' } elseif ($Cep) { 'cep' } elseif ($env:TYPER_INSTALL_EDITION) { $env:TYPER_INSTALL_EDITION.ToLowerInvariant() } else { '' }
if ($Edition -eq 'legacy') { $Edition = 'cep' }
if ($Edition -notin @('', 'uxp', 'cep')) { throw "Invalid TYPER_INSTALL_EDITION: $Edition (use uxp or cep)" }

$UxpId = 'fr.scanr.typer.silicon'
$UxpCcx = Join-Path $ScriptDir 'TypeR-Silicon.ccx'
$UxpManifest = $null
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
function Read-UxpManifest([string]$Path) {
    $Archive = [IO.Compression.ZipFile]::OpenRead($Path)
    try {
        $Entry = $Archive.GetEntry('manifest.json')
        if (-not $Entry) { return $null }
        $Reader = New-Object IO.StreamReader($Entry.Open(), [Text.Encoding]::UTF8)
        try { return ($Reader.ReadToEnd() | ConvertFrom-Json) } finally { $Reader.Dispose() }
    } finally { $Archive.Dispose() }
}
if (Test-Path -LiteralPath $UxpCcx -PathType Leaf) { try { $UxpManifest = Read-UxpManifest $UxpCcx } catch { $UxpManifest = $null } }
$UxpMinVersion = if ($UxpManifest -and $UxpManifest.host.minVersion) { [string]$UxpManifest.host.minVersion } else { '26.0.0' }
$UxpVersion = if ($UxpManifest) { [string]$UxpManifest.version } else { '' }
$UxpMinMajor = 26
[void][int]::TryParse(($UxpMinVersion -split '\.')[0], [ref]$UxpMinMajor)
$UxpMinYear = $UxpMinMajor + 1999   # Photoshop 21 = 2020, donc 26 = 2025

$msg_choose  = "Choose the TypeR edition to install:"
$msg_opt_uxp = "  1) UXP (new edition, recommended): Photoshop $UxpMinYear (v$UxpMinMajor.0) or newer."
$msg_opt_cep = "  2) Legacy (CEP): older Photoshop versions, before $UxpMinYear (v$UxpMinMajor.0)."
$msg_detected = "Detected Photoshop:"
$msg_none_detected = "No Photoshop found in Program Files."
$msg_choice  = "Your choice"
$msg_invalid_choice = "Answer 1 (UXP) or 2 (Legacy CEP)."
$msg_install_uxp = "Photoshop plugin TypeR Silicon (UXP) v$UxpVersion will be installed."
$msg_open_uxp = "Open Photoshop and in the upper menu click the following: [Plugins] > [TypeR Silicon]"
$msg_uxp_fallback = "If TypeR Silicon is missing, double-click TypeR-Silicon.ccx to install it with Creative Cloud."
if ($Lang -eq "fr") {
    $msg_choose  = "Choisissez l'édition de TypeR à installer :"
    $msg_opt_uxp = "  1) UXP (nouvelle édition, recommandée) : Photoshop $UxpMinYear (v$UxpMinMajor.0) ou plus récent."
    $msg_opt_cep = "  2) Legacy (CEP) : anciennes versions de Photoshop, antérieures à $UxpMinYear (v$UxpMinMajor.0)."
    $msg_detected = "Photoshop détecté :"
    $msg_none_detected = "Aucun Photoshop détecté dans Program Files."
    $msg_choice  = "Votre choix"
    $msg_invalid_choice = "Répondez 1 (UXP) ou 2 (Legacy CEP)."
    $msg_install_uxp = "Le plugin Photoshop TypeR Silicon (UXP) v$UxpVersion sera installé."
    $msg_open_uxp = "Ouvrez Photoshop et dans le menu supérieur cliquez sur : [Plug-ins] > [TypeR Silicon]"
    $msg_uxp_fallback = "Si TypeR Silicon n'apparaît pas, double-cliquez sur TypeR-Silicon.ccx pour l'installer avec Creative Cloud."
}

# The newest installed Photoshop only selects the recommended default answer.
function Get-PhotoshopVersion {
    $Best = $null; $BestMajor = 0
    foreach ($Base in @($env:ProgramFiles, ${env:ProgramFiles(x86)}) | Where-Object { $_ }) {
        foreach ($Exe in Get-ChildItem -Path (Join-Path $Base 'Adobe\Adobe Photoshop*\Photoshop.exe') -ErrorAction SilentlyContinue) {
            $Found = $Exe.VersionInfo.ProductVersion
            $Major = 0
            if ($Found -and [int]::TryParse(($Found -split '\.')[0], [ref]$Major) -and $Major -gt $BestMajor) { $BestMajor = $Major; $Best = $Found }
        }
    }
    return $Best
}

if (-not $Edition -and $Interactive -and -not $env:TYPER_INSTALL_VALIDATE_ONLY) {
    Clear-Host
    $PhotoshopVersion = Get-PhotoshopVersion
    $DefaultChoice = '1'
    if ($PhotoshopVersion -and [int](($PhotoshopVersion -split '\.')[0]) -lt $UxpMinMajor) { $DefaultChoice = '2' }
    Write-Host $msg_choose -ForegroundColor Cyan
    Write-Host $msg_opt_uxp
    Write-Host $msg_opt_cep
    if ($PhotoshopVersion) { Write-Host "$msg_detected $PhotoshopVersion" } else { Write-Host $msg_none_detected }
    while (-not $Edition) {
        $Answer = Read-Host -Prompt "$msg_choice [$DefaultChoice]"
        if (-not $Answer) { $Answer = $DefaultChoice }
        switch ($Answer.Trim().ToLowerInvariant()) {
            { $_ -in @('1', 'uxp') } { $Edition = 'uxp' }
            { $_ -in @('2', 'cep', 'legacy') } { $Edition = 'cep' }
            default { Write-Host $msg_invalid_choice -ForegroundColor Yellow }
        }
    }
}
if (-not $Edition) { $Edition = 'cep' }

# --- 4c. Installation UXP (TypeR Silicon) ---
# Copies the plugin into %APPDATA%\Adobe\UXP\Plugins\External and merges its
# entry into PluginsInfo\v1\PS.json; other registered plugins are preserved.
function Install-TypeRUxp {
    if (-not (Test-Path -LiteralPath $UxpCcx -PathType Leaf) -or (Get-Item -LiteralPath $UxpCcx).Length -eq 0) { throw 'Incomplete TypeR package: TypeR-Silicon.ccx' }
    if ((Get-Item -LiteralPath $UxpCcx).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'TypeR-Silicon.ccx is a link' }
    if (-not $UxpManifest -or $UxpManifest.id -ne $UxpId -or $UxpManifest.host.app -ne 'PS') { throw 'Invalid UXP plugin identity' }
    if ($UxpVersion -notmatch '^\d+\.\d+\.\d+$' -or $UxpMinVersion -notmatch '^\d+(\.\d+)*$') { throw 'Invalid UXP plugin version' }
    # Validate every archive entry before writing anything.
    $Archive = [IO.Compression.ZipFile]::OpenRead($UxpCcx)
    try {
        $Seen = @{}
        foreach ($Entry in $Archive.Entries) {
            $Name = $Entry.FullName
            if ($Name -notmatch '^[A-Za-z0-9_@.+/-]+$' -or $Name.StartsWith('/') -or $Name -match '//' -or $Name -match '(^|/)\.\.?(/|$)') { throw "Unsafe UXP package path: $Name" }
            if ($Seen.ContainsKey($Name.ToLowerInvariant())) { throw "Duplicate UXP package path: $Name" }
            $Seen[$Name.ToLowerInvariant()] = $true
        }
        if (-not $Seen.ContainsKey('manifest.json')) { throw 'Incomplete UXP package' }
    } finally { $Archive.Dispose() }
    if ($env:TYPER_INSTALL_VALIDATE_ONLY) { return }

    $UxpRoot = Join-Path $env:APPDATA 'Adobe\UXP'
    $External = Join-Path $UxpRoot 'Plugins\External'
    $RegistryDir = Join-Path $UxpRoot 'PluginsInfo\v1'
    $Registry = Join-Path $RegistryDir 'PS.json'
    $Destination = Join-Path $External ($UxpId + '_' + $UxpVersion)
    New-Item -ItemType Directory -Path $External, $RegistryDir -Force | Out-Null
    foreach ($Path in @($External, $Registry)) {
        if ((Test-Path -LiteralPath $Path) -and ((Get-Item -LiteralPath $Path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Refusing to follow a link: $Path" }
    }
    $Work = Join-Path $UxpRoot ('Plugins\.typer-uxp-install-' + [Guid]::NewGuid().ToString('N'))
    $Stage = Join-Path $Work 'plugin'; $Backup = Join-Path $Work 'backup'
    $Moved = @(); $Installed = $false; $KeepBackup = $false
    try {
        New-Item -ItemType Directory -Path $Stage, $Backup -Force | Out-Null
        $Archive = [IO.Compression.ZipFile]::OpenRead($UxpCcx)
        try {
            foreach ($Entry in $Archive.Entries) {
                $Target = [IO.Path]::GetFullPath((Join-Path $Stage $Entry.FullName.Replace('/', '\')))
                if (-not $Target.StartsWith($Stage + '\', [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe UXP package path: $($Entry.FullName)" }
                if ($Entry.FullName.EndsWith('/')) { New-Item -ItemType Directory -Path $Target -Force | Out-Null; continue }
                New-Item -ItemType Directory -Path (Split-Path -Parent $Target) -Force | Out-Null
                [IO.Compression.ZipFileExtensions]::ExtractToFile($Entry, $Target, $false)
            }
        } finally { $Archive.Dispose() }

        # Merge PS.json. An unreadable or unexpected file aborts instead of being overwritten.
        $Document = [pscustomobject]@{ plugins = @() }
        if (Test-Path -LiteralPath $Registry -PathType Leaf) {
            $Raw = [IO.File]::ReadAllText($Registry)
            if ($Raw.Trim()) { $Document = $Raw | ConvertFrom-Json }
        }
        if (-not ($Document -is [Management.Automation.PSCustomObject])) { throw "Unexpected format in $Registry; not modified" }
        if ($null -eq $Document.PSObject.Properties['plugins']) { $Document | Add-Member -NotePropertyName plugins -NotePropertyValue @() }
        if ($null -ne $Document.plugins -and -not ($Document.plugins -is [array])) { throw "Unexpected plugins format in $Registry; not modified" }
        $Others = @($Document.plugins | Where-Object { $null -ne $_ -and $_.pluginId -ne $UxpId })
        $Entry = [pscustomobject][ordered]@{
            hostMinVersion = $UxpMinVersion
            name = 'TypeR Silicon'
            path = '$localPlugins/External/' + $UxpId + '_' + $UxpVersion
            pluginId = $UxpId
            status = 'enabled'
            type = 'uxp'
            versionString = $UxpVersion
        }
        $Document.plugins = [object[]]($Others + $Entry)
        # Windows PowerShell 5.1 can serialise arrays as {"value":[...],"Count":n}.
        Remove-TypeData -TypeName System.Array -ErrorAction SilentlyContinue
        $Json = ConvertTo-Json -InputObject $Document -Depth 32 -Compress
        $Check = $Json | ConvertFrom-Json
        if (@($Check.plugins).Count -ne ($Others.Count + 1) -or @($Check.plugins | Where-Object { $_.pluginId -eq $UxpId }).Count -ne 1) { throw 'PS.json merge verification failed' }
        $NewRegistry = Join-Path $Work 'PS.json'
        [IO.File]::WriteAllText($NewRegistry, $Json, (New-Object Text.UTF8Encoding $false))

        foreach ($Previous in Get-ChildItem -LiteralPath $External -Force | Where-Object { $_.Name -like ($UxpId + '_*') }) {
            Move-Item -LiteralPath $Previous.FullName -Destination (Join-Path $Backup $Previous.Name)
            $Moved += $Previous.Name
        }
        Move-Item -LiteralPath $Stage -Destination $Destination
        $Installed = $true
        if (Test-Path -LiteralPath $Registry -PathType Leaf) { [IO.File]::Replace($NewRegistry, $Registry, $null) } else { [IO.File]::Move($NewRegistry, $Registry) }
    } catch {
        $Failure = $_
        try {
            if ($Installed) { Remove-Item -LiteralPath $Destination -Recurse -Force }
            foreach ($Name in $Moved) { Move-Item -LiteralPath (Join-Path $Backup $Name) -Destination (Join-Path $External $Name) }
        } catch { $KeepBackup = $true; Write-Warning "Recovery backup retained: $Work" }
        Write-Host $msg_uxp_fallback -ForegroundColor Yellow
        throw $Failure
    } finally {
        if (-not $KeepBackup -and (Test-Path -LiteralPath $Work)) { Remove-Item -LiteralPath $Work -Recurse -Force }
    }
}

if ($Edition -eq 'uxp') {
    if ($Interactive) { Clear-Host }
    Write-Host "+------------------------------------------------------------------+" -ForegroundColor Cyan
    Write-Host "|                     TypeR Silicon (UXP) Installer                |" -ForegroundColor Cyan
    Write-Host "+------------------------------------------------------------------+" -ForegroundColor Cyan
    Write-Host ""
    Write-Host $msg_install_uxp
    Write-Host ""
    Write-Host $msg_close -ForegroundColor Yellow
    Write-Host ""
    if ($Interactive -and -not $env:TYPER_INSTALL_VALIDATE_ONLY) { Read-Host -Prompt $msg_pause }
    Install-TypeRUxp
    if ($env:TYPER_INSTALL_VALIDATE_ONLY) { return }
    Write-Host ""
    Write-Host "+------------------------------------------------------------------+" -ForegroundColor Green
    Write-Host "|                      Installation Completed                      |" -ForegroundColor Green
    Write-Host "+------------------------------------------------------------------+" -ForegroundColor Green
    Write-Host ""
    Write-Host $msg_complete
    Write-Host ""
    Write-Host $msg_open_uxp -ForegroundColor Cyan
    Write-Host ""
    Write-Host "+------------------------------------------------------------------+"
    Write-Host "| Credits:                                                         |"
    Write-Host "+------------------------------------------------------------------+"
    Write-Host ("  {0}" -f $msg_credits)
    Write-Host ("  {0}" -f $msg_typertools)
    Write-Host ("  {0}" -f $msg_discord)
    Write-Host ""
    if ($Interactive) { Read-Host -Prompt $msg_pause }
    return
}

if ($Interactive) { Clear-Host }
Write-Host "+------------------------------------------------------------------+" -ForegroundColor Cyan
Write-Host "|                          TypeR Installer                         |" -ForegroundColor Cyan
Write-Host "+------------------------------------------------------------------+" -ForegroundColor Cyan
Write-Host ""
Write-Host $msg_install
Write-Host ""
Write-Host $msg_close -ForegroundColor Yellow
Write-Host ""
if ($Interactive) { Read-Host -Prompt $msg_pause }

# Use .NET directly: Get-FileHash may be absent from older Windows PowerShell
# or from child processes inheriting a PowerShell Core module search path.
function Get-TypeRFileHash([string]$FilePath) {
    $Stream = [IO.File]::OpenRead($FilePath)
    $Algorithm = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($Algorithm.ComputeHash($Stream)).Replace('-', '').ToLowerInvariant() }
    finally { $Algorithm.Dispose(); $Stream.Dispose() }
}
$Folders = @('app', 'CSXS', 'icons', 'locale')
$Inventory = Join-Path $ScriptDir 'app/package.sha256'
if (-not (Test-Path -LiteralPath $Inventory -PathType Leaf)) { throw 'Incomplete TypeR package: missing inventory' }
$Required = @('app/index.html','app/index.js','app/modern.html','app/legacy.html','app/modern.index.js','app/legacy.index.js','app/modern.css','app/legacy.css','app/host.jsx','CSXS/manifest.xml','locale/messages.properties','icons/iconNormal.png')
$Listed = @{}
foreach ($Line in Get-Content -LiteralPath $Inventory) {
    if ($Line -notmatch '^([a-f0-9]{64})  ((app|CSXS|icons|locale)/[A-Za-z0-9_@./-]+)$') { throw 'Invalid package inventory' }
    $Hash = $Matches[1]; $Relative = $Matches[2]
    if ($Relative -match '(^|/)\.\.?($|/)|//' -or $Relative -eq 'app/package.sha256' -or $Listed.ContainsKey($Relative)) { throw 'Unsafe or duplicate package path' }
    $File = Join-Path $ScriptDir $Relative
    if (-not (Test-Path -LiteralPath $File -PathType Leaf)) { throw "Missing file: $Relative" }
    if ((Get-TypeRFileHash $File) -ne $Hash) { throw "Checksum mismatch: $Relative" }
    $Listed[$Relative] = $true
}
foreach ($Relative in $Required) {
    if (-not $Listed.ContainsKey($Relative) -or (Get-Item -LiteralPath (Join-Path $ScriptDir $Relative)).Length -eq 0) { throw "Incomplete package: $Relative" }
}
[xml]$Manifest = Get-Content -LiteralPath (Join-Path $ScriptDir 'CSXS/manifest.xml') -Raw
$Extension = $Manifest.ExtensionManifest.ExtensionList.Extension | Where-Object { $_.Id -eq 'typer' }
if ($Manifest.ExtensionManifest.ExtensionBundleId -ne 'com.scanr.typer' -or $Extension.Version -notmatch '^\d+\.\d+\.\d+$' -or $Manifest.ExtensionManifest.ExtensionBundleVersion -ne $Extension.Version) { throw 'Invalid TypeR identity or version' }
foreach ($Folder in $Folders) {
    $FolderPath = Join-Path $ScriptDir $Folder
    if ((Get-Item -LiteralPath $FolderPath).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Package contains a link' }
    foreach ($Item in Get-ChildItem -LiteralPath $FolderPath -Recurse -Force) {
        if ($Item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Package contains a link' }
        if (-not $Item.PSIsContainer) {
            $Relative = $Item.FullName.Substring($ScriptDir.Length + 1).Replace('\', '/')
            if ($Relative -ne 'app/package.sha256' -and -not $Listed.ContainsKey($Relative)) { throw "Unlisted file: $Relative" }
        }
    }
}
if ($env:TYPER_INSTALL_VALIDATE_ONLY) { return }
$TargetDir = if ($env:TYPER_INSTALL_TARGET) { $env:TYPER_INSTALL_TARGET } else { Join-Path $env:APPDATA 'Adobe\CEP\extensions\typertools' }
$TargetDir = [IO.Path]::GetFullPath($TargetDir).TrimEnd('\')
if ($TargetDir -eq $ScriptDir -or $TargetDir -eq [IO.Path]::GetPathRoot($TargetDir).TrimEnd('\')) { throw 'Invalid installation target' }
if ((Test-Path -LiteralPath $TargetDir) -and ((Get-Item -LiteralPath $TargetDir).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Target is a link' }
New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null
$WorkDir = Join-Path $TargetDir ('.typer-install-' + [Guid]::NewGuid().ToString('N'))
$Stage = Join-Path $WorkDir 'stage'; $Backup = Join-Path $WorkDir 'backup'
$Moved = @(); $Installed = @(); $KeepBackup = $false
try {
    New-Item -ItemType Directory -Path $Stage, $Backup -Force | Out-Null
    foreach ($Folder in $Folders) { Copy-Item -LiteralPath (Join-Path $ScriptDir $Folder) -Destination $Stage -Recurse }
    foreach ($Line in Get-Content -LiteralPath $Inventory) {
        $Parts = $Line -split '  ', 2
        if ((Get-TypeRFileHash (Join-Path $Stage $Parts[1])) -ne $Parts[0]) { throw 'Staged package verification failed' }
    }
    foreach ($Folder in $Folders) {
        $Destination = Join-Path $TargetDir $Folder
        if (Test-Path -LiteralPath $Destination) {
            Move-Item -LiteralPath $Destination -Destination (Join-Path $Backup $Folder)
            $Moved += $Folder
        }
        Move-Item -LiteralPath (Join-Path $Stage $Folder) -Destination $Destination
        $Installed += $Folder
    }
} catch {
    $Failure = $_
    try {
        foreach ($Folder in $Installed) { Remove-Item -LiteralPath (Join-Path $TargetDir $Folder) -Recurse -Force }
        foreach ($Folder in $Moved) { Move-Item -LiteralPath (Join-Path $Backup $Folder) -Destination (Join-Path $TargetDir $Folder) }
    } catch { $KeepBackup = $true; Write-Warning "Recovery backup retained: $WorkDir" }
    throw $Failure
} finally {
    if (-not $KeepBackup -and (Test-Path -LiteralPath $WorkDir)) { Remove-Item -LiteralPath $WorkDir -Recurse -Force }
}
# A complete offline repair supersedes an interrupted in-place transaction.
$OldJournal = Join-Path $TargetDir '.typer-update-journal.json'
if (Test-Path -LiteralPath $OldJournal -PathType Leaf) { Remove-Item -LiteralPath $OldJournal }
if (-not $env:TYPER_INSTALL_SKIP_DEBUG) {
    6..18 | ForEach-Object {
        $RegistryPath = "HKCU:\Software\Adobe\CSXS.$_"
        New-Item -Path $RegistryPath -Force | Out-Null
        New-ItemProperty -Path $RegistryPath -Name PlayerDebugMode -Value '1' -PropertyType String -Force | Out-Null
    }
}

# --- 7. Fin ---
Write-Host ""
Write-Host "+------------------------------------------------------------------+" -ForegroundColor Green
Write-Host "|                      Installation Completed                      |" -ForegroundColor Green
Write-Host "+------------------------------------------------------------------+" -ForegroundColor Green
Write-Host ""
Write-Host $msg_complete
Write-Host ""
Write-Host $msg_open -ForegroundColor Cyan
Write-Host ""
Write-Host "+------------------------------------------------------------------+"
Write-Host "| Credits:                                                         |"
Write-Host "+------------------------------------------------------------------+"
Write-Host ("  {0}" -f $msg_credits)
Write-Host ("  {0}" -f $msg_typertools)
Write-Host ("  {0}" -f $msg_discord)
Write-Host ""
if ($Interactive) { Read-Host -Prompt $msg_pause }
