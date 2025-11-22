# Encodage pour les accents dans la console
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# --- 1. Définition robuste du dossier du script ---
# $PSScriptRoot est une variable native fiable, contrairement à %~dp0
$ScriptDir = $PSScriptRoot
Set-Location -Path $ScriptDir

# --- 2. Vérification du Manifest ---
$ManifestPath = Join-Path $ScriptDir "CSXS\manifest.xml"
if (-not (Test-Path $ManifestPath)) {
    Write-Host "[ERREUR] Fichier introuvable : $ManifestPath" -ForegroundColor Red
    Write-Host "Placez ce script à côté des dossiers 'CSXS', 'app', 'icons', 'locale', 'themes'."
    Read-Host "Appuyez sur Entrée pour quitter..."
    exit
}

# --- 3. Extraction de la version (plus précis que findstr) ---
$Content = Get-Content $ManifestPath -Raw
if ($Content -match 'Extension Id="typer".*?Version="([^"]+)"') {
    $ExtVersion = $matches[1]
} else {
    $ExtVersion = "Inconnue"
}

# --- 4. Langues et Messages ---
# Détection de la langue de l'interface utilisateur (ex: fr-FR)
$Lang = $Host.CurrentCulture.TwoLetterISOLanguageName

# Valeurs par défaut (Anglais)
$msg_install  = "Photoshop extension TypeR v$ExtVersion will be installed."
$msg_close    = "Close Photoshop (if it is open)."
$msg_complete = "Installation completed."
$msg_open     = "Open Photoshop and in the upper menu click the following: [Window] > [Extensions] > [TypeR]"
$msg_pause    = "Press Enter to continue..."
$msg_credits  = "Many thanks to Swirt for TyperTools and SeanR & Sakushi for this fork."
$msg_discord  = "ScanR's Discord if you need help: https://discord.com/invite/Pdmfmqk"

if ($Lang -eq "fr") {
    $msg_install  = "L'extension Photoshop TypeR v$ExtVersion sera installée."
    $msg_close    = "Fermez Photoshop (s'il est ouvert)."
    $msg_complete = "Installation terminée."
    $msg_open     = "Ouvrez Photoshop et dans le menu supérieur cliquez sur : [Fenêtre] > [Extensions] > [TypeR]"
    $msg_pause    = "Appuyez sur Entrée pour continuer..."
    $msg_credits  = "Merci beaucoup à Swirt pour TyperTools et SeanR & Sakushi pour ce fork."
    $msg_discord  = "Discord de ScanR si besoin d'aide : https://discord.com/invite/Pdmfmqk"
}
elseif ($Lang -eq "es") {
    $msg_install  = "La extensión de Photoshop TypeR v$ExtVersion se instalará."
    $msg_close    = "Cierra Photoshop (si está abierto)."
    $msg_complete = "Instalación completada."
    $msg_open     = "Abre Photoshop y en el menú superior haz clic en lo siguiente: [Ventana] > [Extensiones] > [TypeR]"
    $msg_pause    = "Presiona Enter para continuar..."
    $msg_credits  = "Muchas gracias a Swirt por TyperTools y a SeanR & Sakushi por este fork."
    $msg_discord  = "Discord de ScanR si necesitas ayuda: https://discord.com/invite/Pdmfmqk"
}
elseif ($Lang -eq "pt") {
    $msg_install  = "Photoshop extension TypeR v$ExtVersion will be installed."
    $msg_close    = "Feche o Photoshop (se estiver aberto)."
    $msg_complete = "Instalação concluída."
    $msg_open     = "Abra o Photoshop e no menu superior clique em: [Janela] > [Extensões] > [TypeR]"
    $msg_pause    = "Pressione Enter para continuar..."
    $msg_credits  = "Muito obrigado a Swirt pelo TyperTools e a SeanR & Sakushi por este fork."
    $msg_discord  = "Discord do ScanR se precisar de ajuda: https://discord.com/invite/Pdmfmqk"
}

