@echo off
REM ── Build DONUT.exe (standalone, no Node.js) ──
REM Prerequisites: Rust, VS Build Tools C++

call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul 2>&1
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"

echo [1/2] Compiling Tauri...
cd /d "%~dp0..\src-tauri"
cargo build --release
if errorlevel 1 exit /b 1

echo [2/2] Deploying...
copy /y "%~dp0..\src-tauri\target\release\DONUT.exe" "%~dp0..\DONUT.exe" >nul

echo.
echo Done! Run DONUT.exe from the project root.
