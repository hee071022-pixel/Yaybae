@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Haulers 마이크 프로그램 준비 중...
python -m pip install -q -r requirements.txt
if errorlevel 1 (
  echo Python이 필요합니다: https://www.python.org/downloads/  ^(설치할 때 "Add to PATH" 체크^)
  pause
  exit /b 1
)
python haulers_mic.py %*
pause
