@echo off
cd /d "C:\Users\essoz\GitHub\guhaedo"

echo === Aguagu Git Push ===
echo.

if exist ".git\index.lock" del /f /q ".git\index.lock"

set GIT=
if exist "C:\Program Files\Git\cmd\git.exe" set GIT=C:\Program Files\Git\cmd\git.exe
if exist "C:\Program Files (x86)\Git\cmd\git.exe" set GIT=C:\Program Files (x86)\Git\cmd\git.exe
if exist "%LOCALAPPDATA%\Programs\Git\cmd\git.exe" set GIT=%LOCALAPPDATA%\Programs\Git\cmd\git.exe
for /f "delims=" %%i in ('where git 2^>nul') do if not defined GIT set GIT=%%i

if not defined GIT (
    echo ERROR: Git not found. Please install Git from https://git-scm.com
    pause
    exit
)

echo Git found: %GIT%
echo.

echo [1] git add...
"%GIT%" add .

echo [2] git commit...
"%GIT%" commit -m "517 missing apts added + parking/entrance/builder data + handover doc"

echo [3] git push...
"%GIT%" push

echo.
echo === Done! ===
pause
