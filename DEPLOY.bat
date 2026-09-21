@echo off
setlocal
cd /d "%~dp0"
echo ==============================================
echo  Deploying POS-RFID Super ERP (Phases 1-4)
echo  to GitHub -> Railway auto-redeploys
echo ==============================================
echo.

where git >/dev/null 2>nul
if errorlevel 1 (
  echo ERROR: Git is not on PATH. Close this window, reopen after installing
  echo Git for Windows, or run from "Git Bash".
  pause
  exit /b 1
)

if not exist ".git" (
  git init
)
git remote remove origin 1>/dev/null 2>nul
git remote add origin https://github.com/Johnnyisioma/pos-rfid-system.git

echo Fetching current repo state...
git fetch origin main
if errorlevel 1 (
  echo ERROR: could not reach GitHub. Check your internet / login and retry.
  pause
  exit /b 1
)

git reset --soft origin/main
git add -A
git -c user.name="Millzee Jay" -c user.email="johnnyisioma@gmail.com" commit -m "Super ERP v6: Phases 1-4 (catalog tiers/bins, sales orders + warranties, double-entry accounting, invoice designer + notifications)"

echo.
echo Pushing to GitHub... (a browser login may pop up the first time)
git branch -M main
git push origin main
if errorlevel 1 (
  echo.
  echo Push failed. If it asked you to sign in, complete it and run this again.
  pause
  exit /b 1
)

echo.
echo ==============================================
echo  DONE. GitHub updated. Railway will redeploy
echo  your site in a couple of minutes.
echo ==============================================
pause
