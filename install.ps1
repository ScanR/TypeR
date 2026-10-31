# install.ps1 [-Uxp | -Legacy] [-Silent] [TypeR-UXP.ccx]
# Without -Uxp or -Legacy an interactive console asks which version to install;
# a scripted installation (updates, tests) installs the Legacy version.
param([switch]$Silent, [switch]$Uxp, [switch]$Legacy, [Parameter(Position = 0)][string]$Package)
$ErrorActionPreference = "Stop"

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

# --- 2. Extraction de la version (plus précis que findstr) ---
$ManifestPath = Join-Path $ScriptDir "CSXS\manifest.xml"
$ExtVersion = "Inconnue"
if (Test-Path $ManifestPath) {
    $Content = Get-Content $ManifestPath -Raw
    if ($Content -match 'Extension Id="typer".*?Version="([^"]+)"') { $ExtVersion = $matches[1] }
}

# --- 3. Langues et messages ---
# Détection de la langue de l'interface utilisateur (ex: fr-FR)
$Lang = $Host.CurrentCulture.TwoLetterISOLanguageName

# Valeurs par défaut (anglais)
$msg_close    = "Photoshop is open: close it first."
$msg_complete = "Installation completed."
$msg_open     = "Open Photoshop and in the upper menu click the following: [Window] > [Extensions] > [TypeR]"
$msg_pause    = "Press Enter to continue..."
$msg_credits  = "TypeR developed by Sakushi & SeanR."
$msg_typertools = "typertools, developed by Swirt: https://swirt.github.io/typertools/"
$msg_discord  = "ScanR's Discord if you need help: https://discord.com/invite/Pdmfmqk"
$msg_title = "TypeR installer"
$msg_ps_found = "Photoshop found:"
$msg_ps_none = "Photoshop was not found on this computer."
$msg_uxp_name = "New TypeR (UXP)"
$msg_uxp_desc = "Faster, built on Adobe's newer plugin framework."
$msg_uxp_req = "Photoshop 2025 (version 26.0) or later"
$msg_uxp_too_old = "Your Photoshop is too old for this version."
$msg_legacy_name = "Legacy (CEP)"
$msg_legacy_desc = "Older and slower."
$msg_legacy_req = "Photoshop CC 2015 (version 16.0) or later"
$msg_recommended = "(recommended)"
$msg_keys = "↑/↓ choose  ·  Enter install  ·  Q quit"
$msg_cancelled = "Installation cancelled."
$msg_choice_prompt = "Your choice [1/2] (Enter = {0})"
$msg_choose   = "Which version of TypeR do you want to install?"
$msg_both     = "The other version of TypeR is installed too: do not open both panels at the same time (each shortcut would run twice)."
$msg_uxp_download = "Downloading the new TypeR (UXP)..."
$msg_uxp_installing = "Installing the new TypeR (UXP)..."
$msg_uxp_complete = "TypeR is installed: in Photoshop, open it from the menu [Plugins] > [TypeR]. If TypeR was already installed, restart Photoshop."
$msg_uxp_complete_manual = "TypeR is installed: restart Photoshop if it is open, then open TypeR from the menu [Plugins] > [TypeR]."
$msg_uxp_failed = "The installation failed. Close Photoshop and run this script again."

