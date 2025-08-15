@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion

rem === Toujours se placer dans le dossier du script (meme en admin) ===
set "SCRIPT_DIR=%~dp0"
pushd "%SCRIPT_DIR%" >nul 2>&1

rem === Verif presence du manifest ===
if not exist "CSXS\manifest.xml" (
  echo [ERREUR] Fichier introuvable : "%SCRIPT_DIR%CSXS\manifest.xml"
  echo Place ce .cmd a cote des dossiers "CSXS", "app", "icons", "locale", "themes".
  goto :cleanup
)

rem === Extraction de la version depuis le manifest ===
for /f "tokens=5 delims=<>=/ " %%V in ('
  findstr /i "<Extension Id=\"typer\"" "CSXS\manifest.xml"
') do set "EXT_VERSION=%%~V"

rem === Detection langue systeme ===
for /f "tokens=3" %%a in (
  'reg query "HKCU\Control Panel\International" /v LocaleName 2^>nul'
) do set "locale=%%a"

rem === Messages localises ===
if /i "%locale:~0,2%"=="fr" (
    set msg_install="L'extension Photoshop TypeR v!EXT_VERSION! sera installée."
    set msg_close="Fermez Photoshop (s'il est ouvert)."
    set msg_complete="Installation terminée."
    set msg_open="Ouvrez Photoshop et dans le menu supérieur cliquez sur : [Fenêtre] ^> [Extensions] ^> [TypeR]"
    set msg_pause="Appuyez sur une touche pour continuer..."
    set msg_credits="Merci beaucoup à Swirt pour TyperTools et SeanR & Sakushi pour ce fork."
    set msg_discord="Discord de ScanR si besoin d'aide : https://discord.com/invite/Pdmfmqk"
) else if /i "%locale:~0,2%"=="es" (
    set msg_install="La extensión de Photoshop TypeR v!EXT_VERSION! se instalará."
    set msg_close="Cierra Photoshop (si está abierto)."
    set msg_complete="Instalación completada."
    set msg_open="Abre Photoshop y en el menú superior haz clic en lo siguiente: [Ventana] ^> [Extensiones] ^> [TypeR]"
    set msg_pause="Presiona cualquier tecla para continuar..."
    set msg_credits="Muchas gracias a Swirt por TyperTools y a SeanR & Sakushi por este fork."
    set msg_discord="Discord de ScanR si necesitas ayuda: https://discord.com/invite/Pdmfmqk"
) else if /i "%locale:~0,2%"=="pt" (
    set msg_install="Photoshop extension TypeR v!EXT_VERSION! will be installed."
    set msg_close="Feche o Photoshop (se estiver aberto)."
    set msg_complete="Instalação concluída."
    set msg_open="Abra o Photoshop e no menu superior clique em: [Janela] ^> [Extensões] ^> [TypeR]"
    set msg_pause="Pressione qualquer tecla para continuar..."
    set msg_credits="Muito obrigado a Swirt pelo TyperTools e a SeanR & Sakushi por este fork."
    set msg_discord="Discord do ScanR se precisar de ajuda: https://discord.com/invite/Pdmfmqk"
) else (
    set msg_install="Photoshop extension TypeR v!EXT_VERSION! will be installed."
    set msg_close="Close Photoshop (if it is open)."
    set msg_complete="Installation completed."
    set msg_open="Open Photoshop and in the upper menu click the following: [Window] ^> [Extensions] ^> [TypeR]"
    set msg_pause="Press any key to continue..."
    set msg_credits="Many thanks to Swirt for TyperTools and SeanR & Sakushi for this fork."
    set msg_discord="ScanR's Discord if you need help: https://discord.com/invite/Pdmfmqk"
)

echo %msg_install%
echo.
echo %msg_close%
echo.
echo %msg_pause%
pause

rem === Activer PlayerDebugMode pour CSXS 6..12 si existants ===
for /l %%x in (6,1,12) do (
  reg query "HKCU\SOFTWARE\Adobe\CSXS.%%x" >nul 2>&1
  if !errorlevel! equ 0 (
    reg add "HKCU\SOFTWARE\Adobe\CSXS.%%x" /t REG_SZ /v PlayerDebugMode /d 1 /f >nul
  )
)

rem === Dossier cible dans le profil utilisateur courant ===
set "TARGET_DIR=%APPDATA%\Adobe\CEP\extensions\typertools"

rem Sauvegarde eventuelle du storage
if exist "%TARGET_DIR%\storage" copy "%TARGET_DIR%\storage" "%TEMP%\__storage" /Y >nul

rem Reinit dossier extension
if exist "%TARGET_DIR%" rmdir "%TARGET_DIR%" /S /Q
if not exist "%TARGET_DIR%" md "%TARGET_DIR%"

rem === Copies en chemin absolu depuis le dossier du script ===
xcopy "%SCRIPT_DIR%app"    "%TARGET_DIR%\app\"         /E /I /Y >nul
xcopy "%SCRIPT_DIR%CSXS"   "%TARGET_DIR%\CSXS\"        /E /I /Y >nul
xcopy "%SCRIPT_DIR%icons"  "%TARGET_DIR%\icons\"       /E /I /Y >nul
xcopy "%SCRIPT_DIR%locale" "%TARGET_DIR%\locale\"      /E /I /Y >nul
xcopy "%SCRIPT_DIR%themes" "%TARGET_DIR%\app\themes\"  /E /I /Y >nul

if exist "%SCRIPT_DIR%.debug" copy "%SCRIPT_DIR%.debug" "%TARGET_DIR%\.debug" /Y >nul
if exist "%TEMP%\__storage" (
  copy "%TEMP%\__storage" "%TARGET_DIR%\storage" /Y >nul
  del "%TEMP%\__storage" /F >nul
)

echo.
echo %msg_complete%
echo %msg_open%
echo.
echo %msg_credits%
echo %msg_discord%
echo.
echo %msg_pause%
pause

:cleanup
popd >nul 2>&1
endlocal
