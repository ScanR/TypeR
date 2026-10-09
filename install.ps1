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
$msg_install  = "Photoshop extension TypeR v$ExtVersion will be installed."
$msg_close    = "Close Photoshop (if it is open)."
$msg_complete = "Installation completed."
$msg_open     = "Open Photoshop and in the upper menu click the following: [Window] > [Extensions] > [TypeR]"
$msg_pause    = "Press Enter to continue..."
$msg_credits  = "TypeR developed by Sakushi & SeanR."
$msg_typertools = "typertools, developed by Swirt: https://swirt.github.io/typertools/"
$msg_discord  = "ScanR's Discord if you need help: https://discord.com/invite/Pdmfmqk"
$msg_choose   = "Which version of TypeR do you want to install?"
$msg_choice_uxp = "  1) UXP, recommended (faster, built on Adobe's newer plugin framework)`n     Photoshop 2025 (version 26.0) or later"
$msg_choice_legacy = "  2) Legacy, CEP (works with more Photoshop versions; older and slower, but more thoroughly tested)`n     Photoshop CC 2015 (version 16.0) or later"
$msg_choice_prompt = "Your choice [1/2] (Enter = 1)"
$msg_both     = "The other version of TypeR is installed too: do not open both panels at the same time (each shortcut would run twice)."
$msg_uxp_need_cc = "Creative Cloud is required to install the UXP version: install it, then run this script again."
$msg_uxp_download = "Downloading the latest TypeR UXP plugin..."
$msg_uxp_installing = "Installing TypeR (UXP)..."
$msg_uxp_complete = "TypeR is installed: in Photoshop, open it from the menu [Plugins] > [TypeR]. If TypeR was already installed, restart Photoshop."
$msg_uxp_failed = "The installation failed. Double-click TypeR-UXP.ccx to install it through Creative Cloud."

