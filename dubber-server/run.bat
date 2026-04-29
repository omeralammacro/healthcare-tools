@echo off
REM Double-click to start the Dubber dashboard server.
cd /d "%~dp0"
if not exist .env (
  echo .env not found. Copy .env.example to .env and fill in your Dubber credentials.
  pause
  exit /b 1
)
node server.js
pause
