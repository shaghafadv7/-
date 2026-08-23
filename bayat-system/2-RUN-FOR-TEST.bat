@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Bayat Alakena Real Estate
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js LTS from https://nodejs.org first.
  pause
  exit /b 1
)
if not exist node_modules call npm install
call npm run desktop
pause