if ($Lang -eq "fr") {
    $msg_install  = "L'extension Photoshop TypeR v$ExtVersion sera installée."
    $msg_close    = "Fermez Photoshop (s'il est ouvert)."
    $msg_complete = "Installation terminée."
    $msg_open     = "Ouvrez Photoshop et dans le menu supérieur cliquez sur : [Fenêtre] > [Extensions] > [TypeR]"
    $msg_pause    = "Appuyez sur Entrée pour continuer..."
    $msg_credits  = "TypeR développé par Sakushi & SeanR."
    $msg_typertools = "typertools, développé par Swirt : https://swirt.github.io/typertools/"
    $msg_discord  = "Discord de ScanR si besoin d'aide : https://discord.com/invite/Pdmfmqk"
    $msg_choose   = "Quelle version de TypeR voulez-vous installer ?"
    $msg_choice_uxp = "  1) UXP, recommandée (plus rapide, basée sur le framework de plugins le plus récent d'Adobe)`n     Photoshop 2025 (version 26.0) ou plus récent"
    $msg_choice_legacy = "  2) Legacy, CEP (compatible avec plus de versions de Photoshop ; plus ancienne et plus lente, mais mieux éprouvée)`n     Photoshop CC 2015 (version 16.0) ou plus récent"
    $msg_choice_prompt = "Votre choix [1/2] (Entrée = 1)"
    $msg_both     = "L'autre version de TypeR est aussi installée : n'ouvrez pas les deux panneaux en même temps (chaque raccourci s'exécuterait deux fois)."
    $msg_uxp_need_cc = "Creative Cloud est nécessaire pour installer la version UXP : installez-le, puis relancez ce script."
    $msg_uxp_download = "Téléchargement du dernier plugin TypeR UXP..."
    $msg_uxp_installing = "Installation de TypeR (UXP)..."
    $msg_uxp_complete = "TypeR est installé : dans Photoshop, ouvrez-le depuis le menu [Plug-ins] > [TypeR]. Si TypeR était déjà installé, redémarrez Photoshop."
    $msg_uxp_failed = "L'installation a échoué. Double-cliquez sur TypeR-UXP.ccx pour l'installer avec Creative Cloud."
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
    $msg_choose   = "¿Qué versión de TypeR quieres instalar?"
    $msg_choice_uxp = "  1) UXP, recomendada (más rápida, basada en el framework de plugins más reciente de Adobe)`n     Photoshop 2025 (versión 26.0) o posterior"
    $msg_choice_legacy = "  2) Legacy, CEP (compatible con más versiones de Photoshop; más antigua y lenta, pero más probada)`n     Photoshop CC 2015 (versión 16.0) o posterior"
    $msg_choice_prompt = "Tu elección [1/2] (Enter = 1)"
    $msg_both     = "La otra versión de TypeR también está instalada: no abras ambos paneles a la vez (cada atajo se ejecutaría dos veces)."
    $msg_uxp_need_cc = "Se necesita Creative Cloud para instalar la versión UXP: instálalo y vuelve a ejecutar este script."
    $msg_uxp_download = "Descargando el último plugin TypeR UXP..."
    $msg_uxp_installing = "Instalando TypeR (UXP)..."
    $msg_uxp_complete = "TypeR está instalado: en Photoshop, ábrelo desde el menú [Plugins] > [TypeR]. Si TypeR ya estaba instalado, reinicia Photoshop."
    $msg_uxp_failed = "La instalación falló. Haz doble clic en TypeR-UXP.ccx para instalarlo con Creative Cloud."
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
    $msg_choose   = "Qual versão do TypeR você quer instalar?"
    $msg_choice_uxp = "  1) UXP, recomendada (mais rápida, baseada no framework de plugins mais recente da Adobe)`n     Photoshop 2025 (versão 26.0) ou mais recente"
    $msg_choice_legacy = "  2) Legacy, CEP (compatível com mais versões do Photoshop; mais antiga e lenta, mas mais testada)`n     Photoshop CC 2015 (versão 16.0) ou mais recente"
    $msg_choice_prompt = "Sua escolha [1/2] (Enter = 1)"
    $msg_both     = "A outra versão do TypeR também está instalada: não abra os dois painéis ao mesmo tempo (cada atalho seria executado duas vezes)."
    $msg_uxp_need_cc = "O Creative Cloud é necessário para instalar a versão UXP: instale-o e execute este script novamente."
    $msg_uxp_download = "Baixando o plugin TypeR UXP mais recente..."
    $msg_uxp_installing = "Instalando o TypeR (UXP)..."
    $msg_uxp_complete = "O TypeR está instalado: no Photoshop, abra-o pelo menu [Plug-ins] > [TypeR]. Se o TypeR já estava instalado, reinicie o Photoshop."
    $msg_uxp_failed = "A instalação falhou. Clique duas vezes em TypeR-UXP.ccx para instalá-lo com o Creative Cloud."
}

if ($Interactive) { Clear-Host }
Write-Host "+------------------------------------------------------------------+" -ForegroundColor Cyan
Write-Host "|                          TypeR Installer                         |" -ForegroundColor Cyan
Write-Host "+------------------------------------------------------------------+" -ForegroundColor Cyan
Write-Host ""

function Write-TypeRCredits {
    Write-Host "+------------------------------------------------------------------+"
    Write-Host "| Credits:                                                         |"
    Write-Host "+------------------------------------------------------------------+"
    Write-Host ("  {0}" -f $msg_credits)
    Write-Host ("  {0}" -f $msg_typertools)
    Write-Host ("  {0}" -f $msg_discord)
    Write-Host ""
}

