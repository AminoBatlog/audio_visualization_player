@echo off
setlocal
cd /d "%~dp0..\web"
"C:\Program Files\nodejs\node.exe" ".\node_modules\vite\bin\vite.js" --host 127.0.0.1 --port 5173 --strictPort 1>>"..\.runtime_logs\web.out.log" 2>>"..\.runtime_logs\web.err.log"
