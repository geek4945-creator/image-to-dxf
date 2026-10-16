@echo off
cd /d "%~dp0"
title Image to DXF - server
if exist "venv\Scripts\python.exe" goto :go
echo Not installed yet - please double-click install.bat first.
pause
exit /b 1
:go
echo Starting Image to DXF ... your browser will open in a few seconds.
"venv\Scripts\python.exe" launcher.py %*
if errorlevel 1 goto :err
exit /b 0
:err
echo.
echo The server stopped with an error - see the message above.
echo If the page did not open, see "Troubleshooting" in WINDOWS-INSTALL.md.
pause
exit /b 1
