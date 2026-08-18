@echo off
cd /d "%~dp0"
echo Starting Check-In Tracker at http://localhost:8080
python -m http.server 8080
