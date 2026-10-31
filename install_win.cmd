@echo off
:: Force le dossier de travail à être celui où se trouve ce fichier
cd /d "%~dp0" || exit /b 1

:: Lance le script PowerShell en contournant la politique de sécurité (ExecutionPolicy)
:: et en passant le contrôle à PowerShell
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\install.ps1" %*
exit /b %errorlevel%
