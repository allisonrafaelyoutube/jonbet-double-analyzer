@echo off
cd /d "%~dp0server"
if not exist node_modules (
  echo Instalando dependencias...
  call npm install
)
if not exist .env (
  echo Criando .env a partir do Supabase CLI...
  node ..\scripts\write-local-env.js
)
echo Iniciando analisador local + Supabase em http://127.0.0.1:8787
node src\index.js
pause
