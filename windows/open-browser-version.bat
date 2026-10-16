@echo off
rem Opens the no-install, browser-only edition (everything runs inside the browser, nothing is uploaded).
cd /d "%~dp0"
if not exist "web\index.html" (
  echo web\index.html not found - did you extract the whole zip?
  pause
  exit /b 1
)
start "" "%~dp0web\index.html"
