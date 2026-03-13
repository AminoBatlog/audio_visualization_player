@echo off
setlocal
cd /d "%~dp0"

set "ROOT=%~dp0"
set "VENV_PY=%ROOT%.venv\Scripts\python.exe"
set "NODE_EXE=C:\Program Files\nodejs\node.exe"
set "CONFIG_URL=http://127.0.0.1:5173/config.html"
set "VISUALIZER_URL=http://127.0.0.1:5173/visualizer.html"

if not exist "%VENV_PY%" (
    echo Missing .venv. Run start_app.bat first or create the virtual environment.
    pause
    exit /b 1
)

if not exist "%NODE_EXE%" (
    echo Node.js was not found at "%NODE_EXE%".
    pause
    exit /b 1
)

echo Starting Python bridge...
start "Audio Ring Bridge" "%ROOT%start_bridge.bat"

echo Waiting for bridge health...
powershell -NoProfile -Command "$ok=$false; for($i=0;$i -lt 20;$i++){ try { Invoke-RestMethod -Uri 'http://127.0.0.1:8765/health' | Out-Null; $ok=$true; break } catch { Start-Sleep -Milliseconds 500 } }; if(-not $ok){ exit 1 }"
if errorlevel 1 (
    echo Bridge did not become healthy on http://127.0.0.1:8765 .
    pause
    exit /b 1
)

echo Starting web dev server...
start "Audio Ring Web" "%ROOT%start_web_dev.bat"

echo Waiting for web server...
powershell -NoProfile -Command "$ok=$false; for($i=0;$i -lt 30;$i++){ try { Invoke-WebRequest -Uri 'http://127.0.0.1:5173/config.html' -UseBasicParsing | Out-Null; $ok=$true; break } catch { Start-Sleep -Milliseconds 500 } }; if(-not $ok){ exit 1 }"
if errorlevel 1 (
    echo Web dev server did not become ready on http://127.0.0.1:5173 .
    pause
    exit /b 1
)

echo Opening config page...
start "" "%CONFIG_URL%"

echo.
echo Started:
echo - Python bridge window
echo - Web dev server window
echo - Config page in browser
echo.
echo For OBS Browser Source, use:
echo %VISUALIZER_URL%

endlocal
