@echo off
cd /d "%~dp0"
if "%PORT%"=="" set PORT=3000
node server.js
pause
