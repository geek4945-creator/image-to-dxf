@echo off
rem Image to DXF (Hard Version 1.5) - one-click setup. Runs setup.ps1 (PowerShell) with a bypassed execution policy
rem for this process only. Installs Python 3.12 if needed, creates the venv, installs packages, adds shortcuts.
setlocal
cd /d "%~dp0"
title Image to DXF - setup
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
  echo.
  echo Setup did not finish ^(code %RC%^). Details are in "%~dp0setup.log".
)
if /i not "%~1"=="/nopause" pause
exit /b %RC%
