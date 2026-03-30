@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ============================================
echo   AI Retouch - Windows Full Build
echo ============================================
echo.

:: Kill running instances
echo [0/7] Closing running AI Retouch processes...
taskkill /F /IM "AI Retouch.exe" 2>nul
echo.

:: Step 1
echo [1/7] Building shared package...
call pnpm build:shared
if %errorlevel% neq 0 (
    echo [ERROR] build:shared failed!
    goto :fail
)
echo.

:: Step 2
echo [2/7] Building server (pack)...
call pnpm build:server:pack
if %errorlevel% neq 0 (
    echo [ERROR] build:server:pack failed!
    goto :fail
)
echo.

:: Step 3
echo [3/7] Preparing server (bytecode + sharp)...
call pnpm prepare-server
if %errorlevel% neq 0 (
    echo [ERROR] prepare-server failed!
    goto :fail
)
echo.

:: Step 4
echo [4/7] Building UXP plugin...
call pnpm build:plugin
if %errorlevel% neq 0 (
    echo [ERROR] build:plugin failed!
    goto :fail
)
echo.

:: Step 5
echo [5/7] Building CCX package...
call pnpm build:ccx
if %errorlevel% neq 0 (
    echo [ERROR] build:ccx failed!
    goto :fail
)
echo.

:: Step 6
echo [6/7] Building Electron app...
call pnpm build:electron
if %errorlevel% neq 0 (
    echo [ERROR] build:electron failed!
    goto :fail
)
echo.

:: Step 7
echo [7/7] Packaging with electron-builder...
cd apps\electron
call npx electron-builder --win
if %errorlevel% neq 0 (
    cd ..\..
    echo [ERROR] electron-builder failed!
    goto :fail
)
cd ..\..
echo.

echo ============================================
echo   BUILD SUCCESSFUL
echo ============================================
echo.
echo   Output:
echo     NSIS installer : apps\electron\release\AI-Retouch-0.0.1-Setup.exe
echo     ZIP portable   : apps\electron\release\AI Retouch-0.0.1-win.zip
echo     Unpacked       : apps\electron\release\win-unpacked\
echo.
goto :end

:fail
echo.
echo ============================================
echo   BUILD FAILED - See errors above
echo ============================================
echo.

:end
pause