# --- 4. Choix de la version : UXP ou Legacy (CEP) ---
$Edition = if ($Uxp) { 'uxp' } elseif ($Legacy) { 'legacy' } else { $null }
if (-not $Edition) {
    $Edition = 'legacy'
    if ($Interactive) {
        Write-Host $msg_choose
        Write-Host ""
        Write-Host $msg_choice_uxp
        Write-Host $msg_choice_legacy
        Write-Host ""
        while ($true) {
            $Choice = (Read-Host -Prompt $msg_choice_prompt).Trim()
            if ($Choice -eq '' -or $Choice -eq '1') { $Edition = 'uxp'; break }
            if ($Choice -eq '2') { $Edition = 'legacy'; break }
        }
        Write-Host ""
    }
}
$CepTarget = if ($env:TYPER_INSTALL_TARGET) { $env:TYPER_INSTALL_TARGET } else { Join-Path $env:APPDATA 'Adobe\CEP\extensions\typertools' }
$UxpPlugins = Join-Path $env:APPDATA 'Adobe\UXP\Plugins\External'

# --- 5. Version UXP : le paquet .ccx (à côté de ce script, sinon la dernière
# version publiée), installé par l'installeur de plugins de Creative Cloud ---
if ($Edition -eq 'uxp') {
    $CommonFiles = if ($env:CommonProgramW6432) { $env:CommonProgramW6432 } else { $env:CommonProgramFiles }
    $Upia = Join-Path $CommonFiles 'Adobe\Adobe Desktop Common\RemoteComponents\UPI\UnifiedPluginInstallerAgent\UnifiedPluginInstallerAgent.exe'
    $Source = if ($Package) { [IO.Path]::GetFullPath($Package) } else { Join-Path $PSScriptRoot 'TypeR-UXP.ccx' }
    $Work = Join-Path ([IO.Path]::GetTempPath()) ('TypeR-UXP-' + [Guid]::NewGuid().ToString('N') + '.ccx')
    $Installed = $false
    try {
        if (-not (Test-Path -LiteralPath $Upia -PathType Leaf)) { throw $msg_uxp_need_cc }
        if (Test-Path -LiteralPath $Source -PathType Leaf) {
            Copy-Item -LiteralPath $Source -Destination $Work
        } else {
            Write-Host $msg_uxp_download
            [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
            Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/ScanR/TypeR/releases/latest/download/TypeR-UXP.ccx' -OutFile $Work
        }
        Write-Host $msg_uxp_installing
        & $Upia --install $Work
        $Installed = $LASTEXITCODE -eq 0
        if (-not $Installed) { Write-Host $msg_uxp_failed -ForegroundColor Red }
    } catch {
        Write-Host $_.Exception.Message -ForegroundColor Red
    } finally {
        Remove-Item -LiteralPath $Work -Force -ErrorAction SilentlyContinue
    }
    Write-Host ""
    if ($Installed) {
        Write-Host $msg_uxp_complete -ForegroundColor Cyan
        if (Test-Path -LiteralPath (Join-Path $CepTarget 'CSXS')) { Write-Host $msg_both -ForegroundColor Yellow }
        Write-Host ""
        Write-TypeRCredits
    }
    if ($Interactive) { Read-Host -Prompt $msg_pause }
    if ($Installed) { exit 0 } else { exit 1 }
}

# --- 6. Version Legacy (CEP) ---
if (-not (Test-Path $ManifestPath)) {
    Write-Host "[ERREUR] Fichier introuvable : $ManifestPath" -ForegroundColor Red
    Write-Host "Placez ce script à côté des dossiers 'CSXS', 'app', 'icons', 'locale', 'themes'."
    if ($Interactive) { Read-Host "Appuyez sur Entrée pour quitter..." }
    exit 1
}
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
Write-Host "+------------------------------------------------------------------+" -ForegroundColor Green
Write-Host "|                      Installation Completed                      |" -ForegroundColor Green
Write-Host "+------------------------------------------------------------------+" -ForegroundColor Green
Write-Host ""
Write-Host $msg_complete
Write-Host ""
Write-Host $msg_open -ForegroundColor Cyan
if (Get-ChildItem -LiteralPath $UxpPlugins -Filter 'com.scanr.typer_*' -Directory -ErrorAction SilentlyContinue) { Write-Host $msg_both -ForegroundColor Yellow }
Write-Host ""
Write-TypeRCredits
if ($Interactive) { Read-Host -Prompt $msg_pause }
