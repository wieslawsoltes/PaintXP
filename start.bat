@echo off
cd /d "%~dp0"
node server\server.mjs %*
pause
