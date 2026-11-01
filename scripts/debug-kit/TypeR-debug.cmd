@echo off
cd /d "%~dp0" || exit /b 1
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\collect.ps1"
pause
