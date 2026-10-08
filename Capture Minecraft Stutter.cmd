@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\capture-game-stutter.ps1" -Seconds 60
echo.
if errorlevel 1 (
  echo Capture failed. Keep this window open and share the error above.
) else (
  echo Capture finished. Send the newest folder from the diagnostics directory for analysis.
)
pause
