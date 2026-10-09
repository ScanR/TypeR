@echo off
:: Installs the TypeR UXP plugin (Photoshop 2026 and later).
::   install_uxp_win.cmd              installs TypeR-UXP.ccx next to this script,
::                                    or the latest release when there is none
::   install_uxp_win.cmd path\x.ccx   installs that package
:: Double-clicking TypeR-UXP.ccx does the same through Creative Cloud.
setlocal
cd /d "%~dp0"
set "UPIA=%CommonProgramFiles%\Adobe\Adobe Desktop Common\RemoteComponents\UPI\UnifiedPluginInstallerAgent\UnifiedPluginInstallerAgent.exe"
if not exist "%UPIA%" (
  echo Creative Cloud is required: install it, then run this script again.
  exit /b 1
)
set "PACKAGE=%~1"
if "%PACKAGE%"=="" set "PACKAGE=%~dp0TypeR-UXP.ccx"
set "WORK=%TEMP%\TypeR-UXP-%RANDOM%.ccx"
if exist "%PACKAGE%" (
  copy /y "%PACKAGE%" "%WORK%" >nul
) else (
  echo Downloading the latest TypeR UXP plugin...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/ScanR/TypeR/releases/latest/download/TypeR-UXP.ccx' -OutFile '%WORK%'" || exit /b 1
)
echo Installing TypeR...
"%UPIA%" --install "%WORK%"
set "RESULT=%ERRORLEVEL%"
del /q "%WORK%" >nul 2>&1
if not "%RESULT%"=="0" (
  echo The installation failed. Double-click TypeR-UXP.ccx to install it through Creative Cloud.
  exit /b 1
)
echo TypeR is installed: open it from Photoshop's Plugins menu. If TypeR was already installed, restart Photoshop.
