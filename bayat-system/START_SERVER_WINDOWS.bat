@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist node_modules (
  echo Installing required components...
  call npm install
)
echo Starting Bayat Alakena Real Estate System...
start "" http://localhost:4173
npm start
pause
