@echo off
setlocal
cd /d "%~dp0"

set "VENV_PY=.venv\Scripts\python.exe"

if not exist "%VENV_PY%" (
    echo Missing .venv. Run start_app.bat or create the virtual environment first.
    pause
    exit /b 1
)

echo Starting Python bridge on http://127.0.0.1:8765 ...
"%VENV_PY%" bridge_server.py
if errorlevel 1 (
    echo Python bridge exited with an error.
    pause
    exit /b 1
)

endlocal
