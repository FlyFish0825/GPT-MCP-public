@echo off
setlocal
title GPT-MCP - Start service
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1" %*
set "serviceExitCode=%errorlevel%"
echo.
if not "%serviceExitCode%"=="0" echo Start failed. See the error above and the logs folder.
pause
exit /b %serviceExitCode%