if ($Lang -eq "fr") {
    $msg_close    = "Photoshop est ouvert : fermez-le d'abord."
    $msg_complete = "Installation terminée."
    $msg_open     = "Ouvrez Photoshop et dans le menu supérieur cliquez sur : [Fenêtre] > [Extensions] > [TypeR]"
    $msg_pause    = "Appuyez sur Entrée pour continuer..."
    $msg_credits  = "TypeR développé par Sakushi & SeanR."
    $msg_typertools = "typertools, développé par Swirt : https://swirt.github.io/typertools/"
    $msg_discord  = "Discord de ScanR si besoin d'aide : https://discord.com/invite/Pdmfmqk"
    $msg_title = "Installation de TypeR"
    $msg_ps_found = "Photoshop détecté :"
    $msg_ps_none = "Photoshop n'a pas été trouvé sur cet ordinateur."
    $msg_uxp_name = "Nouveau TypeR (UXP)"
    $msg_uxp_desc = "Plus rapide, basé sur le framework de plugins le plus récent d'Adobe."
    $msg_uxp_req = "Photoshop 2025 (version 26.0) ou plus récent"
    $msg_uxp_too_old = "Votre Photoshop est trop ancien pour cette version."
    $msg_legacy_name = "Legacy (CEP)"
    $msg_legacy_desc = "Plus ancienne et plus lente."
    $msg_legacy_req = "Photoshop CC 2015 (version 16.0) ou plus récent"
    $msg_recommended = "(recommandé)"
    $msg_keys = "↑/↓ choisir  ·  Entrée installer  ·  Q quitter"
    $msg_cancelled = "Installation annulée."
    $msg_choice_prompt = "Votre choix [1/2] (Entrée = {0})"
    $msg_choose   = "Quelle version de TypeR voulez-vous installer ?"
    $msg_both     = "L'autre version de TypeR est aussi installée : n'ouvrez pas les deux panneaux en même temps (chaque raccourci s'exécuterait deux fois)."
    $msg_uxp_download = "Téléchargement du nouveau TypeR (UXP)..."
    $msg_uxp_installing = "Installation du nouveau TypeR (UXP)..."
    $msg_uxp_complete = "TypeR est installé : dans Photoshop, ouvrez-le depuis le menu [Plug-ins] > [TypeR]. Si TypeR était déjà installé, redémarrez Photoshop."
    $msg_uxp_complete_manual = "TypeR est installé : redémarrez Photoshop s'il est ouvert, puis ouvrez TypeR depuis le menu [Plug-ins] > [TypeR]."
    $msg_uxp_failed = "L'installation a échoué. Fermez Photoshop et relancez ce script."
}
elseif ($Lang -eq "es") {
    $msg_close    = "Photoshop está abierto: ciérralo primero."
    $msg_complete = "Instalación completada."
    $msg_open     = "Abre Photoshop y en el menú superior haz clic en lo siguiente: [Ventana] > [Extensiones] > [TypeR]"
    $msg_pause    = "Presiona Enter para continuar..."
    $msg_credits  = "TypeR desarrollado por Sakushi & SeanR."
    $msg_typertools = "typertools, desarrollado por Swirt: https://swirt.github.io/typertools/"
    $msg_discord  = "Discord de ScanR si necesitas ayuda: https://discord.com/invite/Pdmfmqk"
    $msg_title = "Instalador de TypeR"
    $msg_ps_found = "Photoshop detectado:"
    $msg_ps_none = "No se encontró Photoshop en este ordenador."
    $msg_uxp_name = "Nuevo TypeR (UXP)"
    $msg_uxp_desc = "Más rápido, basado en el framework de plugins más reciente de Adobe."
    $msg_uxp_req = "Photoshop 2025 (versión 26.0) o posterior"
    $msg_uxp_too_old = "Tu Photoshop es demasiado antiguo para esta versión."
    $msg_legacy_name = "Legacy (CEP)"
    $msg_legacy_desc = "Más antigua y lenta."
    $msg_legacy_req = "Photoshop CC 2015 (versión 16.0) o posterior"
    $msg_recommended = "(recomendado)"
    $msg_keys = "↑/↓ elegir  ·  Enter instalar  ·  Q salir"
    $msg_cancelled = "Instalación cancelada."
    $msg_choice_prompt = "Tu elección [1/2] (Enter = {0})"
    $msg_choose   = "¿Qué versión de TypeR quieres instalar?"
    $msg_both     = "La otra versión de TypeR también está instalada: no abras ambos paneles a la vez (cada atajo se ejecutaría dos veces)."
    $msg_uxp_download = "Descargando el nuevo TypeR (UXP)..."
    $msg_uxp_installing = "Instalando el nuevo TypeR (UXP)..."
    $msg_uxp_complete = "TypeR está instalado: en Photoshop, ábrelo desde el menú [Plugins] > [TypeR]. Si TypeR ya estaba instalado, reinicia Photoshop."
    $msg_uxp_complete_manual = "TypeR está instalado: reinicia Photoshop si está abierto y abre TypeR desde el menú [Plugins] > [TypeR]."
    $msg_uxp_failed = "La instalación falló. Cierra Photoshop y vuelve a ejecutar este script."
}
elseif ($Lang -eq "pt") {
    $msg_close    = "O Photoshop está aberto: feche-o primeiro."
    $msg_complete = "Instalação concluída."
    $msg_open     = "Abra o Photoshop e no menu superior clique em: [Janela] > [Extensões] > [TypeR]"
    $msg_pause    = "Pressione Enter para continuar..."
    $msg_credits  = "TypeR desenvolvido por Sakushi & SeanR."
    $msg_typertools = "typertools, desenvolvido por Swirt: https://swirt.github.io/typertools/"
    $msg_discord  = "Discord do ScanR se precisar de ajuda: https://discord.com/invite/Pdmfmqk"
    $msg_title = "Instalador do TypeR"
    $msg_ps_found = "Photoshop detectado:"
    $msg_ps_none = "O Photoshop não foi encontrado neste computador."
    $msg_uxp_name = "Novo TypeR (UXP)"
    $msg_uxp_desc = "Mais rápido, baseado no framework de plugins mais recente da Adobe."
    $msg_uxp_req = "Photoshop 2025 (versão 26.0) ou mais recente"
    $msg_uxp_too_old = "O seu Photoshop é antigo demais para esta versão."
    $msg_legacy_name = "Legacy (CEP)"
    $msg_legacy_desc = "Mais antiga e lenta."
    $msg_legacy_req = "Photoshop CC 2015 (versão 16.0) ou mais recente"
    $msg_recommended = "(recomendado)"
    $msg_keys = "↑/↓ escolher  ·  Enter instalar  ·  Q sair"
    $msg_cancelled = "Instalação cancelada."
    $msg_choice_prompt = "Sua escolha [1/2] (Enter = {0})"
    $msg_choose   = "Qual versão do TypeR você quer instalar?"
    $msg_both     = "A outra versão do TypeR também está instalada: não abra os dois painéis ao mesmo tempo (cada atalho seria executado duas vezes)."
    $msg_uxp_download = "Baixando o novo TypeR (UXP)..."
    $msg_uxp_installing = "Instalando o novo TypeR (UXP)..."
    $msg_uxp_complete = "O TypeR está instalado: no Photoshop, abra-o pelo menu [Plug-ins] > [TypeR]. Se o TypeR já estava instalado, reinicie o Photoshop."
    $msg_uxp_complete_manual = "O TypeR está instalado: reinicie o Photoshop se estiver aberto e abra o TypeR pelo menu [Plug-ins] > [TypeR]."
    $msg_uxp_failed = "A instalação falhou. Feche o Photoshop e execute este script novamente."
}

