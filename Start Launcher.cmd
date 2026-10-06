@echo off
cd /d "%~dp0"
if not exist node_modules\electron\dist\electron.exe (
  echo Installing launcher dependencies...
  call npm.cmd ci
  if errorlevel 1 (pause & exit /b 1)
  call node node_modules\electron\install.js
  if errorlevel 1 (pause & exit /b 1)
)
call npm.cmd start
if errorlevel 1 pause
