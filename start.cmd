@echo off
set "BUNDLED_NODE=C:\Users\ramoscv\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

if not exist "%BUNDLED_NODE%" (
  echo Nao foi encontrado o runtime Node empacotado em %BUNDLED_NODE%
  exit /b 1
)

set "NODE_OPTIONS=--use-system-ca"
"%BUNDLED_NODE%" "%~dp0server.mjs"