Clear-Host
Write-Host "+------------------------------------------------------------------+" -ForegroundColor Cyan
Write-Host "|                          TypeR Installer                         |" -ForegroundColor Cyan
Write-Host "+------------------------------------------------------------------+" -ForegroundColor Cyan
Write-Host ""
Write-Host "? $msg_install"
Write-Host ""
Write-Host "? $msg_close" -ForegroundColor Yellow
Write-Host ""
Read-Host "? $msg_pause"

# --- 5. Mode Debug (CSXS 6 à 12) ---
# Ne nécessite pas les droits admin car c'est dans HKCU (Utilisateur courant)
6..12 | ForEach-Object {
    $RegPath = "HKCU:\Software\Adobe\CSXS.$_"
    if (Test-Path $RegPath) {
        Set-ItemProperty -Path $RegPath -Name "PlayerDebugMode" -Value 1 -Type String -ErrorAction SilentlyContinue
    }
}

# --- 6. Gestion des dossiers ---
$AppData = $env:APPDATA
$TargetDir = Join-Path $AppData "Adobe\CEP\extensions\typertools"

# On crée un dossier TEMP pour contenir la sauvegarde (et non le fichier lui-même)
$TempBackupContainer = Join-Path $env:TEMP "typer_backup_container"

# Nettoyage préalable du temp au cas où
if (Test-Path $TempBackupContainer) { Remove-Item $TempBackupContainer -Recurse -Force -ErrorAction SilentlyContinue }
New-Item -Path $TempBackupContainer -ItemType Directory -Force | Out-Null

# SAUVEGARDE : On copie "storage" DANS le dossier conteneur
# Cela préserve la nature de "storage" (que ce soit un fichier ou un dossier)
if (Test-Path "$TargetDir\storage") {
    Copy-Item "$TargetDir\storage" -Destination $TempBackupContainer -Recurse -Force -ErrorAction SilentlyContinue
}

# Nettoyage dossier cible (Reset complet de l'extension)
if (Test-Path $TargetDir) {
    Remove-Item $TargetDir -Recurse -Force -ErrorAction SilentlyContinue
}
New-Item -Path $TargetDir -ItemType Directory -Force | Out-Null

# --- 7. Copie des fichiers ---
$FoldersToCopy = @("app", "CSXS", "icons", "locale")

foreach ($folder in $FoldersToCopy) {
    $Source = Join-Path $ScriptDir $folder
    $Dest = Join-Path $TargetDir $folder
    if (Test-Path $Source) {
        Copy-Item $Source -Destination $Dest -Recurse -Force
    }
}

# Cas particulier: themes
if (Test-Path "$ScriptDir\themes") {
    $ThemeDest = "$TargetDir\app\themes"
    if (-not (Test-Path $ThemeDest)) { New-Item $ThemeDest -ItemType Directory -Force | Out-Null }
    Copy-Item "$ScriptDir\themes\*" -Destination $ThemeDest -Recurse -Force
}

# Fichier .debug
if (Test-Path "$ScriptDir\.debug") {
    Copy-Item "$ScriptDir\.debug" -Destination "$TargetDir\.debug" -Force
}

# RESTAURATION DU STORAGE
# On vérifie si la sauvegarde existe dans le conteneur
if (Test-Path "$TempBackupContainer\storage") {
    # On copie l'élément "storage" depuis le conteneur vers la racine de l'extension
    Copy-Item "$TempBackupContainer\storage" -Destination "$TargetDir" -Recurse -Force
}

# Nettoyage final du dossier temp
if (Test-Path $TempBackupContainer) { Remove-Item $TempBackupContainer -Recurse -Force -ErrorAction SilentlyContinue }

# --- 8. Fin ---
Write-Host ""
Write-Host "+------------------------------------------------------------------+" -ForegroundColor Green
Write-Host "|                      Installation Completed                      |" -ForegroundColor Green
Write-Host "+------------------------------------------------------------------+" -ForegroundColor Green
Write-Host ""
Write-Host "? $msg_complete"
Write-Host ""
Write-Host "? $msg_open" -ForegroundColor Cyan
Write-Host ""
Write-Host "+------------------------------------------------------------------+"
Write-Host "| Credits:                                                         |"
Write-Host "+------------------------------------------------------------------+"
Write-Host "  $msg_credits"
Write-Host "  $msg_discord"
Write-Host ""
Read-Host $msg_pause