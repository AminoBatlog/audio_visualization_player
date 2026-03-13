@echo off
setlocal
cd /d "%~dp0.."
".venv\Scripts\python.exe" bridge_server.py 1>>".runtime_logs\bridge.out.log" 2>>".runtime_logs\bridge.err.log"
