@echo off
setlocal
title GPT-MCP - Stop service
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop.ps1"
set "serviceExitCode=%errorlevel%"
echo.
if not "%serviceExitCode%"=="0" echo Stop failed. See the error above and the logs folder.
pause
exit /b %serviceExitCode%
