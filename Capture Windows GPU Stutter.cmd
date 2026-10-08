@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\capture-windows-gpu-stutter.ps1" -Seconds 30
echo.
if errorlevel 1 (
  echo Capture failed. Keep this window open and share the error above.
) else (
  echo Capture finished. Send the newest windows-stutter folder from diagnostics for analysis.
)
pause
