@echo off
cd /d "%~dp0"
title Image to DXF - server
if exist "venv\Scripts\python.exe" goto :go
echo Not installed yet - running setup first ...
call "%~dp0setup.bat" /nopause
if not exist "venv\Scripts\python.exe" (
  pause
  exit /b 1
)
:go
echo Starting Image to DXF ... your browser will open in a few seconds.
echo (Log: "%~dp0server.log")
"venv\Scripts\python.exe" launcher.py %* 2>> "%~dp0server.log"
if errorlevel 1 goto :err
exit /b 0
:err
echo.
echo The server stopped with an error - see "%~dp0server.log".
echo If the page did not open, see "Troubleshooting" in WINDOWS-INSTALL.md.
pause
exit /b 1
