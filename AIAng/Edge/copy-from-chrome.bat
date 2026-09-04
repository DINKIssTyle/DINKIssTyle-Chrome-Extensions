@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ===================================================
echo   AIAng: Chrome to Edge Resource Copy Script
echo ===================================================

for %%I in ("%~dp0..") do set "REPO_ROOT=%%~fI"
set "SOURCE_DIR=%REPO_ROOT%\Chrome\AIAng"
set "DEST_DIR=%REPO_ROOT%\Edge\AIAng"

if not exist "%SOURCE_DIR%\manifest.json" (
    echo [ERROR] Chrome extension directory not found: "%SOURCE_DIR%"
    exit /b 1
)

if not exist "%DEST_DIR%" (
    echo [INFO] Creating Edge destination directory: "%DEST_DIR%"
    mkdir "%DEST_DIR%"
)

echo [INFO] Copying resources from Chrome to Edge...
echo   Source: "%SOURCE_DIR%"
echo   Destination: "%DEST_DIR%"
echo.

robocopy "%SOURCE_DIR%" "%DEST_DIR%" /E /R:1 /W:1 /XD .git node_modules
set "ROBO_EXIT=%ERRORLEVEL%"

rem Robocopy exit codes 0-7 are success (0=no change, 1=copied, etc.)
if %ROBO_EXIT% GEQ 8 (
    echo.
    echo [ERROR] Robocopy failed with exit code: %ROBO_EXIT%
    exit /b %ROBO_EXIT%
)

set "MISSING_COUNT=0"
for %%F in (manifest.json background.js content.js content.css options.html options.js options.css shared\prompts.json shared\features.json shared\review-presentation.js) do (
    if not exist "%DEST_DIR%\%%F" (
        echo [ERROR] Missing required file: "%DEST_DIR%\%%F"
        set /a MISSING_COUNT+=1
    )
)

if %MISSING_COUNT% GTR 0 (
    echo.
    echo [ERROR] Total %MISSING_COUNT% required files missing. Please retry.
    exit /b 1
)

echo.
echo ===================================================
echo [OK] Chrome/AIAng -^> Edge/AIAng copy completed successfully!
echo In Microsoft Edge (edge://extensions), turn on Developer mode
echo and load unpacked extension from:
echo   "%DEST_DIR%"
echo ===================================================
exit /b 0
