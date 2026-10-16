@echo off
setlocal
cd /d "%~dp0"
title Image to DXF - install
echo ==============================================================
echo   Image to DXF - installer
echo ==============================================================
echo.

rem ---- 1. find Python 3.10 or newer ---------------------------------
set "PY="
for %%V in (3.12 3.11 3.13 3.10) do (
  if not defined PY (
    py -%%V -c "import sys" >nul 2>&1
    if not errorlevel 1 set "PY=py -%%V"
  )
)
if not defined PY (
  py -3 -c "import sys; sys.exit(0 if sys.version_info[:2]>=(3,10) else 1)" >nul 2>&1
  if not errorlevel 1 set "PY=py -3"
)
if not defined PY (
  python -c "import sys; sys.exit(0 if sys.version_info[:2]>=(3,10) else 1)" >nul 2>&1
  if not errorlevel 1 set "PY=python"
)
if not defined PY goto :nopython

echo Found Python:
%PY% --version
echo.

rem ---- 2. virtual environment ---------------------------------------
if exist "venv\Scripts\python.exe" goto :havevenv
echo Creating virtual environment in "%~dp0venv" ...
%PY% -m venv venv
if errorlevel 1 goto :fail
goto :pipstep
:havevenv
echo Existing environment found - updating it.

rem ---- 3. packages --------------------------------------------------
:pipstep
echo.
echo Installing components (needs internet, 1-3 minutes) ...
"venv\Scripts\python.exe" -m pip install --upgrade pip
if errorlevel 1 goto :pipfail
"venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 goto :pipfail

echo.
set "ANS="
set /p "ANS=Also install optional PDF input support (PyMuPDF, about 30 MB)? [y/N]: "
if /i not "%ANS%"=="y" goto :verify
"venv\Scripts\python.exe" -m pip install -r requirements-pdf.txt
if errorlevel 1 echo WARNING: PDF support could not be installed. The app still works for images.

rem ---- 4. self-check ------------------------------------------------
:verify
echo.
"venv\Scripts\python.exe" -c "import cv2, numpy, flask, ezdxf, shapely, PIL, requests; print('All components loaded OK')"
if errorlevel 1 goto :pipfail

echo.
echo ==============================================================
echo   Install finished.  Now double-click  run.bat  to start.
echo ==============================================================
if /i not "%~1"=="/nopause" pause
exit /b 0

:nopython
echo ERROR: Python 3.10 or newer was not found.
echo.
echo     1. Download Python 3.12 from  https://www.python.org/downloads/windows/
echo     2. Run the installer and TICK  "Add python.exe to PATH"  on the first screen.
echo     3. Close this window, then double-click install.bat again.
echo.
echo     (If "python" opens the Microsoft Store, that is only a placeholder - install from python.org.)
if /i not "%~1"=="/nopause" pause
exit /b 1

:pipfail
echo.
echo ERROR: Installing the components failed. Common causes:
echo     - no internet connection / a proxy or firewall blocking pip
echo     - a very new Python version without ready-made packages: install Python 3.12 and delete the "venv" folder
echo     See "Troubleshooting" in WINDOWS-INSTALL.md.
if /i not "%~1"=="/nopause" pause
exit /b 1

:fail
echo.
echo ERROR: Could not create the virtual environment.
if /i not "%~1"=="/nopause" pause
exit /b 1
