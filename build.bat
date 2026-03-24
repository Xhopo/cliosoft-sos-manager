@echo off
REM ClioSoft SOS Manager - Build Script
REM Version: 0.2.0

echo ========================================
echo ClioSoft SOS Manager v0.2.0
echo Build and Package Script
echo ========================================
echo.

REM Step 1: Check Node.js
echo [1/5] Checking Node.js installation...
node --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js is not installed!
    echo Please install Node.js from https://nodejs.org/
    goto error
)
echo ✓ Node.js found
echo.

REM Step 2: Install dependencies
echo [2/5] Installing dependencies...
call npm install
if errorlevel 1 (
    echo ERROR: Failed to install dependencies!
    goto error
)
echo ✓ Dependencies installed
echo.

REM Step 3: Compile TypeScript
echo [3/5] Compiling TypeScript...
call npm run compile
if errorlevel 1 (
    echo ERROR: TypeScript compilation failed!
    echo Please check the error messages above.
    goto error
)
echo ✓ TypeScript compiled successfully
echo.

REM Step 4: Check vsce
echo [4/5] Checking vsce installation...
npx @vscode/vsce --version >nul 2>&1
if errorlevel 1 (
    echo WARNING: vsce not found, installing...
    call npm install -g @vscode/vsce
    if errorlevel 1 (
        echo ERROR: Failed to install vsce!
        goto error
    )
)
echo ✓ vsce ready
echo.

REM Step 5: Package VSIX
echo [5/5] Packaging VSIX file...
call npx @vscode/vsce package
if errorlevel 1 (
    echo ERROR: Failed to package VSIX!
    goto error
)
echo ✓ VSIX packaged successfully
echo.

REM Success
echo ========================================
echo ✅ BUILD COMPLETED SUCCESSFULLY!
echo ========================================
echo.
echo Output file: cliosoft-sos-manager-0.2.0.vsix
echo.
echo Next steps:
echo 1. Test the extension: code --install-extension cliosoft-sos-manager-0.2.0.vsix
echo 2. Create GitHub Release
echo 3. Upload VSIX file
echo.
goto end

:error
echo.
echo ========================================
echo ❌ BUILD FAILED!
echo ========================================
echo.
echo Please check the error messages above and try again.
echo.
echo Common solutions:
echo - Run: npm install
echo - Run: npm run compile
echo - Check TypeScript errors in src/ files
echo.
exit /b 1

:end
pause
