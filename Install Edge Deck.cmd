@echo off
rem Double-click to install Edge Deck for this Windows user.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install.ps1" %*
echo.
pause
