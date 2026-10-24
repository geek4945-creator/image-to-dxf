@echo off
rem Kept for older instructions: install.bat now simply runs the new setup (setup.bat -> setup.ps1).
call "%~dp0setup.bat" %*
exit /b %ERRORLEVEL%
