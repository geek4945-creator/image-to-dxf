@echo off
setlocal
cd /d "%~dp0"
title Image to DXF - build exe (optional)
rem OPTIONAL: builds dist\ImageToDXF\ImageToDXF.exe so Python is not needed on the target PC.
rem Requires install.bat to have been run first. Takes a few minutes and ~300 MB of disk.
if exist "venv\Scripts\python.exe" goto :go
echo Run install.bat first.
pause
exit /b 1
:go
"venv\Scripts\python.exe" -m pip install --upgrade pyinstaller
if errorlevel 1 goto :fail
"venv\Scripts\python.exe" -m PyInstaller --noconfirm --clean --onedir --console --name ImageToDXF ^
  --add-data "static;static" --collect-submodules shapely --hidden-import app --hidden-import selection --hidden-import pipeline --hidden-import urlfetch ^
  launcher.py
if errorlevel 1 goto :fail
rem copy the no-install browser edition next to the exe
if exist "web" xcopy /e /i /y "web" "dist\ImageToDXF\web" >nul
echo.
echo Done:  dist\ImageToDXF\ImageToDXF.exe   (copy the whole dist\ImageToDXF folder to any Windows PC)
pause
exit /b 0
:fail
echo.
echo Build failed - see messages above.
pause
exit /b 1
