@echo off
:: Installs the TypeR UXP plugin (Photoshop 2025 and later), without asking
:: which version to install: the same as install_win.cmd -Uxp
::   install_uxp_win.cmd              installs TypeR-UXP.ccx next to this script,
::                                    or the latest release when there is none
::   install_uxp_win.cmd path\x.ccx   installs that package
:: Close Photoshop first. Existing copies are backed up and verified on update.
cd /d "%~dp0" || exit /b 1
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" -Uxp %*
exit /b %errorlevel%
