@echo off
:: Force le dossier de travail à être celui où se trouve ce fichier
cd /d "%~dp0"

:: Lance le script PowerShell en contournant la politique de sécurité (ExecutionPolicy)
:: et en passant le contrôle à PowerShell
PowerShell -NoProfile -ExecutionPolicy Bypass -File "install.ps1"