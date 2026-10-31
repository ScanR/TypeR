# install.ps1 [-Uxp | -Legacy] [-Silent] [TypeR-UXP.ccx]
# Without -Uxp or -Legacy an interactive console asks which version to install;
# a scripted installation (updates, tests) installs the Legacy version.
param([switch]$Silent, [switch]$Uxp, [switch]$Legacy, [Parameter(Position = 0)][string]$Package, [string[]]$PhotoshopPath)
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
# $PSScriptRoot est une variable native fiable, contrairement à %~dp0 ;
# l'archive est le parent du dossier installer
$ScriptDir = if ($env:TYPER_INSTALL_SOURCE) { [IO.Path]::GetFullPath($env:TYPER_INSTALL_SOURCE).TrimEnd("\") } else { Split-Path -Parent $PSScriptRoot }
Set-Location -LiteralPath $ScriptDir

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
$msg_status_update = "Installed version: {old}, updates to {new}"
$msg_status_current = "Installed version: {new}, up to date"
$msg_status_newer = "Installed version: {old}, newer than this archive ({new})"
$msg_choose_update = "Which version of TypeR do you want to update or install?"
$msg_updated = "TypeR was updated: {old} → {new}"
$msg_uxp_failed = "Installation failed. See the error above; no success was confirmed."

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
    $msg_status_update = "Version installée : {old}, mise à jour vers {new}"
    $msg_status_current = "Version installée : {new}, à jour"
    $msg_status_newer = "Version installée : {old}, plus récente que cette archive ({new})"
    $msg_choose_update = "Quelle version de TypeR voulez-vous mettre à jour ou installer ?"
    $msg_updated = "TypeR a été mis à jour : {old} → {new}"
    $msg_uxp_failed = "L'installation a échoué. Consultez l'erreur ci-dessus ; aucun succès n'a été confirmé."
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
    $msg_status_update = "Versión instalada: {old}, se actualiza a {new}"
    $msg_status_current = "Versión instalada: {new}, al día"
    $msg_status_newer = "Versión instalada: {old}, más reciente que este archivo ({new})"
    $msg_choose_update = "¿Qué versión de TypeR quieres actualizar o instalar?"
    $msg_updated = "TypeR se ha actualizado: {old} → {new}"
    $msg_uxp_failed = "La instalación falló. Consulta el error anterior."
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
    $msg_status_update = "Versão instalada: {old}, atualiza para {new}"
    $msg_status_current = "Versão instalada: {new}, atualizada"
    $msg_status_newer = "Versão instalada: {old}, mais recente que este arquivo ({new})"
    $msg_choose_update = "Qual versão do TypeR você quer atualizar ou instalar?"
    $msg_updated = "O TypeR foi atualizado: {old} → {new}"
    $msg_uxp_failed = "A instalação falhou. Consulte o erro acima."
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
                $Found += [PSCustomObject]@{ Name = $Parts[0]; Version = $Parts[1]; Path = $null }
            }
        }
        return $Found
    }
    if ($env:OS -ne 'Windows_NT') { return $Found }
    $Candidates = @()
    foreach ($Folder in $PhotoshopPath) {
        $Executable = [IO.Path]::Combine([IO.Path]::GetFullPath($Folder), 'Photoshop.exe')
        if (-not (Test-Path -LiteralPath $Executable -PathType Leaf -ErrorAction SilentlyContinue)) { throw "Photoshop.exe not found: $Executable" }
        $Candidates += $Executable
    }
    foreach ($Photoshop in @($script:DetectedPhotoshops)) {
        if ($Photoshop.Path) { $Candidates += [IO.Path]::Combine($Photoshop.Path, 'Photoshop.exe') }
    }
    # Running applications and uninstall records also cover custom/portable paths.
    $Candidates += @(Get-Process -Name Photoshop -ErrorAction SilentlyContinue | ForEach-Object { if ($_.Path) { $_.Path } })
    foreach ($Key in 'HKLM:\SOFTWARE\Adobe\Photoshop', 'HKLM:\SOFTWARE\WOW6432Node\Adobe\Photoshop') {
        foreach ($Child in @(Get-ChildItem -Path $Key -ErrorAction SilentlyContinue)) {
            $Folder = (Get-ItemProperty -Path $Child.PSPath -ErrorAction SilentlyContinue).ApplicationPath
            # Develop's fix: build candidates without consulting the drive.
            # Missing installations are filtered below with Test-Path.
            if ($Folder) { $Candidates += ([string]$Folder).TrimEnd('\') + '\Photoshop.exe' }
        }
    }
    $AppPath = Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\Photoshop.exe' -ErrorAction SilentlyContinue
    if ($AppPath -and $AppPath.'(default)') { $Candidates += $AppPath.'(default)'.Trim('"') }
    foreach ($Key in 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*') {
        foreach ($App in @(Get-ItemProperty -Path $Key -ErrorAction SilentlyContinue)) {
            if ($App.DisplayName -like '*Photoshop*' -and $App.InstallLocation -and (Test-Path -LiteralPath $App.InstallLocation -PathType Container -ErrorAction SilentlyContinue)) {
                $Candidates += Join-Path $App.InstallLocation 'Photoshop.exe'
            }
        }
    }
    # Installations that left nothing in the registry, on any drive
    foreach ($Drive in @(Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue)) {
        foreach ($Folder in 'Program Files\Adobe', 'Program Files (x86)\Adobe', 'Adobe', '') {
            $Pattern = Join-Path $Drive.Root "$Folder\Adobe Photoshop*\Photoshop.exe"
            $Candidates += @(Get-Item -Path $Pattern -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
        }
    }
    foreach ($Candidate in @($Candidates | Sort-Object -Unique)) {
        if (-not (Test-Path -LiteralPath $Candidate -PathType Leaf -ErrorAction SilentlyContinue)) { continue }
        $Item = Get-Item -LiteralPath $Candidate -ErrorAction SilentlyContinue
        if (-not $Item) { continue }
        $Info = $Item.VersionInfo
        $Version = if ([string]$Info.ProductVersion -match '^\d+(\.\d+)*') { $Matches[0] } elseif ($Info.ProductMajorPart) { [string]$Info.ProductMajorPart } else { '' }
        $Name = (Split-Path -Leaf (Split-Path -Parent $Candidate)) -replace '^Adobe ', ''
        $Found += [PSCustomObject]@{ Name = $Name; Version = $Version; Path = $Item.DirectoryName }
    }
    $script:DetectedPhotoshops = $Found
    return $Found
}

# The newest Photoshop decides: UXP needs version 26, Legacy works with the
# older ones. No Photoshop found (or no version read): no recommendation.
$Recommended = ''
$PhotoshopList = ''
function Update-TypeRRecommendation {
    $Names = @()
    $Newest = 0
    # A detection error must not prevent opening the edition menu (develop).
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

function Write-TypeROption([bool]$Selected, [string]$Name, [bool]$IsRecommended, [string]$Description, [string]$Requirement, [string]$Warning, [string]$Status) {
    if ($Selected) {
        Write-Host "  > " -ForegroundColor Cyan -NoNewline
        Write-Host $Name -ForegroundColor Cyan -NoNewline
    } else {
        Write-Host "    $Name" -NoNewline
    }
    if ($IsRecommended) { Write-Host "  $msg_recommended" -ForegroundColor Green -NoNewline }
    Write-Host ""
    if ($Status) { Write-Host "      $Status" -ForegroundColor Green }
    Write-Host "      $Description" -ForegroundColor DarkGray
    Write-Host "      $Requirement" -ForegroundColor DarkGray
    if ($Warning) { Write-Host "      $Warning" -ForegroundColor Yellow }
    Write-Host ""
}

function Write-TypeRMenu([string]$Cursor) {
    $UxpWarning = if ($Recommended -eq 'legacy') { $msg_uxp_too_old } else { '' }
    Write-TypeROption ($Cursor -eq 'uxp') $msg_uxp_name ($Recommended -eq 'uxp') $msg_uxp_desc $msg_uxp_req $UxpWarning $PluginStatus
    Write-TypeROption ($Cursor -eq 'legacy') $msg_legacy_name ($Recommended -eq 'legacy') $msg_legacy_desc $msg_legacy_req '' $LegacyStatus
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
    Write-Host "  $ChooseMessage"
    Write-Host ""
    [Console]::CursorVisible = $false
    # Ctrl+C is read like the other keys, so that it cancels like Q
    [Console]::TreatControlCAsInput = $true
    try {
        Write-TypeRMenu $Cursor
        # The console may have scrolled: the height of the menu locates its top
        $Height = 9
        if ($Recommended -eq 'legacy') { $Height++ }
        if ($PluginStatus) { $Height++ }
        if ($LegacyStatus) { $Height++ }
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
    Write-Host $ChooseMessage
    Write-Host ""
    Write-Host "  1) $msg_uxp_name$UxpTag"
    if ($PluginStatus) { Write-Host "     $PluginStatus" }
    Write-Host "     $msg_uxp_req"
    Write-Host "  2) $msg_legacy_name$LegacyTag"
    if ($LegacyStatus) { Write-Host "     $LegacyStatus" }
    Write-Host "     $msg_legacy_req"
    Write-Host ""
    while ($true) {
        $Choice = (Read-Host -Prompt ($msg_choice_prompt -f $Default)).Trim()
        if (-not $Choice) { $Choice = $Default }
        if ($Choice -eq '1') { return 'uxp' }
        if ($Choice -eq '2') { return 'legacy' }
    }
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
        path = '$localPlugins\External\' + $Folder
        pluginId = [string]$Manifest.id
        status = 'enabled'
        type = 'uxp'
        versionString = [string]$Manifest.version
    }
    $Plugins += (ConvertTo-Json ([PSCustomObject]$Entry) -Compress)
    $Members += ('"plugins":[' + ($Plugins -join ',') + ']')
    return '{' + ($Members -join ',') + '}'
}

# Use .NET directly, also in Windows PowerShell 5.1 with a mixed PSModulePath.
function Get-TypeRFileHash([string]$FilePath) {
    $Stream = [IO.File]::OpenRead($FilePath)
    $Algorithm = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($Algorithm.ComputeHash($Stream)).Replace('-', '').ToLowerInvariant() }
    finally { $Algorithm.Dispose(); $Stream.Dispose() }
}

function Assert-TypeRPhotoshopClosed {
    while (Get-Process -Name Photoshop -ErrorAction SilentlyContinue) {
        if (-not $Interactive) { throw $msg_close }
        Write-Host "  $msg_close" -ForegroundColor Yellow
        Read-Host -Prompt $msg_pause | Out-Null
    }
}

function ConvertTo-TypeRVersion([string]$Value) {
    if ($Value -notmatch '^\d+(\.\d+){0,3}$') { throw "Invalid Photoshop version: $Value" }
    $Parts = @($Value -split '\.')
    while ($Parts.Count -lt 4) { $Parts += '0' }
    return [version]($Parts -join '.')
}

# Refuse junctions, drive roots and our source directory before any mutation.
function Assert-TypeRSafePath([string]$Path) {
    $Full = [IO.Path]::GetFullPath($Path).TrimEnd('\')
    if ($Full -eq [IO.Path]::GetPathRoot($Full).TrimEnd('\') -or $Full -eq $ScriptDir) { throw "Unsafe installation path: $Full" }
    $Ancestor = $Full
    while ($Ancestor) {
        if (Test-Path -LiteralPath $Ancestor) {
            if ((Get-Item -LiteralPath $Ancestor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Installation path contains a link: $Ancestor" }
        }
        $Ancestor = Split-Path -Parent $Ancestor
    }
    return $Full
}

function Remove-TypeRDirectory([string]$Path, [string]$Parent) {
    $Full = Assert-TypeRSafePath $Path
    $Allowed = [IO.Path]::GetFullPath($Parent).TrimEnd('\') + '\'
    if (-not $Full.StartsWith($Allowed, [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe removal: $Full" }
    if (Test-Path -LiteralPath $Full) { Remove-Item -LiteralPath $Full -Recurse -Force }
}

function Write-TypeRAtomicBytes([string]$Path, [byte[]]$Bytes) {
    $null = Assert-TypeRSafePath $Path
    $Temporary = $Path + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
    try {
        $Stream = [IO.File]::Open($Temporary, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try { $Stream.Write($Bytes, 0, $Bytes.Length); $Stream.Flush($true) } finally { $Stream.Dispose() }
        if (Test-Path -LiteralPath $Path) { [IO.File]::Replace($Temporary, $Path, [NullString]::Value) }
        else { [IO.File]::Move($Temporary, $Path) }
    } finally {
        if (Test-Path -LiteralPath $Temporary) { Remove-Item -LiteralPath $Temporary -Force }
    }
}

function Save-TypeRTransaction($Transaction, [string]$Journal) {
    $Bytes = (New-Object Text.UTF8Encoding($false)).GetBytes((ConvertTo-Json $Transaction -Depth 20))
    Write-TypeRAtomicBytes $Journal $Bytes
}

function Get-TypeRWorkspace([string]$Target, [string]$Id) {
    if ($Target.StartsWith($UxpPlugins.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
        return Join-Path $UxpRoot ('.typer-install-' + $Id)
    }
    $Ancestor = Split-Path -Parent $Target
    while ($Ancestor) {
        if ((Split-Path -Leaf $Ancestor) -eq 'Plug-ins') {
            return Join-Path (Split-Path -Parent $Ancestor) ('.typer-install-' + $Id)
        }
        $Ancestor = Split-Path -Parent $Ancestor
    }
    throw "Unsupported plugin location: $Target"
}

# Only the matching manifest ID identifies a TypeR installation; its folder
# name is not sufficient. Do not recurse through directory links.
function Get-TypeRPluginDirectories([string]$Root, [int]$Depth = 0) {
    if (-not (Test-Path -LiteralPath $Root -PathType Container -ErrorAction SilentlyContinue)) { return }
    $null = Assert-TypeRSafePath $Root
    foreach ($Directory in @(Get-ChildItem -LiteralPath $Root -Directory -Force)) {
        if ($Directory.Name -like '*.installing') { continue }
        if ($Directory.Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
        $File = Join-Path $Directory.FullName 'manifest.json'
        if (Test-Path -LiteralPath $File -PathType Leaf) {
            $null = Assert-TypeRSafePath $File
            try { $Manifest = [IO.File]::ReadAllText($File) | ConvertFrom-Json }
            catch { throw "Cannot read plugin manifest: $File. $($_.Exception.Message)" }
            if ($Manifest.id -eq 'com.scanr.typer') { $Directory.FullName }
        } elseif ($Depth -gt 0) {
            Get-TypeRPluginDirectories $Directory.FullName ($Depth - 1)
        }
    }
}

# Shared by the updater probe and tests; identify copies by manifest, including
# custom Photoshop Plug-ins folders, not just versioned external folder names.
function Get-TypeRInstalledPluginPaths {
    Get-TypeRPluginDirectories $UxpPlugins
    foreach ($Photoshop in @(Get-TypeRPhotoshops)) {
        if ($Photoshop.Path) { Get-TypeRPluginDirectories (Join-Path $Photoshop.Path 'Plug-ins') 2 }
    }
}

# Validate every ZIP path before extracting anything. Hashes are used again
# after staging and after the swap, even when version strings are identical.
function Expand-TypeRPackage([string]$PackagePath, [string]$Destination) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $Archive = [IO.Compression.ZipFile]::OpenRead($PackagePath)
    try {
        $Names = @{}
        $Total = [long]0
        foreach ($Entry in $Archive.Entries) {
            $Name = $Entry.FullName.Replace('\', '/')
            $Segments = $Name.TrimEnd('/') -split '/'
            if (-not $Name -or $Name.StartsWith('/') -or $Name -match '[:\x00-\x1f<>"|?*]' -or $Segments -contains '..' -or $Segments -contains '.' -or $Segments -contains '' -or $Names.ContainsKey($Name.TrimEnd('/'))) { throw "Unsafe or duplicate package path: $Name" }
            foreach ($Segment in $Segments) {
                if ($Segment -match '[. ]$|^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)') { throw "Unsafe package path: $Name" }
            }
            if ((($Entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000) { throw "Package contains a link: $Name" }
            $Names[$Name.TrimEnd('/')] = $true
            $Total += $Entry.Length
            if ($Total -gt 1GB -or $Archive.Entries.Count -gt 10000) { throw 'TypeR package is too large.' }
        }
        $ManifestEntry = $Archive.GetEntry('manifest.json')
        if (-not $ManifestEntry -or $ManifestEntry.Length -gt 1MB) { throw 'Not a TypeR package: missing or invalid manifest.json' }
        $Reader = New-Object IO.StreamReader($ManifestEntry.Open(), [Text.Encoding]::UTF8)
        try { $Manifest = $Reader.ReadToEnd() | ConvertFrom-Json } finally { $Reader.Dispose() }
        if ($Manifest.id -ne 'com.scanr.typer' -or [string]$Manifest.version -notmatch '^\d+\.\d+\.\d+([+-][0-9A-Za-z.-]+)?$' -or $Manifest.host.app -ne 'PS' -or [string]$Manifest.host.minVersion -notmatch '^\d+(\.\d+){0,3}$' -or -not $Manifest.main) { throw 'Invalid TypeR manifest.' }
        foreach ($Required in @('manifest.json', 'host.js', 'index.html', [string]$Manifest.main)) {
            $Entry = $Archive.GetEntry($Required)
            if (-not $Entry -or $Entry.Length -eq 0 -or $Required.EndsWith('/')) { throw "Incomplete TypeR package: $Required" }
        }
        $Inventory = @{}
        $null = New-Item -ItemType Directory -Path $Destination
        foreach ($Entry in $Archive.Entries) {
            $Name = $Entry.FullName.Replace('\', '/')
            $File = [IO.Path]::GetFullPath((Join-Path $Destination $Name))
            if (-not $File.StartsWith($Destination.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe package path: $Name" }
            if ($Name.EndsWith('/')) { $null = New-Item -ItemType Directory -Path $File -Force; continue }
            $null = New-Item -ItemType Directory -Path (Split-Path -Parent $File) -Force
            $InputStream = $Entry.Open()
            $OutputStream = [IO.File]::Open($File, [IO.FileMode]::CreateNew)
            $Hash = [Security.Cryptography.SHA256]::Create()
            try {
                $Buffer = New-Object byte[] 65536
                while (($Count = $InputStream.Read($Buffer, 0, $Buffer.Length)) -gt 0) {
                    $OutputStream.Write($Buffer, 0, $Count)
                    $null = $Hash.TransformBlock($Buffer, 0, $Count, $Buffer, 0)
                }
                $null = $Hash.TransformFinalBlock((New-Object byte[] 0), 0, 0)
                if ($OutputStream.Length -ne $Entry.Length) { throw "Incomplete package file: $Name" }
                $Inventory[$Name] = [BitConverter]::ToString($Hash.Hash).Replace('-', '').ToLowerInvariant()
            } finally { $Hash.Dispose(); $OutputStream.Dispose(); $InputStream.Dispose() }
        }
        return [PSCustomObject]@{ Manifest = $Manifest; Inventory = $Inventory; Root = $Destination }
    } finally { $Archive.Dispose() }
}

function Assert-TypeRInstalledFiles([string]$Root, $Inventory) {
    $null = Assert-TypeRSafePath $Root
    $Count = 0
    foreach ($Item in Get-ChildItem -LiteralPath $Root -Recurse -Force) {
        if ($Item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Installed plugin contains a link: $($Item.FullName)" }
        if ($Item.PSIsContainer) { continue }
        $Relative = $Item.FullName.Substring($Root.Length + 1).Replace('\', '/')
        if (-not $Inventory.ContainsKey($Relative) -or (Get-TypeRFileHash $Item.FullName) -ne $Inventory[$Relative]) { throw "Installed file verification failed: $($Item.FullName)" }
        $Count++
    }
    if ($Count -ne $Inventory.Count) { throw "Installed plugin is incomplete: $Root" }
}

function Restore-TypeRTransaction($Transaction, [string]$Journal) {
    # Validate the complete recovery plan before removing or moving anything.
    if ([string]$Transaction.Id -notmatch '^[a-f0-9]{32}$' -or $Transaction.RegistryPath -ne $UxpRegistry) { throw "Invalid recovery journal: $Journal" }
    foreach ($Operation in $Transaction.Operations) {
        $Target = Assert-TypeRSafePath $Operation.Target
        $Workspace = Assert-TypeRSafePath $Operation.Workspace
        $Expected = Get-TypeRWorkspace $Target $Transaction.Id
        if ($Workspace -ne $Expected -or $Operation.Backup -ne (Join-Path $Workspace ('backup-' + $Operation.Index)) -or $Operation.Stage -ne (Join-Path $Workspace ('stage-' + $Operation.Index))) { throw "Invalid recovery paths: $Journal" }
    }
    if ($Transaction.RegistryPending) {
        $Current = if (Test-Path -LiteralPath $UxpRegistry) { [Convert]::ToBase64String([IO.File]::ReadAllBytes($UxpRegistry)) } else { $null }
        if ($Current -ne $Transaction.RegistryBefore -and $Current -ne $Transaction.RegistryAfter) { throw "PS.json changed outside the installer. Recovery retained: $Journal" }
        if ($Current -ne $Transaction.RegistryBefore -or [bool](Test-Path -LiteralPath $UxpRegistry) -ne $Transaction.RegistryExisted) {
            if ($Transaction.RegistryExisted) { Write-TypeRAtomicBytes $UxpRegistry ([Convert]::FromBase64String($Transaction.RegistryBefore)) }
            elseif (Test-Path -LiteralPath $UxpRegistry) { Remove-Item -LiteralPath $UxpRegistry -Force }
        }
    }
    $Operations = @($Transaction.Operations)
    [array]::Reverse($Operations)
    foreach ($Operation in $Operations) {
        if (Test-Path -LiteralPath $Operation.Backup) {
            Remove-TypeRDirectory $Operation.Target (Split-Path -Parent $Operation.Target)
            [IO.Directory]::Move($Operation.Backup, $Operation.Target)
        } elseif (-not $Operation.HadTarget -and $Operation.Pending -and -not (Test-Path -LiteralPath $Operation.Stage)) {
            Remove-TypeRDirectory $Operation.Target (Split-Path -Parent $Operation.Target)
        }
    }
    # Remove the journal only after every original copy is restored.
    Remove-Item -LiteralPath $Journal -Force
    foreach ($Workspace in @($Operations.Workspace | Sort-Object -Unique)) {
        Remove-TypeRDirectory $Workspace (Split-Path -Parent $Workspace)
    }
}

function Install-TypeRPluginManually([string]$PackagePath) {
    Assert-TypeRPhotoshopClosed
    $Control = Assert-TypeRSafePath (Join-Path $UxpRoot '.typer-installer')
    $null = New-Item -ItemType Directory -Path $Control -Force
    $Lock = $null
    $Journal = Join-Path $Control 'pending.json'
    $Transaction = $null
    $Committed = $false
    $Extracted = Join-Path $Control ('package-' + [Guid]::NewGuid().ToString('N'))
    try {
        try { $Lock = [IO.File]::Open((Join-Path $Control 'install.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
        catch { throw 'Another TypeR installation is running. Wait for it to finish.' }
        if (Test-Path -LiteralPath $Journal) {
            $Previous = [IO.File]::ReadAllText($Journal) | ConvertFrom-Json
            if ([string]$Previous.Id -notmatch '^[a-f0-9]{32}$' -or $Previous.RegistryPath -ne $UxpRegistry) { throw "Invalid recovery journal: $Journal" }
            if ($Previous.State -eq 'committed') { Move-Item -LiteralPath $Journal -Destination (Join-Path $Control ($Previous.Id + '.json')) }
            else { Restore-TypeRTransaction $Previous $Journal }
        }
        $Payload = Expand-TypeRPackage $PackagePath $Extracted
        Assert-TypeRInstalledFiles $Extracted $Payload.Inventory
        $Photoshops = @(Get-TypeRPhotoshops)
        $Minimum = ConvertTo-TypeRVersion $Payload.Manifest.host.minVersion
        $Compatible = @($Photoshops | Where-Object { $_.Version -and (ConvertTo-TypeRVersion $_.Version) -ge $Minimum })
        if (-not $Compatible.Count) { throw "No compatible Photoshop found. TypeR requires Photoshop $Minimum or later." }
        $Direct = @()
        foreach ($Photoshop in $Compatible) {
            if ($Photoshop.Path) { $Direct += @(Get-TypeRPluginDirectories (Join-Path $Photoshop.Path 'Plug-ins') 2) }
        }
        $External = @(Get-TypeRPluginDirectories $UxpPlugins)
        # Read/validate PS.json even for a direct install, so a registered stale
        # copy cannot be silently overlooked.
        $Folder = $Payload.Manifest.id + '_' + $Payload.Manifest.version
        $RegistryJson = Get-TypeRRegistryJson $Payload.Manifest $Folder $UxpRegistry
        $Before = if (Test-Path -LiteralPath $UxpRegistry) { [Convert]::ToBase64String([IO.File]::ReadAllBytes($UxpRegistry)) } else { $null }
        $Registered = $false
        if ($Before) {
            $Registry = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Before)).TrimStart([char]0xfeff) | ConvertFrom-Json
            foreach ($Plugin in @($Registry.plugins)) {
                if ($Plugin.pluginId -eq $Payload.Manifest.id) {
                    $Registered = $true
                    $Relative = ([string]$Plugin.path).Replace('\', '/')
                    if (-not $Relative.StartsWith('$localPlugins/External/')) { throw "Unsupported registered TypeR path: $Relative" }
                    $RegisteredPath = Assert-TypeRSafePath (Join-Path (Split-Path -Parent $UxpPlugins) $Relative.Substring('$localPlugins/'.Length))
                    if (-not $RegisteredPath.StartsWith($UxpPlugins.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe registered TypeR path: $Relative" }
                    if (Test-Path -LiteralPath $RegisteredPath) {
                        if ($External -notcontains $RegisteredPath) { throw "Registered TypeR manifest is missing or belongs to another plugin: $RegisteredPath" }
                    }
                }
            }
        }
        $UseExternal = (-not $Direct.Count) -or $External.Count -gt 0 -or $Registered
        $Targets = @($Direct | Sort-Object -Unique)
        $Retire = @()
        if ($UseExternal) {
            $Target = Assert-TypeRSafePath (Join-Path $UxpPlugins $Folder)
            if ((Test-Path -LiteralPath $Target) -and $External -notcontains $Target) { throw "Installation target belongs to another plugin: $Target" }
            $Targets += $Target
            $Retire = @($External | Where-Object { $_ -ne $Target })
        }
        $Transaction = [PSCustomObject]@{
            Id = [Guid]::NewGuid().ToString('N'); State = 'preparing'; Operations = @()
            RegistryPath = $UxpRegistry; RegistryBefore = $Before; RegistryExisted = [bool](Test-Path -LiteralPath $UxpRegistry)
            RegistryAfter = [Convert]::ToBase64String((New-Object Text.UTF8Encoding($false)).GetBytes($RegistryJson))
            RegistryPending = $false
        }
        Save-TypeRTransaction $Transaction $Journal
        foreach ($Target in @($Targets) + @($Retire)) {
            $Target = Assert-TypeRSafePath $Target
            $Index = $Transaction.Operations.Count
            $Workspace = Get-TypeRWorkspace $Target $Transaction.Id
            $null = Assert-TypeRSafePath $Workspace
            $Operation = [PSCustomObject]@{
                Index = $Index; Target = $Target; Workspace = $Workspace
                Stage = Join-Path $Workspace ('stage-' + $Index); Backup = Join-Path $Workspace ('backup-' + $Index)
                HadTarget = [bool](Test-Path -LiteralPath $Target); Pending = $false; Retire = ($Retire -contains $Target)
            }
            $Transaction.Operations += $Operation
            Save-TypeRTransaction $Transaction $Journal
            $null = New-Item -ItemType Directory -Path (Split-Path -Parent $Target), $Workspace -Force
            if (-not $Operation.Retire) {
                Copy-Item -LiteralPath $Extracted -Destination $Operation.Stage -Recurse
                Assert-TypeRInstalledFiles $Operation.Stage $Payload.Inventory
            }
        }
        # Recheck after downloading/staging, immediately before touching plugins.
        Assert-TypeRPhotoshopClosed
        foreach ($Operation in $Transaction.Operations) {
            $Operation.Pending = $true
            Save-TypeRTransaction $Transaction $Journal
            if ($Operation.HadTarget) { [IO.Directory]::Move($Operation.Target, $Operation.Backup) }
            if (-not $Operation.Retire) { [IO.Directory]::Move($Operation.Stage, $Operation.Target) }
        }
        foreach ($Target in $Targets) { Assert-TypeRInstalledFiles $Target $Payload.Inventory }
        Assert-TypeRPhotoshopClosed
        if ($UseExternal) {
            $Current = if (Test-Path -LiteralPath $UxpRegistry) { [Convert]::ToBase64String([IO.File]::ReadAllBytes($UxpRegistry)) } else { $null }
            if ($Current -ne $Before) { throw 'PS.json changed during installation. Please retry.' }
            $null = New-Item -ItemType Directory -Path (Split-Path -Parent $UxpRegistry) -Force
            $Transaction.RegistryPending = $true
            Save-TypeRTransaction $Transaction $Journal
            Write-TypeRAtomicBytes $UxpRegistry ([Convert]::FromBase64String($Transaction.RegistryAfter))
            if ([Convert]::ToBase64String([IO.File]::ReadAllBytes($UxpRegistry)) -ne $Transaction.RegistryAfter) { throw 'Plugin registration verification failed.' }
        }
        $Transaction.State = 'committed'
        Save-TypeRTransaction $Transaction $Journal
        $Committed = $true
        # Keep backups outside Photoshop's plugin search folders.
        try { Move-Item -LiteralPath $Journal -Destination (Join-Path $Control ($Transaction.Id + '.json')) }
        catch { Write-Warning "Installation verified; history retained at $Journal" }
        foreach ($Target in $Targets) { Write-Host "  TypeR $($Payload.Manifest.version): $Target" }
        foreach ($Workspace in @($Transaction.Operations.Workspace | Sort-Object -Unique)) { Write-Host "  Backup: $Workspace" }
    } catch {
        $Failure = $_
        if ($Transaction -and -not $Committed -and (Test-Path -LiteralPath $Journal)) {
            try { Restore-TypeRTransaction $Transaction $Journal }
            catch { throw "$($Failure.Exception.Message) Recovery incomplete: $($_.Exception.Message). Keep backups and relaunch the installer: $Journal" }
        }
        throw $Failure
    } finally {
        try {
            if (Test-Path -LiteralPath $Extracted) { Remove-TypeRDirectory $Extracted $Control }
        } finally { if ($Lock) { $Lock.Dispose() } }
    }
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

function Compare-TypeRVersions([string]$Left, [string]$Right) {
    $LeftParts = @($Left -split '[^0-9]+' | Where-Object { $_ -ne '' })
    $RightParts = @($Right -split '[^0-9]+' | Where-Object { $_ -ne '' })
    $Count = [Math]::Max($LeftParts.Count, $RightParts.Count)
    for ($Index = 0; $Index -lt $Count; $Index++) {
        $LeftPart = if ($Index -lt $LeftParts.Count) { [long]$LeftParts[$Index] } else { 0 }
        $RightPart = if ($Index -lt $RightParts.Count) { [long]$RightParts[$Index] } else { 0 }
        if ($LeftPart -gt $RightPart) { return 1 }
        if ($LeftPart -lt $RightPart) { return -1 }
    }
    return 0
}

function Get-TypeRLegacyVersion {
    try {
        $File = Join-Path $CepTarget 'CSXS\manifest.xml'
        if ((Test-Path -LiteralPath $File -PathType Leaf) -and [IO.File]::ReadAllText($File) -match 'Extension Id="typer".*?Version="([^"]+)"') { return $Matches[1] }
    } catch { Write-Verbose $_.Exception.Message }
    return ''
}

# The newest of the copies found. Showing a version never stops an installation.
function Get-TypeRPluginVersion {
    $Newest = ''
    try {
        foreach ($Path in @(Get-TypeRInstalledPluginPaths)) {
            $Version = [string]([IO.File]::ReadAllText((Join-Path $Path 'manifest.json')) | ConvertFrom-Json).version
            if ($Version -and (-not $Newest -or (Compare-TypeRVersions $Version $Newest) -gt 0)) { $Newest = $Version }
        }
    } catch { Write-Verbose $_.Exception.Message }
    return $Newest
}

function Format-TypeRVersions([string]$Text, [string]$Old, [string]$New) {
    return $Text.Replace('{old}', $Old).Replace('{new}', $New)
}

# The line under a version already installed, compared with this archive's
function Get-TypeRVersionStatus([string]$Installed) {
    if (-not $Installed -or $ExtVersion -eq 'Inconnue') { return '' }
    $Order = Compare-TypeRVersions $Installed $ExtVersion
    $Text = if ($Order -lt 0) { $msg_status_update } elseif ($Order -gt 0) { $msg_status_newer } else { $msg_status_current }
    return Format-TypeRVersions $Text $Installed $ExtVersion
}

# Says it when a version really changed
function Write-TypeRUpdateLine([string]$Old, [string]$New) {
    if ($Old -and $New -and $Old -ne $New -and $New -ne 'Inconnue') {
        Write-Host ""
        Write-Host "  √ $(Format-TypeRVersions $msg_updated $Old $New)" -ForegroundColor Green
    }
}

# --- 4. Choix de la version : UXP ou Legacy (CEP) ---
if ($Uxp -and $Legacy) { throw 'Choose either -Uxp or -Legacy.' }
if ($env:TYPER_INSTALL_PROBE -eq 'recommendation') {
    Update-TypeRRecommendation
    Write-Output "recommended=$Recommended"
    Write-Output "photoshops=$PhotoshopList"
    return
}
# What is installed: the versions found before the installation changes them
$LegacyVersion = Get-TypeRLegacyVersion
$PluginVersion = Get-TypeRPluginVersion
$ChooseMessage = if ($LegacyVersion -or $PluginVersion) { $msg_choose_update } else { $msg_choose }
$LegacyStatus = Get-TypeRVersionStatus $LegacyVersion
$PluginStatus = Get-TypeRVersionStatus $PluginVersion
if ($env:TYPER_INSTALL_PROBE -eq 'installed') {
    $Installed = @(Get-TypeRInstalledPluginPaths | Sort-Object -Unique)
    if ($Installed.Count) { Write-Output 'installed=uxp' }
    foreach ($Path in $Installed) { Write-Output "plugin=$Path" }
    Write-Output "legacy=$LegacyVersion"
    Write-Output "uxp=$PluginVersion"
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
# --- 5. UXP: install directly and verify actual files, never trust UPIA's
# exit code (it can report success without installing anything).
if ($Edition -eq 'uxp') {
    $Source = if ($Package) { [IO.Path]::GetFullPath($Package) } else { Join-Path $ScriptDir 'TypeR-UXP.ccx' }
    $Work = Join-Path ([IO.Path]::GetTempPath()) ('TypeR-UXP-' + [Guid]::NewGuid().ToString('N') + '.ccx')
    $CompleteMessage = $null
    try {
        # Cache custom paths from running Photoshop before asking it to close.
        $null = @(Get-TypeRPhotoshops)
        Assert-TypeRPhotoshopClosed
        if (Test-Path -LiteralPath $Source -PathType Leaf) {
            Copy-Item -LiteralPath $Source -Destination $Work
        } else {
            if ($Package) { throw "Package not found: $Source" }
            Write-Host "  $msg_uxp_download"
            [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
            $ProgressPreference = 'SilentlyContinue'
            Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/ScanR/TypeR/releases/latest/download/TypeR-UXP.ccx' -OutFile $Work -TimeoutSec 180
        }
        Write-Host "  $msg_uxp_installing"
        Install-TypeRPluginManually $Work
        $CompleteMessage = $msg_uxp_complete_manual
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
        Write-TypeRUpdateLine $PluginVersion (Get-TypeRPluginVersion)
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
    Write-Host "Extrayez toute l'archive : le dossier 'installer' doit rester à côté de 'CSXS', 'app', 'icons' et 'locale'."
    if ($Interactive) { Read-Host "Appuyez sur Entrée pour quitter..." }
    exit 1
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
Assert-TypeRPhotoshopClosed
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
Write-TypeRUpdateLine $LegacyVersion $ExtVersion
Write-Host ""
Write-Host "  √ $msg_complete" -ForegroundColor Green
Write-Host "  $msg_open" -ForegroundColor Cyan
if (Get-ChildItem -LiteralPath $UxpPlugins -Filter 'com.scanr.typer_*' -Directory -ErrorAction SilentlyContinue) { Write-Host "  $msg_both" -ForegroundColor Yellow }
Write-TypeRCredits
if ($Interactive) { Read-Host -Prompt $msg_pause }