# Whether the console can draw: colors and the arrow menu need a real one
$Fancy = $Interactive
try {
    if ([Console]::IsOutputRedirected) { $Fancy = $false }
} catch { $Fancy = $false }

function Write-TypeRHeader {
    $Title = $msg_title + $(if ($ExtVersion -ne 'Inconnue') { "  $ExtVersion" } else { '' })
    $Line = '─' * ($Title.Length + 4)
    Write-Host ""
    Write-Host "  ┌$Line┐" -ForegroundColor Cyan
    Write-Host "  │  " -ForegroundColor Cyan -NoNewline
    Write-Host $Title -ForegroundColor White -NoNewline
    Write-Host "  │" -ForegroundColor Cyan
    Write-Host "  └$Line┘" -ForegroundColor Cyan
    Write-Host ""
}

function Write-TypeRCredits {
    Write-Host ""
    Write-Host "  $msg_credits" -ForegroundColor DarkGray
    Write-Host "  $msg_typertools" -ForegroundColor DarkGray
    Write-Host "  $msg_discord" -ForegroundColor DarkGray
    Write-Host ""
}

# Every failure ends on what to do and where to ask for help, and the console
# stays open when it was opened by a double-click
trap {
    Write-Host ""
    Write-Host "  $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "  $msg_uxp_failed" -ForegroundColor Red
    Write-Host "  $msg_discord"
    if ($Interactive) { Read-Host -Prompt $msg_pause }
    exit 1
}

