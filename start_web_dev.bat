@echo off
setlocal
cd /d "%~dp0web"

set "NODE_EXE=C:\Program Files\nodejs\node.exe"
set "NPM_CLI=C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js"

echo [1/2] Installing web dependencies if needed...
"%NODE_EXE%" "%NPM_CLI%" install
if errorlevel 1 (
    echo Failed to install web dependencies.
    pause
    exit /b 1
)

echo [2/2] Starting Vite dev server...
"%NODE_EXE%" .\node_modules\vite\bin\vite.js
if errorlevel 1 (
    echo Dev server exited with an error.
    pause
    exit /b 1
)

endlocal
