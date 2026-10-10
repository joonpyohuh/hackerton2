@echo off
chcp 65001 > nul
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  py -m venv .venv
  if errorlevel 1 (echo Python 3.10+ required.& pause & exit /b 1)
)
call .venv\Scripts\activate.bat
python -m pip install -r requirements.txt
if errorlevel 1 (echo Python package install failed.& pause & exit /b 1)
python setup_env.py
if not exist "web\dist\index.html" (
  where npm >nul 2>nul && (pushd web & call npm install & call npm run build & popd) || echo [안내] Node.js가 없어 /insights 화면을 빌드하지 못했습니다. 기존 대시보드는 정상 동작합니다.
)
echo.
echo Visit http://127.0.0.1:8000   (연관 지도: http://127.0.0.1:8000/insights)
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --env-file .env
pause
