@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "ROOT=%~dp0"
set "VENV_PY=%ROOT%.venv\Scripts\python.exe"
set "NODE_EXE=C:\Program Files\nodejs\node.exe"
set "NPM_CLI=C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js"
set "CONFIG_URL=http://127.0.0.1:5173/config.html"
set "VISUALIZER_URL=http://127.0.0.1:5173/visualizer.html"
set "BRIDGE_HEALTH_URL=http://127.0.0.1:8765/health"
set "WEB_HEALTH_URL=http://127.0.0.1:5173/config.html"
set "LOG_DIR=%ROOT%.runtime_logs"
set "BRIDGE_STDOUT=%LOG_DIR%\bridge.out.log"
set "BRIDGE_STDERR=%LOG_DIR%\bridge.err.log"
set "WEB_STDOUT=%LOG_DIR%\web.out.log"
set "WEB_STDERR=%LOG_DIR%\web.err.log"
set "BRIDGE_PID="
set "WEB_PID="

call :validate_env
if errorlevel 1 exit /b 1

call :start_services
if errorlevel 1 exit /b 1

:menu
cls
echo Audio Ring Control Panel
echo ========================
echo.
echo Bridge PID: %BRIDGE_PID%
echo Web PID:    %WEB_PID%
echo.
echo Config Page: %CONFIG_URL%
echo OBS URL:     %VISUALIZER_URL%
echo.
echo Logs:
echo [1] %BRIDGE_STDOUT%
echo [2] %BRIDGE_STDERR%
echo [3] %WEB_STDOUT%
echo [4] %WEB_STDERR%
echo.
echo Commands:
echo [R] Restart services
echo [O] Open config page
echo [L] Open log folder
echo [S] Show status
echo [Q] Stop and quit
echo.
choice /c ROLSQ /n /m "Select action: "

if errorlevel 5 goto quit
if errorlevel 4 goto status
if errorlevel 3 goto logs
if errorlevel 2 goto open_config
if errorlevel 1 goto restart
goto menu

:restart
echo.
echo Restarting services...
call :stop_processes
call :start_services
if errorlevel 1 exit /b 1
goto menu

:open_config
start "" "%CONFIG_URL%"
goto menu

:logs
start "" "%LOG_DIR%"
goto menu

:status
echo.
echo Checking bridge and web endpoints...
powershell -NoProfile -Command "try { Invoke-RestMethod -Uri '%BRIDGE_HEALTH_URL%' -TimeoutSec 2 ^| Out-Null; Write-Host 'Bridge: up' } catch { Write-Host 'Bridge: down' }"
powershell -NoProfile -Command "try { Invoke-WebRequest -Uri '%WEB_HEALTH_URL%' -UseBasicParsing -TimeoutSec 2 ^| Out-Null; Write-Host 'Web: up' } catch { Write-Host 'Web: down' }"
call :refresh_pids
echo Bridge PID: %BRIDGE_PID%
echo Web PID:    %WEB_PID%
echo.
pause
goto menu

:quit
echo.
echo Stopping services...
call :stop_processes
endlocal
exit /b 0

:validate_env
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

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
exit /b 0

:start_services
call :stop_processes
break > "%BRIDGE_STDOUT%"
break > "%BRIDGE_STDERR%"
break > "%WEB_STDOUT%"
break > "%WEB_STDERR%"

echo [1/4] Checking web dependencies...
if not exist "%ROOT%web\node_modules" (
    pushd "%ROOT%web"
    "%NODE_EXE%" "%NPM_CLI%" install
    if errorlevel 1 (
        popd
        echo Failed to install web dependencies.
        pause
        exit /b 1
    )
    popd
) else (
    echo Web dependencies already present.
)

echo [2/4] Starting Python bridge in background...
start "bridge" /b cmd.exe /d /c call "%ROOT%tools\run_bridge.cmd"

call :wait_for_http "%BRIDGE_HEALTH_URL%" rest 30 BRIDGE_READY
if not "%BRIDGE_READY%"=="1" (
    echo Bridge did not become healthy on %BRIDGE_HEALTH_URL% .
    echo Bridge stdout log: %BRIDGE_STDOUT%
    echo Bridge stderr log: %BRIDGE_STDERR%
    call :stop_processes
    pause
    exit /b 1
)
call :get_pid_by_port 8765 BRIDGE_PID

echo [3/4] Starting web dev server in background...
start "web" /b cmd.exe /d /c call "%ROOT%tools\run_web.cmd"

call :wait_for_port 5173 30 WEB_READY
if not "%WEB_READY%"=="1" (
    echo Web dev server did not become ready on %WEB_HEALTH_URL% .
    echo Web stdout log: %WEB_STDOUT%
    echo Web stderr log: %WEB_STDERR%
    call :stop_processes
    pause
    exit /b 1
)
call :get_pid_by_port 5173 WEB_PID

echo [4/4] Opening config page...
start "" "%CONFIG_URL%"
timeout /t 1 >nul
exit /b 0

:wait_for_http
setlocal
set "TARGET_URL=%~1"
set "MODE=%~2"
set "MAX_TRIES=%~3"
set "READY=0"
echo Waiting for %MODE% health...
for /l %%i in (1,1,%MAX_TRIES%) do (
    "%VENV_PY%" -c "import sys, urllib.request; urllib.request.urlopen(r'%TARGET_URL%', timeout=2); sys.exit(0)" >nul 2>nul
    if not errorlevel 1 (
        set "READY=1"
        goto wait_done
    )
    timeout /t 1 >nul
)
:wait_done
endlocal & set "%~4=%READY%"
exit /b 0

:wait_for_port
setlocal
set "PORT=%~1"
set "MAX_TRIES=%~2"
set "READY=0"
echo Waiting for web health...
for /l %%i in (1,1,%MAX_TRIES%) do (
    "%VENV_PY%" -c "import socket, sys; s = socket.create_connection(('127.0.0.1', %PORT%), timeout=2); s.close(); sys.exit(0)" >nul 2>nul
    if not errorlevel 1 (
        set "READY=1"
        goto wait_port_done
    )
    timeout /t 1 >nul
)
:wait_port_done
endlocal & set "%~3=%READY%"
exit /b 0

:get_pid_by_port
setlocal
set "PORT=%~1"
set "PID="
for /f %%i in ('powershell -NoProfile -Command "$pidValue = Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue ^| Select-Object -First 1 -ExpandProperty OwningProcess; if ($pidValue) { Write-Output $pidValue }"') do (
    set "PID=%%i"
)
endlocal & set "%~2=%PID%"
exit /b 0

:refresh_pids
call :get_pid_by_port 8765 BRIDGE_PID
call :get_pid_by_port 5173 WEB_PID
exit /b 0

:stop_pid
setlocal
set "TARGET_PID=%~1"
echo %TARGET_PID%| findstr /r "^[0-9][0-9]*$" >nul
if not errorlevel 1 (
    taskkill /PID %TARGET_PID% /T /F >nul 2>nul
)
endlocal
exit /b 0

:stop_processes
call :refresh_pids
if defined WEB_PID call :stop_pid %WEB_PID%
if defined BRIDGE_PID call :stop_pid %BRIDGE_PID%
set "WEB_PID="
set "BRIDGE_PID="
exit /b 0
