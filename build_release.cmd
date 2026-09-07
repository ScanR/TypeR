@echo off
setlocal
cd /d "%~dp0"
call npm run release
exit /b %ERRORLEVEL%