# Photoshop installations, as name and version. $env:TYPER_PHOTOSHOP_VERSIONS
# ("name=version;...") replaces the search in tests.
function Get-TypeRPhotoshops {
    $Found = @()
    if ($null -ne $env:TYPER_PHOTOSHOP_VERSIONS) {
        foreach ($Item in ($env:TYPER_PHOTOSHOP_VERSIONS -split ';')) {
            if ($Item) {
                $Parts = $Item -split '=', 2
                $Found += [PSCustomObject]@{ Name = $Parts[0]; Version = $Parts[1] }
            }
        }
        return $Found
    }
    if ($env:OS -ne 'Windows_NT') { return $Found }
    $Candidates = @()
    foreach ($Key in 'HKLM:\SOFTWARE\Adobe\Photoshop', 'HKLM:\SOFTWARE\WOW6432Node\Adobe\Photoshop') {
        foreach ($Child in @(Get-ChildItem -Path $Key -ErrorAction SilentlyContinue)) {
            $Folder = (Get-ItemProperty -Path $Child.PSPath -ErrorAction SilentlyContinue).ApplicationPath
            # Not Join-Path: it fails on a drive that no longer exists, which an old
            # installation can leave in the registry
            if ($Folder) { $Candidates += ([string]$Folder).TrimEnd('\') + '\Photoshop.exe' }
        }
    }
    $AppPath = Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\Photoshop.exe' -ErrorAction SilentlyContinue
    if ($AppPath -and $AppPath.'(default)') { $Candidates += $AppPath.'(default)'.Trim('"') }
    # Installations that left nothing in the registry, on any drive
    foreach ($Drive in @(Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue)) {
        foreach ($Folder in 'Program Files', 'Program Files (x86)') {
            $Pattern = Join-Path $Drive.Root "$Folder\Adobe\Adobe Photoshop*\Photoshop.exe"
            $Candidates += @(Get-Item -Path $Pattern -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
        }
    }
    foreach ($Candidate in @($Candidates | Sort-Object -Unique)) {
        if (-not (Test-Path -LiteralPath $Candidate -PathType Leaf)) { continue }
        $Info = (Get-Item -LiteralPath $Candidate).VersionInfo
        $Version = if ([string]$Info.ProductVersion -match '^\d+(\.\d+)*') { $Matches[0] } elseif ($Info.ProductMajorPart) { [string]$Info.ProductMajorPart } else { '' }
        $Name = (Split-Path -Leaf (Split-Path -Parent $Candidate)) -replace '^Adobe ', ''
        $Found += [PSCustomObject]@{ Name = $Name; Version = $Version }
    }
    return $Found
}

# The newest Photoshop decides: UXP needs version 26, Legacy works with the
# older ones. No Photoshop found (or no version read): no recommendation.
$Recommended = ''
$PhotoshopList = ''
function Update-TypeRRecommendation {
    $Names = @()
    $Newest = 0
    # The search never stops an installation: at worst, no recommendation
    $Photoshops = @()
    try { $Photoshops = @(Get-TypeRPhotoshops) } catch { Write-Verbose $_.Exception.Message }
    foreach ($Photoshop in $Photoshops) {
        $Names += $(if ($Photoshop.Version) { "$($Photoshop.Name) ($($Photoshop.Version))" } else { $Photoshop.Name })
        if ([string]$Photoshop.Version -match '^(\d+)') {
            if ([int]$Matches[1] -gt $Newest) { $Newest = [int]$Matches[1] }
        }
    }
    $script:PhotoshopList = $Names -join ', '
    $script:Recommended = if ($Newest -ge 26) { 'uxp' } elseif ($Newest -gt 0) { 'legacy' } else { '' }
}

function Write-TypeROption([bool]$Selected, [string]$Name, [bool]$IsRecommended, [string]$Description, [string]$Requirement, [string]$Warning) {
    if ($Selected) {
        Write-Host "  > " -ForegroundColor Cyan -NoNewline
        Write-Host $Name -ForegroundColor Cyan -NoNewline
    } else {
        Write-Host "    $Name" -NoNewline
    }
    if ($IsRecommended) { Write-Host "  $msg_recommended" -ForegroundColor Green -NoNewline }
    Write-Host ""
    Write-Host "      $Description" -ForegroundColor DarkGray
    Write-Host "      $Requirement" -ForegroundColor DarkGray
    if ($Warning) { Write-Host "      $Warning" -ForegroundColor Yellow }
    Write-Host ""
}

function Write-TypeRMenu([string]$Cursor) {
    $UxpWarning = if ($Recommended -eq 'legacy') { $msg_uxp_too_old } else { '' }
    Write-TypeROption ($Cursor -eq 'uxp') $msg_uxp_name ($Recommended -eq 'uxp') $msg_uxp_desc $msg_uxp_req $UxpWarning
    Write-TypeROption ($Cursor -eq 'legacy') $msg_legacy_name ($Recommended -eq 'legacy') $msg_legacy_desc $msg_legacy_req ''
    Write-Host "  $msg_keys" -ForegroundColor DarkGray
}

# Any arrow moves between the two versions, 1 and 2 pick one directly. Returns
# the version, or $null when cancelled.
function Read-TypeREditionFromMenu {
    $Cursor = if ($Recommended) { $Recommended } else { 'uxp' }
    Clear-Host
    Write-TypeRHeader
    if ($PhotoshopList) {
        Write-Host "  $msg_ps_found " -NoNewline
        Write-Host $PhotoshopList -ForegroundColor White
    } else {
        Write-Host "  $msg_ps_none" -ForegroundColor Yellow
    }
    Write-Host ""
    Write-Host "  $msg_choose"
    Write-Host ""
    [Console]::CursorVisible = $false
    # Ctrl+C is read like the other keys, so that it cancels like Q
    [Console]::TreatControlCAsInput = $true
    try {
        Write-TypeRMenu $Cursor
        # The console may have scrolled: the height of the menu locates its top
        $Height = if ($Recommended -eq 'legacy') { 10 } else { 9 }
        $Top = [Math]::Max(0, [Console]::CursorTop - $Height)
        while ($true) {
            $Key = [Console]::ReadKey($true)
            $Previous = $Cursor
            if (@('UpArrow', 'DownArrow', 'LeftArrow', 'RightArrow') -contains [string]$Key.Key) {
                $Cursor = if ($Cursor -eq 'uxp') { 'legacy' } else { 'uxp' }
            } elseif ($Key.KeyChar -eq '1') {
                $Cursor = 'uxp'
            } elseif ($Key.KeyChar -eq '2') {
                $Cursor = 'legacy'
            } elseif ([string]$Key.Key -eq 'Enter') {
                return $Cursor
            } elseif ([string]$Key.Key -eq 'Q' -or [string]$Key.Key -eq 'Escape' -or ([string]$Key.Key -eq 'C' -and ($Key.Modifiers -band [ConsoleModifiers]::Control))) {
                return $null
            }
            if ($Cursor -ne $Previous) {
                [Console]::SetCursorPosition(0, $Top)
                Write-TypeRMenu $Cursor
            }
        }
    } finally {
        [Console]::TreatControlCAsInput = $false
        [Console]::CursorVisible = $true
    }
}

# Without a console that can draw: the same choice as a question
function Read-TypeREditionFromPrompt {
    $Default = if ($Recommended -eq 'legacy') { '2' } else { '1' }
    $UxpTag = if ($Recommended -eq 'uxp') { " $msg_recommended" } else { '' }
    $LegacyTag = if ($Recommended -eq 'legacy') { " $msg_recommended" } else { '' }
    Write-Host $msg_choose
    Write-Host ""
    Write-Host "  1) $msg_uxp_name$UxpTag"
    Write-Host "     $msg_uxp_req"
    Write-Host "  2) $msg_legacy_name$LegacyTag"
    Write-Host "     $msg_legacy_req"
    Write-Host ""
    while ($true) {
        $Choice = (Read-Host -Prompt ($msg_choice_prompt -f $Default)).Trim()
        if (-not $Choice) { $Choice = $Default }
        if ($Choice -eq '1') { return 'uxp' }
        if ($Choice -eq '2') { return 'legacy' }
    }
}

# --- 4. Choix de la version : UXP ou Legacy (CEP) ---
if ($env:TYPER_INSTALL_PROBE -eq 'recommendation') {
    Update-TypeRRecommendation
    Write-Output "recommended=$Recommended"
    Write-Output "photoshops=$PhotoshopList"
    return
}
$Edition = if ($Uxp) { 'uxp' } elseif ($Legacy) { 'legacy' } else { $null }
if (-not $Edition) {
    $Edition = 'legacy'
    if ($Interactive) {
        Update-TypeRRecommendation
        if ($Fancy) {
            $Edition = Read-TypeREditionFromMenu
            if (-not $Edition) {
                Write-Host ""
                Write-Host "  $msg_cancelled"
                Write-Host ""
                exit 130
            }
        } else {
            $Edition = Read-TypeREditionFromPrompt
        }
    }
}
if ($env:TYPER_INSTALL_PROBE -eq 'choice') {
    Write-Output "edition=$Edition"
    return
}
if ($Fancy) {
    Clear-Host
    Write-TypeRHeader
}
$CepTarget = if ($env:TYPER_INSTALL_TARGET) { $env:TYPER_INSTALL_TARGET } else { Join-Path $env:APPDATA 'Adobe\CEP\extensions\typertools' }
$UxpRoot = if ($env:TYPER_UXP_ROOT) { $env:TYPER_UXP_ROOT } else { Join-Path $env:APPDATA 'Adobe\UXP' }
$UxpPlugins = Join-Path $UxpRoot 'Plugins\External'
$UxpRegistry = Join-Path $UxpRoot 'PluginsInfo\v1\PS.json'

# PS.json with the plugin added, other plugins kept; an unreadable PS.json is
# an error. Written by hand: ConvertTo-Json of Windows PowerShell 5.1 can turn
# an array property into {"value":[...],"Count":n}.
function Get-TypeRRegistryJson($Manifest, [string]$Folder, [string]$RegistryPath) {
    $Text = if (Test-Path -LiteralPath $RegistryPath -PathType Leaf) { [IO.File]::ReadAllText($RegistryPath) } else { '' }
    $Registry = if ($Text.Trim()) { $Text | ConvertFrom-Json } else { $null }
    if ($Text.Trim() -and ($null -eq $Registry -or $Registry -isnot [PSCustomObject])) { throw 'Invalid PS.json' }
    $Members = @()
    $Plugins = @()
    if ($Registry) {
        foreach ($Property in $Registry.PSObject.Properties) {
            if ($Property.Name -eq 'plugins') {
                if ($null -ne $Property.Value -and $Property.Value -isnot [array]) { throw 'Invalid PS.json' }
                foreach ($Plugin in @($Property.Value)) {
                    if ($null -ne $Plugin -and $Plugin.pluginId -ne $Manifest.id) { $Plugins += (ConvertTo-Json $Plugin -Depth 20 -Compress) }
                }
            } else {
                $Members += ((ConvertTo-Json ([string]$Property.Name) -Compress) + ':' + (ConvertTo-Json $Property.Value -Depth 20 -Compress))
            }
        }
    }
    $Entry = [ordered]@{
        hostMinVersion = [string]$Manifest.host.minVersion
        name = [string]$Manifest.name
        path = '$localPlugins/External/' + $Folder
        pluginId = [string]$Manifest.id
        status = 'enabled'
        type = 'uxp'
        versionString = [string]$Manifest.version
    }
    $Plugins += (ConvertTo-Json ([PSCustomObject]$Entry) -Compress)
    $Members += ('"plugins":[' + ($Plugins -join ',') + ']')
    return '{' + ($Members -join ',') + '}'
}

# Without Creative Cloud's plugin installer, or when it fails: the package is
# extracted where it would have put it and registered in PS.json, which
# Photoshop reads at its start
function Install-TypeRPluginManually([string]$PackagePath) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $Archive = [IO.Compression.ZipFile]::OpenRead($PackagePath)
    try {
        $Entry = $Archive.GetEntry('manifest.json')
        if (-not $Entry) { throw 'Not a TypeR package' }
        $Reader = New-Object IO.StreamReader($Entry.Open(), [Text.Encoding]::UTF8)
        try { $Manifest = $Reader.ReadToEnd() | ConvertFrom-Json } finally { $Reader.Dispose() }
    } finally {
        $Archive.Dispose()
    }
    if ($Manifest.id -ne 'com.scanr.typer' -or [string]$Manifest.version -notmatch '^[0-9A-Za-z][0-9A-Za-z.+-]*$') { throw 'Not a TypeR package' }
    $Folder = $Manifest.id + '_' + $Manifest.version
    $RegistryJson = Get-TypeRRegistryJson $Manifest $Folder $UxpRegistry
    $Target = Join-Path $UxpPlugins $Folder
    $Staging = $Target + '.installing'
    if (Test-Path -LiteralPath $Staging) { Remove-Item -LiteralPath $Staging -Recurse -Force }
    New-Item -ItemType Directory -Path $UxpPlugins -Force | Out-Null
    try {
        [IO.Compression.ZipFile]::ExtractToDirectory($PackagePath, $Staging)
        if (Test-Path -LiteralPath $Target) { Remove-Item -LiteralPath $Target -Recurse -Force }
        Move-Item -LiteralPath $Staging -Destination $Target
    } finally {
        if (Test-Path -LiteralPath $Staging) { Remove-Item -LiteralPath $Staging -Recurse -Force -ErrorAction SilentlyContinue }
    }
    New-Item -ItemType Directory -Path (Split-Path -Parent $UxpRegistry) -Force | Out-Null
    # Without a byte order mark, and renamed over the old file so that it is
    # never left half written
    $Temporary = $UxpRegistry + '.tmp'
    [IO.File]::WriteAllText($Temporary, $RegistryJson, (New-Object Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $Temporary -Destination $UxpRegistry -Force
}

# A Legacy panel still installed is called "TypeR (old)" in Photoshop from its
# next start (app_src/legacyPanelName.js). Never fails the installation.
function Rename-TypeRLegacyPanel {
    $File = Join-Path $CepTarget 'CSXS\manifest.xml'
    if (-not (Test-Path -LiteralPath $File -PathType Leaf)) { return }
    try {
        $Text = [IO.File]::ReadAllText($File)
        $Next = $Text.Replace('<Menu>TypeR</Menu>', '<Menu>TypeR (old)</Menu>')
        if ($Next -cne $Text) {
            $Temporary = $File + '.tmp'
            [IO.File]::WriteAllText($Temporary, $Next, (New-Object Text.UTF8Encoding($false)))
            Move-Item -LiteralPath $Temporary -Destination $File -Force
        }
    } catch {
        Write-Warning $_.Exception.Message
    }
}

# --- 5. Version UXP : le paquet .ccx (à côté de ce script, sinon la dernière
# version publiée), installé par l'installeur de plugins de Creative Cloud,
# ou à la main sans lui ---
if ($Edition -eq 'uxp') {
    $CommonFiles = if ($env:CommonProgramW6432) { $env:CommonProgramW6432 } else { $env:CommonProgramFiles }
    $Upia = if ($env:TYPER_INSTALL_UPIA) { $env:TYPER_INSTALL_UPIA } elseif ($CommonFiles) { Join-Path $CommonFiles 'Adobe\Adobe Desktop Common\RemoteComponents\UPI\UnifiedPluginInstallerAgent\UnifiedPluginInstallerAgent.exe' } else { $null }
    $CreativeCloud = if ($env:TYPER_INSTALL_UPIA) { $Upia } elseif ($env:ProgramFiles) { Join-Path $env:ProgramFiles 'Adobe\Adobe Creative Cloud\ACC\Creative Cloud.exe' } else { $null }
    $Source = if ($Package) { [IO.Path]::GetFullPath($Package) } else { Join-Path $PSScriptRoot 'TypeR-UXP.ccx' }
    $Work = Join-Path ([IO.Path]::GetTempPath()) ('TypeR-UXP-' + [Guid]::NewGuid().ToString('N') + '.ccx')
    $CompleteMessage = $null
    try {
        if (Test-Path -LiteralPath $Source -PathType Leaf) {
            Copy-Item -LiteralPath $Source -Destination $Work
        } else {
            Write-Host "  $msg_uxp_download"
            [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
            $ProgressPreference = 'SilentlyContinue'
            Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/ScanR/TypeR/releases/latest/download/TypeR-UXP.ccx' -OutFile $Work
        }
        Write-Host "  $msg_uxp_installing"
        # Creative Cloud's plugin installer can fail or hang without a working
        # Creative Cloud session: after a limit, the package is installed by hand.
        # The installer's exit code does not tell: a failure can still exit with 0
        if ($Upia -and $env:TYPER_INSTALL_NO_UPIA -ne '1' -and (Test-Path -LiteralPath $Upia -PathType Leaf) -and $CreativeCloud -and (Test-Path -LiteralPath $CreativeCloud -PathType Leaf)) {
            $Limit = if ($env:TYPER_INSTALL_UPIA_TIMEOUT) { [int]$env:TYPER_INSTALL_UPIA_TIMEOUT } else { 60 }
            try {
                $Start = New-Object Diagnostics.ProcessStartInfo
                $Start.FileName = $Upia
                $Start.Arguments = '--install "' + $Work + '"'
                $Start.UseShellExecute = $false
                $Start.CreateNoWindow = $true
                $Start.RedirectStandardOutput = $true
                $Start.RedirectStandardError = $true
                $Process = [Diagnostics.Process]::Start($Start)
                $Output = $Process.StandardOutput.ReadToEndAsync()
                $Errors = $Process.StandardError.ReadToEndAsync()
                if ($Process.WaitForExit($Limit * 1000)) {
                    $Process.WaitForExit()
                    if ($Process.ExitCode -eq 0 -and ($Output.Result + $Errors.Result) -notmatch 'fail') { $CompleteMessage = $msg_uxp_complete }
                } else {
                    $Process.Kill()
                }
            } catch {
                # Whatever happened to the installer, the installation by hand comes next
            }
        }
        if (-not $CompleteMessage) {
            Install-TypeRPluginManually $Work
            $CompleteMessage = $msg_uxp_complete_manual
        }
    } catch {
        Write-Host "  $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "  $msg_uxp_failed" -ForegroundColor Red
        Write-Host "  $msg_discord"
    } finally {
        Remove-Item -LiteralPath $Work -Force -ErrorAction SilentlyContinue
    }
    Write-Host ""
    if ($CompleteMessage) {
        Rename-TypeRLegacyPanel
        Write-Host "  √ $CompleteMessage" -ForegroundColor Green
        if (Test-Path -LiteralPath (Join-Path $CepTarget 'CSXS')) { Write-Host "  $msg_both" -ForegroundColor Yellow }
        Write-TypeRCredits
    }
    if ($Interactive) { Read-Host -Prompt $msg_pause }
    if ($CompleteMessage) { exit 0 } else { exit 1 }
}

# --- 6. Version Legacy (CEP) ---
if (-not (Test-Path $ManifestPath)) {
    Write-Host "[ERREUR] Fichier introuvable : $ManifestPath" -ForegroundColor Red
    Write-Host "Placez ce script à côté des dossiers 'CSXS', 'app', 'icons', 'locale', 'themes'."
    if ($Interactive) { Read-Host "Appuyez sur Entrée pour quitter..." }
    exit 1
}
if ($Interactive -and (Get-Process -Name Photoshop -ErrorAction SilentlyContinue)) {
    Write-Host "  $msg_close" -ForegroundColor Yellow
    Read-Host -Prompt "  $msg_pause"
}

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
$TargetDir = $CepTarget
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
Write-Host "  √ $msg_complete" -ForegroundColor Green
Write-Host "  $msg_open" -ForegroundColor Cyan
if (Get-ChildItem -LiteralPath $UxpPlugins -Filter 'com.scanr.typer_*' -Directory -ErrorAction SilentlyContinue) { Write-Host "  $msg_both" -ForegroundColor Yellow }
Write-TypeRCredits
if ($Interactive) { Read-Host -Prompt $msg_pause }
