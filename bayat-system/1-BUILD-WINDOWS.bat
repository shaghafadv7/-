@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Build Bayat Alakena Real Estate
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js is not installed.
  echo Install Node.js LTS from https://nodejs.org then run this file again.
  echo.
  pause
  exit /b 1
)
echo [1/2] Installing application components...
call npm install
if errorlevel 1 goto error
echo [2/2] Building Windows installer...
call npm run build:win
if errorlevel 1 goto error
echo.
echo Build completed successfully.
echo Opening the release folder...
start "" "%~dp0release"
pause
exit /b 0
:error
echo.
echo Build failed. Please copy the error message and send it for support.
pause
exit /b 1
