@echo off
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js 22 or newer is required. This portable launcher does not install Node and is not a standalone native installer.
  exit /b 1
)
node "scripts\desktop\launcher.mjs" %*
