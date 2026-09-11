@echo off
cd /d "%~dp0server"
if not exist node_modules (
  echo Instalando dependencias...
  call npm install
)
echo Iniciando analisador em http://127.0.0.1:8787
node src\index.js
pause
